import { randomUUID } from "node:crypto";
import type { AppContext } from "../context";
import { BudgetExceededError } from "../engine/budget/budgetGuard";
import { AppError } from "../lib/errors";
import { siteLangs } from "../messaging/conversations";
import type { Lang } from "../shared/languages";
import type { StreamFallbackReason, StreamFormat, StreamOpenResult, StreamTurnStart } from "../shared/realtime";
import type { ContextLine, StreamConnection, StreamEngine, TurnEnd } from "./engine";
import { persistTurn } from "./persistTurn";
import { LinearResampler } from "./resample";
import { DEFAULT_STREAM_FILTER_OPTIONS, SafeStreamFilter, type StreamFilterOptions } from "../engine/audio/streamAudioFilter";

// 스트리밍 통역 허브 (docs/streaming-plan.md 3·4절). 1:1 통화만 (일괄 지시는 발화 단위 방식 유지, 2026-10-12 결정).
//   stream:open  → 세션·권한 확인(기존 utteranceTarget 규칙) → 엔진 연결(화자 × 상대 언어)
//   stream:audio → 표본률 변환 → 엔진. 엔진이 말 끝을 감지하면 턴 시작
//   엔진 출력 → 상대에게 stream:out:start/audio/text/end, 턴이 끝나면 기록 저장(persistTurn) + 직전 턴 텍스트 문맥 갱신
//   엔진이 끊기면 진행 중 턴 실패 → 다시 연결. 짧은 시간에 반복되거나 다시 못 열면 stream:fallback (P6)

export type StreamEmitter = {
  toUser(userId: string, event: "stream:out:start", payload: StreamTurnStart): void;
  toUser(userId: string, event: "stream:out:audio", payload: { turnId: string; seq: number; pcm: Buffer }): void;
  toUser(userId: string, event: "stream:out:text", payload: { turnId: string; kind: "original" | "translation"; text: string }): void;
  toUser(userId: string, event: "stream:out:end", payload: { turnId: string; status: "done" | "failed"; messageId: string | null }): void;
  fallback(userId: string, payload: { sessionId: string; streamId: string; reason: StreamFallbackReason }): void;
};

export type StreamHubOptions = {
  enabled: boolean;
  /** 동시에 열 수 있는 엔진 연결 수 (넘으면 BUSY → 앱은 발화 단위 방식) */
  maxStreams: number;
  /** 이 시간 안에 엔진이 2번 끊기면 폴백 */
  failureWindowMs: number;
  /** 한 턴에 모아 두는 입력 음성 최대 길이 (기록용) */
  maxTurnSeconds: number;
  /** 같은 언어 직접 전달: 조각이 이 시간 동안 안 오면 턴 끝 */
  relayIdleMs: number;
  /** 서버 노이즈 필터(조각 단위) 안전 규칙 */
  filter: StreamFilterOptions;
};

export const DEFAULT_STREAM_HUB_OPTIONS: StreamHubOptions = { enabled: true, maxStreams: 4, failureWindowMs: 60_000, maxTurnSeconds: 35, relayIdleMs: 1_000, filter: DEFAULT_STREAM_FILTER_OPTIONS };

type TurnState = {
  id: string;
  seq: number;
  output: Buffer[];
  input: Buffer;
  translation: string;
  original: string | null;
  startedAt: number;
  firstAudioAt: number | null;
};

type Stream = {
  id: string;
  sessionId: string;
  siteId: string;
  conversationId: string | null;
  speakerId: string;
  listenerId: string;
  /** 이 스트림을 연 실시간 연결 (그 연결이 끊기면 닫는다) */
  socketId: string;
  sourceLang: Lang;
  targetLang: Lang;
  resampler: LinearResampler;
  connection: StreamConnection | null;
  reconnecting: boolean;
  closed: boolean;
  lastSeq: number;
  gaps: number;
  /** 아직 턴이 되지 않은 입력 음성 (기록용) */
  pendingInput: Buffer[];
  pendingBytes: number;
  turns: Map<string, TurnState>;
  history: ContextLine[];
  failures: number[];
  /** 같은 언어 통화: OpenAI 없이 받은 음성을 그대로 상대에게 보낸다 (2026-10-13 결정) */
  relay: boolean;
  relayTurn: { id: string; seq: number } | null;
  relayTimer: NodeJS.Timeout | null;
  sampleRate: number;
  /** 서버 노이즈 필터 (2026-10-14 결정, passthrough 면 그대로) */
  filter: SafeStreamFilter;
};

