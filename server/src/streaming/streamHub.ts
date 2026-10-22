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
//   반이중 메아리 차단 (2026-10-19 실기기: 스피커로 들은 통역이 마이크로 다시 들어가 내 다음 말에 섞임):
//     X 의 단말이 재생 중(+ 꼬리 echoGuardMs)인 동안 X 가 보낸 조각은 버린다 — 통역 스트림은
//     같은 길이의 무음으로 바꿔 엔진에 넣고(서버 VAD 가 재생 전에 하던 말을 끝낼 수 있게), 같은 언어 직접 전달은 그냥 버린다.
//     "재생 중" 판단: 앱이 stream:playing 을 보낸 스트림은 그 신호(실제 재생 시작/끝)만 쓰고, 한 번도 안 보낸 스트림(옛 앱)은
//     서버 추정(stream:out:start ~ stream:out:end)을 쓴다 — 서버 추정은 폰의 실제 재생(네트워크 + 지터 버퍼)보다 이르다

export type StreamEmitter = {
  toUser(userId: string, event: "stream:out:start", payload: StreamTurnStart): void;
  toUser(userId: string, event: "stream:out:audio", payload: { turnId: string; seq: number; pcm: Buffer }): void;
  toUser(userId: string, event: "stream:out:text", payload: { turnId: string; kind: "original" | "translation"; text: string }): void;
  toUser(userId: string, event: "stream:out:end", payload: { turnId: string; status: "done" | "failed"; messageId: string | null }): void;
  toUser(userId: string, event: "stream:mine:text", payload: { sessionId: string; turnId: string; kind: "original" | "original_partial" | "translation"; text: string }): void;
  toUser(userId: string, event: "stream:mine:end", payload: { sessionId: string; turnId: string; status: "done" | "failed" }): void;
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
  /** 메아리 차단: 상대 턴 재생이 끝난 뒤에도 이 시간 동안은 내 조각을 버린다 (스피커 → 마이크 잔향·재생 지연) */
  echoGuardMs: number;
  /** 통역 스트림: stream:pause(단말이 보내기를 멈춤) 때 엔진에 넣는 무음 길이. 서버 VAD 는 받은 소리만 보고 무음 500ms 를 세므로,
   *  단말이 말 끝 뒤 0.6초만 보내고 멈추면 실제로는 3초를 쉬어도 그 꼬리의 잡음 때문에 다음 말과 한 턴으로 붙는다 (2026-10-23 Note 9 스피커) */
  pauseSilenceMs: number;
};

export const DEFAULT_STREAM_HUB_OPTIONS: StreamHubOptions = {
  enabled: true,
  maxStreams: 4,
  failureWindowMs: 60_000,
  maxTurnSeconds: 35,
  relayIdleMs: 1_000,
  filter: DEFAULT_STREAM_FILTER_OPTIONS,
  echoGuardMs: 300,
  pauseSilenceMs: 700,
};

/** 사용자 1명에게 재생 중인 턴들과, 마지막 턴이 끝난 뒤 차단이 풀리는 시각 */
type Playback = { turns: Set<string>; guardUntil: number };