export class StreamHub {
  private readonly streams = new Map<string, Stream>();
  readonly options: StreamHubOptions;

  constructor(
    private readonly ctx: AppContext,
    private readonly engine: StreamEngine | null,
    private readonly emit: StreamEmitter,
    options: Partial<StreamHubOptions> = {},
  ) {
    this.options = { ...DEFAULT_STREAM_HUB_OPTIONS, ...options };
  }

  get size(): number {
    return this.streams.size;
  }

  // ─── 열기 ─────────────────────────────────────────

  async open(userId: string, socketId: string, sessionId: string, format: StreamFormat): Promise<StreamOpenResult> {
    if (!this.options.enabled) return { ok: false, code: "UNSUPPORTED" };
    let target;
    try {
      target = await this.ctx.sessions.utteranceTarget(sessionId, userId);
    } catch (error) {
      const code = error instanceof AppError ? error.code : "NOT_FOUND";
      return { ok: false, code: code === "CONFLICT" ? "CONFLICT" : code === "FORBIDDEN" ? "UNSUPPORTED" : "NOT_FOUND" };
    }
    // 일괄 지시는 발화 단위 방식 유지 (S5 취소)
    if (target.kind !== "direct" || target.recipientIds.length !== 1) return { ok: false, code: "UNSUPPORTED" };
    const listenerId = target.recipientIds[0]!;
    const langs = await siteLangs(this.ctx.prisma, target.siteId, [userId, listenerId]);
    const sourceLang = langs.get(userId)!;
    const targetLang = langs.get(listenerId)!;
    // 같은 언어끼리는 통역 없이 음성을 그대로 전달한다 (OpenAI 를 쓰지 않으므로 엔진·상한과 무관)
    const relay = sourceLang === targetLang;
    if (!relay && !this.engine) return { ok: false, code: "ENGINE_UNAVAILABLE" };

    // 같은 사람이 같은 세션에 다시 열면(재연결) 이전 스트림을 닫는다
    for (const stream of this.streams.values()) {
      if (stream.sessionId === sessionId && stream.speakerId === userId) this.closeStream(stream);
    }
    if (!relay && this.engineStreams() >= this.options.maxStreams) return { ok: false, code: "BUSY" };

    const stream: Stream = {
      id: randomUUID(),
      sessionId,
      siteId: target.siteId,
      conversationId: target.conversationId,
      speakerId: userId,
      listenerId,
      socketId,
      sourceLang,
      targetLang,
      resampler: new LinearResampler(format.sampleRate, relay ? format.sampleRate : this.engine!.sampleRate),
      connection: null,
      reconnecting: false,
      closed: false,
      lastSeq: -1,
      gaps: 0,
      pendingInput: [],
      pendingBytes: 0,
      turns: new Map(),
      history: [],
      failures: [],
      relay,
      relayTurn: null,
      relayTimer: null,
      sampleRate: format.sampleRate,
      filter: new SafeStreamFilter(
        this.ctx.streamAudioFilter,
        { siteId: target.siteId, userId, lang: sourceLang, sampleRate: format.sampleRate },
        this.options.filter,
        (reason, error) =>
          this.ctx.logger.warn({ err: error, sessionId, reason, filter: this.ctx.streamAudioFilter.name }, reason === "disabled" ? "스트리밍 노이즈 필터 끔 (연속 실패)" : "스트리밍 노이즈 필터 실패, 원본 조각 사용"),
      ),
    };
    this.streams.set(stream.id, stream);
    if (relay) {
      this.ctx.logger.info({ sessionId, streamId: stream.id, lang: sourceLang }, "같은 언어 통화: 음성 직접 전달 시작");
      return { ok: true, streamId: stream.id, outputSampleRate: format.sampleRate, mode: "relay" };
    }
    try {
      stream.connection = await this.connect(stream);
    } catch (error) {
      stream.filter.close(); // 이미 연 필터(사이드카 연결)를 남기지 않는다
      this.streams.delete(stream.id);
      if (error instanceof BudgetExceededError) return { ok: false, code: "BUDGET_EXCEEDED" };
      this.ctx.logger.warn({ err: error, sessionId }, "스트리밍 엔진 열기 실패");
      return { ok: false, code: "ENGINE_UNAVAILABLE" };
    }
    if (stream.closed) return { ok: false, code: "CONFLICT" };
    this.ctx.logger.info({ sessionId, streamId: stream.id, sourceLang, targetLang }, "스트리밍 통역 시작");
    return { ok: true, streamId: stream.id, outputSampleRate: this.engine!.sampleRate, mode: "interpret" };
  }