/** 진행 중인 열기(open) 1건. 그사이 그 세션이 끝나면(closeSession) revoked */
type PendingOpen = { sessionId: string; revoked: boolean };

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
  /** 메아리 차단으로 버린 조각 수 (앱 신호·서버 추정 모두) */
  echoDropped: number;
  /** 앱이 알린 내 단말 재생 상태 (stream:playing). null = 한 번도 안 알림 → 서버 추정을 쓴다 */
  appPlaying: boolean | null;
  /** 앱이 재생 끝을 알린 뒤 꼬리 echoGuardMs 가 끝나는 시각 */
  appGuardUntil: number;
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
  /** 듣는 사람(userId)별 재생 상태 — 메아리 차단 판단용 */
  private readonly playback = new Map<string, Playback>();
  /** 진행 중인 열기들 — closeSession 은 등록된 스트림만 닫으므로, 권한 확인과 등록 사이에 끝난 세션은 이 표시로 막는다 */
  private readonly pendingOpens = new Set<PendingOpen>();
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
    // 권한 확인(await)과 등록 사이에 통화가 끝나거나 멤버에서 제외되면(finish → closeSession) 이 표시로 알아채고 등록하지 않는다.
    // 표시는 열기가 끝나면 지운다 (진행 중인 열기 수만큼만 남는다)
    const pending: PendingOpen = { sessionId, revoked: false };
    this.pendingOpens.add(pending);
    try {
      return await this.openStream(pending, userId, socketId, sessionId, format);
    } finally {
      this.pendingOpens.delete(pending);
    }
  }

  private async openStream(pending: PendingOpen, userId: string, socketId: string, sessionId: string, format: StreamFormat): Promise<StreamOpenResult> {
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
    // 마지막 await 뒤: 권한 확인 이후 이 세션이 끝났으면 등록하지 않는다 (여기서 등록(streams.set)까지는 await 가 없다)
    if (pending.revoked) return { ok: false, code: "CONFLICT" };
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
      echoDropped: 0,
      appPlaying: null,
      appGuardUntil: 0,
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
    if (stream.closed) {
      // 엔진을 여는 동안 닫혔으면(통화 종료 등) 방금 연 엔진 연결도 닫는다 (closeStream 때는 아직 연결이 없었다)
      stream.connection?.close();
      stream.connection = null;
      return { ok: false, code: "CONFLICT" };
    }
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
      // 언어 쌍 기준 현장 용어집을 세션 지시문에 미리 넣는다 (2026-10-19, 발화 단위 방식과 같은 데이터셋)
      glossary: this.ctx.domain.streamGlossary(stream.sourceLang, stream.targetLang),
      events: {
        turnStart: (turnId) => this.onTurnStart(stream, turnId),
        audio: (turnId, pcm) => this.onAudio(stream, turnId, pcm),
        translationDelta: (turnId, text) => {
          const turn = stream.turns.get(turnId);
          if (!turn || stream.closed) return;
          turn.translation += text;
          this.emit.toUser(stream.listenerId, "stream:out:text", { turnId, kind: "translation", text });
          this.emit.toUser(stream.speakerId, "stream:mine:text", { sessionId: stream.sessionId, turnId, kind: "translation", text });
        },
        originalDelta: (turnId, text) => {
          // 받아쓰는 중 글자는 말한 사람에게만 (듣는 사람은 완성본만). 전사 세션 조각은 번역 응답(turnStart)보다 먼저 올 수 있다
          if (stream.closed) return;
          this.emit.toUser(stream.speakerId, "stream:mine:text", { sessionId: stream.sessionId, turnId, kind: "original_partial", text });
        },
        original: (turnId, text) => {
          const turn = stream.turns.get(turnId);
          if (!turn || stream.closed) return;
          turn.original = text;
          this.emit.toUser(stream.listenerId, "stream:out:text", { turnId, kind: "original", text });
          this.emit.toUser(stream.speakerId, "stream:mine:text", { sessionId: stream.sessionId, turnId, kind: "original", text });
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
    // 반이중 메아리 차단: 이 사람의 단말이 상대 턴을 재생 중(+ 꼬리 echoGuardMs)이면 조각을 버린다 (스피커 소리가 마이크로 되돌아온 것).
    // 통역 스트림은 버리는 대신 같은 길이의 무음을 (필터를 거치지 않고, 순서는 유지해) 엔진에 넣는다 — 그래야 재생 전에 말하던 턴의
    // 말 끝 무음이 서버 VAD 에 닿아 턴이 끝난다. 그냥 버리면 그 말이 끝나지 않고 다음 말과 붙어 모두 사라진다 (2026-10-19 실제 OpenAI 확인)
    if (this.isEchoing(stream)) {
      stream.echoDropped += 1;
      if (!stream.relay) stream.filter.after(() => this.ingest(stream, Buffer.alloc(pcm.length)));
      return;
    }
    // 서버 노이즈 필터 → (같은 언어) 그대로 전달 / (통역) 표본률 변환 후 엔진
    stream.filter.push(pcm, (frame) => this.ingest(stream, frame));
  }

  /** 스트림의 입력 통계 (시험·진단용) */
  stats(streamId: string): { echoDropped: number; inputGaps: number } | null {
    const stream = this.streams.get(streamId);
    return stream ? { echoDropped: stream.echoDropped, inputGaps: stream.gaps } : null;
  }

  /** 앱이 알린 내 단말의 실제 재생 시작/끝 (stream:playing). 이 뒤로 이 스트림은 서버 추정 대신 이 신호만 쓴다 */
  playing(userId: string, streamId: string, playing: boolean): void {
    const stream = this.streams.get(streamId);
    if (!stream || stream.speakerId !== userId || stream.closed) return;
    if (stream.appPlaying === true && !playing) stream.appGuardUntil = Date.now() + this.options.echoGuardMs;
    stream.appPlaying = playing;
  }

  /** 이 스트림의 조각을 메아리로 봐야 하는가: 앱 신호가 있으면 그것(재생 중 또는 꼬리), 없으면 서버 추정 */
  private isEchoing(stream: Stream): boolean {
    if (stream.appPlaying !== null) return stream.appPlaying || Date.now() < stream.appGuardUntil;
    return this.isPlayingTo(stream.speakerId);
  }

  // ─── 메아리 차단 (반이중, 서버 추정) ─────────────────
  // stream:out:start 를 보낼 때 playbackStarted, stream:out:end 를 보낼 때 playbackEnded. 모든 start/end 는 이 두 곳을 거친다.
  // 앱이 stream:playing 을 보내는 스트림에서는 참고하지 않는다 (isEchoing).

  private playbackStarted(userId: string, turnId: string): void {
    const entry = this.playback.get(userId) ?? { turns: new Set<string>(), guardUntil: 0 };
    entry.turns.add(turnId);
    this.playback.set(userId, entry);
  }

  private playbackEnded(userId: string, turnId: string): void {
    const entry = this.playback.get(userId);
    if (!entry) return;
    entry.turns.delete(turnId);
    if (entry.turns.size === 0) {
      entry.guardUntil = Date.now() + this.options.echoGuardMs;
      if (this.options.echoGuardMs <= 0) this.playback.delete(userId);
    }
  }

  /** 이 사람에게 턴을 재생 중이거나, 마지막 턴이 끝난 지 echoGuardMs 가 안 됐는가 */
  private isPlayingTo(userId: string): boolean {
    const entry = this.playback.get(userId);
    if (!entry) return false;
    if (entry.turns.size > 0) return true;
    if (Date.now() < entry.guardUntil) return true;
    this.playback.delete(userId);
    return false;
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
    // stream:pause = 단말이 보내기를 멈췄다는 뜻. 통역 스트림의 말 끝은 엔진(서버 VAD)만 정한다 — 수동 commit 은 보내지 않는다
    // (수동 commit 은 OpenAI 세션의 VAD 를 멈춰 뒤의 말이 모두 사라졌다 — 2026-10-19 실측). 대신 실제로 소리가 끊긴 만큼 무음을
    // 엔진에 넣어 서버 VAD 가 말 끝을 확실히 보게 한다 (필터 처리 중인 조각 뒤에, 순서 유지). 같은 언어 직접 전달은 턴을 닫는다
    if (!stream.relay) {
      const bytes = Math.round((stream.sampleRate * this.options.pauseSilenceMs) / 1000) * 2;
      if (bytes > 0) stream.filter.after(() => this.ingest(stream, Buffer.alloc(bytes)));
      return;
    }
    // 필터 처리 중인 조각이 모두 들어간 뒤에 턴을 닫는다
    stream.filter.after(() => {
      if (!stream.closed) this.endRelayTurn(stream);
    });
  }

  // ─── 같은 언어: 직접 전달 ───────────────────────────
  // 단말이 말소리 구간만 보내므로, 조각이 오기 시작하면 턴 시작, stream:pause 또는 조각이 끊기면 턴 끝.
  // 통역·전사가 없으므로 기록(메시지)은 남기지 않는다.

  private relayAudio(stream: Stream, pcm: Buffer): void {
    if (!stream.relayTurn) {
      stream.relayTurn = { id: randomUUID(), seq: 0 };
      this.playbackStarted(stream.listenerId, stream.relayTurn.id);
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
    if (!turn) return;
    this.emit.toUser(stream.listenerId, "stream:out:end", { turnId: turn.id, status: "done", messageId: null });
    this.playbackEnded(stream.listenerId, turn.id);
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
    this.playbackStarted(stream.listenerId, turnId);
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
      if (turn) this.endTurn(stream, turnId, "failed", null);
      return;
    }
    if (result.status === "failed") {
      this.ctx.logger.warn({ sessionId: stream.sessionId, turnId, code: result.code }, "스트리밍 턴 실패");
      this.endTurn(stream, turnId, "failed", null);
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
          echoDropped: stream.echoDropped,
        },
      });
    } catch (error) {
      this.ctx.logger.error({ err: error, sessionId: stream.sessionId, turnId }, "스트리밍 턴 기록 실패");
    }
    // 순서 중요: end(messageId) 를 먼저 보내고 기록 알림(message:new)을 보낸다 → 앱은 이미 들은 문장을 다시 재생하지 않는다
    this.endTurn(stream, turnId, "done", saved?.messageId ?? null);
    await saved?.notify().catch((error: unknown) => this.ctx.logger.warn({ err: error, turnId }, "스트리밍 턴 기록 알림 실패"));
    const original = (result.original ?? turn.original)?.trim();
    if (original) {
      stream.history = [...stream.history, { original, translation: result.translation }].slice(-2);
      stream.connection?.setContext(stream.history);
    }
  }

  /** 통역 턴 끝: 듣는 사람(stream:out:end)과 말한 사람(stream:mine:end) 모두에게 */
  private endTurn(stream: Stream, turnId: string, status: "done" | "failed", messageId: string | null): void {
    this.emit.toUser(stream.listenerId, "stream:out:end", { turnId, status, messageId });
    this.playbackEnded(stream.listenerId, turnId);
    this.emit.toUser(stream.speakerId, "stream:mine:end", { sessionId: stream.sessionId, turnId, status });
  }

  /** 엔진 연결이 예기치 않게 끝남: 진행 중 턴은 엔진이 실패로 닫았다. 다시 연결하거나 폴백 */
  private async onEngineClosed(stream: Stream, reason: "error" | "budget"): Promise<void> {
    if (stream.closed) return;
    stream.connection = null;
    for (const turnId of stream.turns.keys()) this.endTurn(stream, turnId, "failed", null);
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
    // 입력 통계: 필터가 실제로 쓰였는지 (filtered = 필터 결과를 쓴 조각, failed = 원본을 쓴 조각), 메아리 차단으로 버린 조각(echoDropped), 빠진 순번(gaps)
    this.ctx.logger.info(
      { sessionId: stream.sessionId, streamId: stream.id, relay: stream.relay, filter: this.ctx.streamAudioFilter.name, ...stream.filter.stats, echoDropped: stream.echoDropped, gaps: stream.gaps },
      "스트리밍 노이즈 필터·메아리 차단 결과",
    );
    this.streams.delete(stream.id);
    stream.connection?.close();
    stream.connection = null;
    // 듣는 사람·말한 사람 화면에 진행 중 턴이 남지 않게 닫는다
    for (const turnId of stream.turns.keys()) this.endTurn(stream, turnId, "failed", null);
    stream.turns.clear();
  }

  /** 통화가 끝나면 그 세션의 스트림을 모두 닫는다 (LiveSessionService.finish). 아직 등록 전인 열기도 막는다 */
  closeSession(sessionId: string): void {
    for (const pending of this.pendingOpens) if (pending.sessionId === sessionId) pending.revoked = true;
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