  /** OpenAI 엔진을 쓰는 스트림 수 (직접 전달은 세지 않는다) */
  private engineStreams(): number {
    let count = 0;
    for (const stream of this.streams.values()) if (!stream.relay) count++;
    return count;
  }

  private connect(stream: Stream): Promise<StreamConnection> {
    return this.engine!.open({
      sourceLang: stream.sourceLang,
      targetLang: stream.targetLang,
      events: {
        turnStart: (turnId) => this.onTurnStart(stream, turnId),
        audio: (turnId, pcm) => this.onAudio(stream, turnId, pcm),
        translationDelta: (turnId, text) => {
          const turn = stream.turns.get(turnId);
          if (!turn || stream.closed) return;
          turn.translation += text;
          this.emit.toUser(stream.listenerId, "stream:out:text", { turnId, kind: "translation", text });
        },
        original: (turnId, text) => {
          const turn = stream.turns.get(turnId);
          if (!turn || stream.closed) return;
          turn.original = text;
          this.emit.toUser(stream.listenerId, "stream:out:text", { turnId, kind: "original", text });
        },
        turnEnd: (turnId, result) => void this.onTurnEnd(stream, turnId, result),
        closed: (reason) => void this.onEngineClosed(stream, reason),
      },
    });
  }

  // ─── 입력 ─────────────────────────────────────────

  audio(userId: string, streamId: string, seq: number, pcm: Buffer): void {
    const stream = this.streams.get(streamId);
    // 다른 사람의 스트림·닫힌 스트림·이미 받은 순번은 무시한다
    if (!stream || stream.speakerId !== userId || stream.closed || seq <= stream.lastSeq) return;
    if (seq !== stream.lastSeq + 1 && stream.lastSeq >= 0) stream.gaps += seq - stream.lastSeq - 1;
    stream.lastSeq = seq;
    // 서버 노이즈 필터 → (같은 언어) 그대로 전달 / (통역) 표본률 변환 후 엔진
    stream.filter.push(pcm, (frame) => this.ingest(stream, frame));
  }

  private ingest(stream: Stream, pcm: Buffer): void {
    if (stream.closed) return;
    if (stream.relay) return this.relayAudio(stream, pcm);
    const converted = stream.resampler.push(pcm);
    if (converted.length === 0) return;
    stream.pendingInput.push(converted);
    stream.pendingBytes += converted.length;
    const maxBytes = this.options.maxTurnSeconds * (this.engine?.sampleRate ?? 24_000) * 2;
    while (stream.pendingBytes > maxBytes && stream.pendingInput.length > 1) stream.pendingBytes -= stream.pendingInput.shift()!.length;
    stream.connection?.append(converted);
  }

  pause(userId: string, streamId: string): void {
    const stream = this.streams.get(streamId);
    if (!stream || stream.speakerId !== userId || stream.closed) return;
    // 필터 처리 중인 조각이 모두 들어간 뒤에 말 끝을 알린다
    stream.filter.after(() => {
      if (stream.closed) return;
      if (stream.relay) this.endRelayTurn(stream);
      else stream.connection?.commit();
    });
  }

  // ─── 같은 언어: 직접 전달 ───────────────────────────
  // 단말이 말소리 구간만 보내므로, 조각이 오기 시작하면 턴 시작, stream:pause 또는 조각이 끊기면 턴 끝.
  // 통역·전사가 없으므로 기록(메시지)은 남기지 않는다.

  private relayAudio(stream: Stream, pcm: Buffer): void {
    if (!stream.relayTurn) {
      stream.relayTurn = { id: randomUUID(), seq: 0 };
      this.emit.toUser(stream.listenerId, "stream:out:start", {
        sessionId: stream.sessionId,
        turnId: stream.relayTurn.id,
        fromUserId: stream.speakerId,
        lang: stream.sourceLang,
        sampleRate: stream.sampleRate,
      });
    }
    const turn = stream.relayTurn;
    this.emit.toUser(stream.listenerId, "stream:out:audio", { turnId: turn.id, seq: turn.seq++, pcm });
    if (stream.relayTimer) clearTimeout(stream.relayTimer);
    stream.relayTimer = setTimeout(() => this.endRelayTurn(stream), this.options.relayIdleMs);
  }

  private endRelayTurn(stream: Stream): void {
    if (stream.relayTimer) clearTimeout(stream.relayTimer);
    stream.relayTimer = null;
    const turn = stream.relayTurn;
    stream.relayTurn = null;
    if (turn) this.emit.toUser(stream.listenerId, "stream:out:end", { turnId: turn.id, status: "done", messageId: null });
  }

  close(userId: string, streamId: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream || stream.speakerId !== userId) return false;
    this.closeStream(stream);
    return true;
  }

  // ─── 엔진 출력 ─────────────────────────────────────

  private onTurnStart(stream: Stream, turnId: string): void {
    if (stream.closed) return;
    const input = Buffer.concat(stream.pendingInput);
    stream.pendingInput = [];
    stream.pendingBytes = 0;
    stream.turns.set(turnId, { id: turnId, seq: 0, output: [], input, translation: "", original: null, startedAt: Date.now(), firstAudioAt: null });
    this.emit.toUser(stream.listenerId, "stream:out:start", {
      sessionId: stream.sessionId,
      turnId,
      fromUserId: stream.speakerId,
      lang: stream.targetLang,
      sampleRate: this.engine!.sampleRate,
    });
  }

  private onAudio(stream: Stream, turnId: string, pcm: Buffer): void {
    const turn = stream.turns.get(turnId);
    if (!turn || stream.closed) return;
    turn.firstAudioAt ??= Date.now();
    turn.output.push(pcm);
    this.emit.toUser(stream.listenerId, "stream:out:audio", { turnId, seq: turn.seq++, pcm });
  }

  private async onTurnEnd(stream: Stream, turnId: string, result: TurnEnd): Promise<void> {
    const turn = stream.turns.get(turnId);
    stream.turns.delete(turnId);
    if (!turn || stream.closed) {
      if (turn) this.emit.toUser(stream.listenerId, "stream:out:end", { turnId, status: "failed", messageId: null });
      return;
    }
    if (result.status === "failed") {
      this.ctx.logger.warn({ sessionId: stream.sessionId, turnId, code: result.code }, "스트리밍 턴 실패");
      this.emit.toUser(stream.listenerId, "stream:out:end", { turnId, status: "failed", messageId: null });
      return;
    }
    let saved: Awaited<ReturnType<typeof persistTurn>> | null = null;
    try {
      saved = await persistTurn(this.ctx, {
        turnId,
        siteId: stream.siteId,
        sessionId: stream.sessionId,
        conversationId: stream.conversationId,
        senderId: stream.speakerId,
        recipientId: stream.listenerId,
        sourceLang: stream.sourceLang,
        targetLang: stream.targetLang,
        original: result.original ?? turn.original,
        translation: result.translation,
        model: result.model,
        inputPcm: turn.input,
        outputPcm: Buffer.concat(turn.output),
        sampleRate: this.engine!.sampleRate,
        timings: {
          firstAudioMs: turn.firstAudioAt ? turn.firstAudioAt - turn.startedAt : -1,
          totalMs: Date.now() - turn.startedAt,
          inputGaps: stream.gaps,
        },
      });
    } catch (error) {
      this.ctx.logger.error({ err: error, sessionId: stream.sessionId, turnId }, "스트리밍 턴 기록 실패");
    }
    // 순서 중요: end(messageId) 를 먼저 보내고 기록 알림(message:new)을 보낸다 → 앱은 이미 들은 문장을 다시 재생하지 않는다
    this.emit.toUser(stream.listenerId, "stream:out:end", { turnId, status: "done", messageId: saved?.messageId ?? null });
    await saved?.notify().catch((error: unknown) => this.ctx.logger.warn({ err: error, turnId }, "스트리밍 턴 기록 알림 실패"));
    const original = (result.original ?? turn.original)?.trim();
    if (original) {
      stream.history = [...stream.history, { original, translation: result.translation }].slice(-2);
      stream.connection?.setContext(stream.history);
    }
  }

  /** 엔진 연결이 예기치 않게 끝남: 진행 중 턴은 엔진이 실패로 닫았다. 다시 연결하거나 폴백 */
  private async onEngineClosed(stream: Stream, reason: "error" | "budget"): Promise<void> {
    if (stream.closed) return;
    stream.connection = null;
    for (const turnId of stream.turns.keys()) {
      this.emit.toUser(stream.listenerId, "stream:out:end", { turnId, status: "failed", messageId: null });
    }
    stream.turns.clear();
    if (reason === "budget") return this.fallback(stream, "BUDGET_EXCEEDED");
    const now = Date.now();
    stream.failures = [...stream.failures.filter((at) => now - at < this.options.failureWindowMs), now];
    if (stream.failures.length >= 2) return this.fallback(stream, "ENGINE_FAILED");
    this.ctx.logger.warn({ sessionId: stream.sessionId, streamId: stream.id }, "스트리밍 엔진 끊김, 다시 연결");
    stream.reconnecting = true;
    try {
      const connection = await this.connect(stream);
      stream.reconnecting = false;
      if (stream.closed) return connection.close();
      stream.connection = connection;
      if (stream.history.length > 0) connection.setContext(stream.history);
    } catch (error) {
      stream.reconnecting = false;
      this.ctx.logger.warn({ err: error, sessionId: stream.sessionId }, "스트리밍 엔진 다시 연결 실패");
      this.fallback(stream, error instanceof BudgetExceededError ? "BUDGET_EXCEEDED" : "ENGINE_FAILED");
    }
  }

  private fallback(stream: Stream, reason: StreamFallbackReason): void {
    if (stream.closed) return;
    this.ctx.logger.warn({ sessionId: stream.sessionId, streamId: stream.id, reason }, "스트리밍 → 발화 단위 방식 전환");
    this.emit.fallback(stream.speakerId, { sessionId: stream.sessionId, streamId: stream.id, reason });
    this.closeStream(stream);
  }

  // ─── 닫기 ─────────────────────────────────────────

  private closeStream(stream: Stream): void {
    if (stream.closed) return;
    if (stream.relay) this.endRelayTurn(stream);
    stream.closed = true;
    stream.filter.close();
    if (this.ctx.streamAudioFilter.name !== "passthrough") {
      // 필터가 실제로 쓰였는지 확인용 (filtered = 필터 결과를 쓴 조각, failed = 원본을 쓴 조각)
      this.ctx.logger.info({ sessionId: stream.sessionId, streamId: stream.id, filter: this.ctx.streamAudioFilter.name, ...stream.filter.stats }, "스트리밍 노이즈 필터 결과");
    }
    this.streams.delete(stream.id);
    stream.connection?.close();
    stream.connection = null;
    // 듣는 사람 화면에 진행 중 턴이 남지 않게 닫는다
    for (const turnId of stream.turns.keys()) {
      this.emit.toUser(stream.listenerId, "stream:out:end", { turnId, status: "failed", messageId: null });
    }
    stream.turns.clear();
  }

  /** 통화가 끝나면 그 세션의 스트림을 모두 닫는다 (LiveSessionService.finish) */
  closeSession(sessionId: string): void {
    for (const stream of [...this.streams.values()]) if (stream.sessionId === sessionId) this.closeStream(stream);
  }

  /** 실시간 연결이 끊기면 그 연결이 연 스트림을 닫는다 (앱은 다시 연결한 뒤 새로 연다) */
  closeSocket(socketId: string): void {
    for (const stream of [...this.streams.values()]) if (stream.socketId === socketId) this.closeStream(stream);
  }

  dispose(): void {
    for (const stream of [...this.streams.values()]) this.closeStream(stream);
  }
}
