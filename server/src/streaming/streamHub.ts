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

// 스트리밍 통역 허브 (docs/streaming-plan.md 3·4절). 1:1 통화 + 현장 전체 연결(2026-10-27). 일괄 지시는 발화 단위 방식 유지 (2026-10-12 결정).
//   stream:open  → 세션·권한 확인(기존 utteranceTarget 규칙) → 듣는 사람의 언어마다 "레인"(엔진 연결 1개 또는 같은 언어 직접 전달)
//                  1:1 은 레인 1개, 현장 전체 연결은 다른 참여자들의 언어 수만큼 (참여자가 들어오고 나가면 groupChanged 로 레인을 맞춘다)
//   stream:audio → 노이즈 필터(말하는 사람마다 1번) → 레인마다 표본률 변환 → 엔진. 엔진이 말 끝을 감지하면 턴 시작
//   엔진 출력 → 그 레인의 듣는 사람들에게 stream:out:start/audio/text/end, 턴이 끝나면 기록 저장(persistTurn) + 직전 턴 텍스트 문맥 갱신
//     말한 사람의 자막(stream:mine:*)과 말한 사람이 보는 기록은 대표 레인 1개만 (한 문장이 언어 수만큼 겹쳐 보이지 않게)
//   엔진이 끊기면 진행 중 턴 실패 → 다시 연결. 짧은 시간에 반복되거나 다시 못 열면 stream:fallback (P6)
//   반이중 메아리 차단 (2026-10-19 실기기: 스피커로 들은 통역이 마이크로 다시 들어가 내 다음 말에 섞임):
//     X 의 단말이 재생 중(+ 꼬리 echoGuardMs)인 동안 X 가 보낸 조각은 버린다 — 통역 레인에는
//     같은 길이의 무음을 넣고(서버 VAD 가 재생 전에 하던 말을 끝낼 수 있게), 같은 언어 직접 전달은 그냥 버린다.
//     "재생 중" 판단: 앱이 stream:playing 을 보낸 스트림은 그 신호(실제 재생 시작/끝)만 쓰고, 한 번도 안 보낸 스트림(옛 앱)은
//     서버 추정(stream:out:start ~ stream:out:end)을 쓴다 — 서버 추정은 폰의 실제 재생(네트워크 + 지터 버퍼)보다 이르다
//     현장 전체 연결은 방 전체 반이중: 누구의 단말이든 재생 중이면 모두의 조각을 버린다 (폰들이 가까이 있으면 옆 폰 스피커가
//     내 마이크로 들어가 통역이 끝없이 되돌아온다 — 2026-10-27 사용자: 휴대폰 3대가 붙어 있음)

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
  /** 동시에 열 수 있는 엔진 연결(통역 레인) 수 (넘으면 BUSY → 앱은 발화 단위 방식) */
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

/** 앱이 연 스트림 1개 = 말하는 사람 1명 × 세션 1개 */
type Stream = {
  id: string;
  sessionId: string;
  siteId: string;
  conversationId: string | null;
  speakerId: string;
  /** 현장 전체 연결 (방 전체 반이중, 참여자가 바뀌면 레인을 맞춘다) */
  group: boolean;
  /** 이 스트림을 연 실시간 연결 (그 연결이 끊기면 닫는다) */
  socketId: string;
  sourceLang: Lang;
  sampleRate: number;
  closed: boolean;
  lastSeq: number;
  gaps: number;
  /** 메아리 차단으로 버린 조각 수 (앱 신호·서버 추정 모두) */
  echoDropped: number;
  /** 앱이 알린 내 단말 재생 상태 (stream:playing). null = 한 번도 안 알림 → 서버 추정을 쓴다 */
  appPlaying: boolean | null;
  /** 앱이 재생 끝을 알린 뒤 꼬리 echoGuardMs 가 끝나는 시각 */
  appGuardUntil: number;
  /** 서버 노이즈 필터 (2026-10-14 결정, passthrough 면 그대로). 레인이 여러 개여도 1번만 거친다 */
  filter: SafeStreamFilter;
  /** 대상 언어별 레인 */
  lanes: Map<Lang, Lane>;
};

/** 대상 언어 1개: 엔진 연결 1개(통역) 또는 같은 언어 직접 전달 */
type Lane = {
  stream: Stream;
  targetLang: Lang;
  listenerIds: string[];
  /** 말한 사람의 자막·기록을 맡는 레인 (스트림마다 통역 레인 1개) */
  primary: boolean;
  resampler: LinearResampler;
  connection: StreamConnection | null;
  reconnecting: boolean;
  closed: boolean;
  /** 아직 턴이 되지 않은 입력 음성 (기록용) */
  pendingInput: Buffer[];
  pendingBytes: number;
  turns: Map<string, TurnState>;
  history: ContextLine[];
  failures: number[];
  /** 같은 언어: OpenAI 없이 받은 음성을 그대로 듣는 사람에게 보낸다 (2026-10-13 결정) */
  relay: boolean;
  relayTurn: { id: string; seq: number } | null;
  relayTimer: NodeJS.Timeout | null;
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

  /** 열린 스트림(말하는 사람) 수 */
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
    const group = target.kind === "group";
    if (!group && (target.kind !== "direct" || target.recipientIds.length !== 1)) return { ok: false, code: "UNSUPPORTED" };
    const langs = await siteLangs(this.ctx.prisma, target.siteId, [userId, ...target.recipientIds]);
    // 마지막 await 뒤: 권한 확인 이후 이 세션이 끝났으면 등록하지 않는다 (여기서 등록(streams.set)까지는 await 가 없다)
    if (pending.revoked) return { ok: false, code: "CONFLICT" };
    const sourceLang = langs.get(userId)!;
    const plan = planLanes(sourceLang, target.recipientIds, langs);
    // 같은 언어끼리는 통역 없이 음성을 그대로 전달한다 (OpenAI 를 쓰지 않으므로 엔진·상한과 무관)
    const interpretLanes = [...plan.keys()].filter((lang) => lang !== sourceLang).length;
    if (interpretLanes > 0 && !this.engine) return { ok: false, code: "ENGINE_UNAVAILABLE" };

    // 같은 사람이 같은 세션에 다시 열면(재연결) 이전 스트림을 닫는다
    for (const stream of this.streams.values()) {
      if (stream.sessionId === sessionId && stream.speakerId === userId) this.closeStream(stream);
    }
    if (interpretLanes > 0 && this.engineLanes() + interpretLanes > this.options.maxStreams) return { ok: false, code: "BUSY" };

    const stream: Stream = {
      id: randomUUID(),
      sessionId,
      siteId: target.siteId,
      conversationId: target.conversationId,
      speakerId: userId,
      group,
      socketId,
      sourceLang,
      sampleRate: format.sampleRate,
      closed: false,
      lastSeq: -1,
      gaps: 0,
      echoDropped: 0,
      appPlaying: null,
      appGuardUntil: 0,
      filter: new SafeStreamFilter(
        this.ctx.streamAudioFilter,
        { siteId: target.siteId, userId, lang: sourceLang, sampleRate: format.sampleRate },
        this.options.filter,
        (reason, error) =>
          this.ctx.logger.warn({ err: error, sessionId, reason, filter: this.ctx.streamAudioFilter.name }, reason === "disabled" ? "스트리밍 노이즈 필터 끔 (연속 실패)" : "스트리밍 노이즈 필터 실패, 원본 조각 사용"),
      ),
      lanes: new Map(),
    };
    this.streams.set(stream.id, stream);
    for (const [lang, listenerIds] of plan) this.addLane(stream, lang, listenerIds);
    try {
      await Promise.all([...stream.lanes.values()].filter((lane) => !lane.relay).map((lane) => this.connectLane(lane)));
    } catch (error) {
      this.discard(stream);
      if (error instanceof BudgetExceededError) return { ok: false, code: "BUDGET_EXCEEDED" };
      this.ctx.logger.warn({ err: error, sessionId }, "스트리밍 엔진 열기 실패");
      return { ok: false, code: "ENGINE_UNAVAILABLE" };
    }
    if (stream.closed) {
      // 엔진을 여는 동안 닫혔으면(통화 종료 등) 방금 연 엔진 연결도 닫는다 (closeStream 때는 아직 연결이 없었다)
      for (const lane of stream.lanes.values()) {
        lane.connection?.close();
        lane.connection = null;
      }
      return { ok: false, code: "CONFLICT" };
    }
    const relayOnly = interpretLanes === 0;
    if (relayOnly) {
      this.ctx.logger.info({ sessionId, streamId: stream.id, lang: sourceLang, group }, "같은 언어 통화: 음성 직접 전달 시작");
      // 현장 전체 연결에 혼자 있을 때(레인 없음)도 여기 — 다른 언어 참여자가 들어오면 통역 레인이 생긴다
      if (!group || stream.lanes.size > 0) return { ok: true, streamId: stream.id, outputSampleRate: format.sampleRate, mode: "relay" };
    } else {
      this.ctx.logger.info({ sessionId, streamId: stream.id, sourceLang, targets: [...plan.keys()], group }, "스트리밍 통역 시작");
    }
    return { ok: true, streamId: stream.id, outputSampleRate: this.engine?.sampleRate ?? format.sampleRate, mode: "interpret" };
  }

  /** 엔진 연결을 쓰는 레인 수 (직접 전달은 세지 않는다) */
  private engineLanes(): number {
    let count = 0;
    for (const stream of this.streams.values()) for (const lane of stream.lanes.values()) if (!lane.relay) count++;
    return count;
  }

  private addLane(stream: Stream, targetLang: Lang, listenerIds: string[]): Lane {
    const relay = targetLang === stream.sourceLang;
    const lane: Lane = {
      stream,
      targetLang,
      listenerIds,
      // 말한 사람의 자막·기록은 통역 레인 하나가 맡는다 (같은 언어 직접 전달은 받아쓰기가 없다)
      primary: !relay && ![...stream.lanes.values()].some((other) => other.primary),
      resampler: new LinearResampler(stream.sampleRate, relay ? stream.sampleRate : this.engine!.sampleRate),
      connection: null,
      reconnecting: false,
      closed: false,
      pendingInput: [],
      pendingBytes: 0,
      turns: new Map(),
      history: [],
      failures: [],
      relay,
      relayTurn: null,
      relayTimer: null,
    };
    stream.lanes.set(targetLang, lane);
    return lane;
  }

  private async connectLane(lane: Lane): Promise<void> {
    const connection = await this.connect(lane);
    if (lane.closed) return connection.close();
    lane.connection = connection;
  }

  /** 열기 실패: 등록을 지우고 이미 연 필터·엔진 연결을 닫는다 (사이드카 연결이 남지 않게) */
  private discard(stream: Stream): void {
    stream.filter.close();
    this.streams.delete(stream.id);
    for (const lane of stream.lanes.values()) {
      lane.closed = true;
      lane.connection?.close();
      lane.connection = null;
    }
  }

  private connect(lane: Lane): Promise<StreamConnection> {
    const stream = lane.stream;
    return this.engine!.open({
      sourceLang: stream.sourceLang,
      targetLang: lane.targetLang,
      // 언어 쌍 기준 현장 용어집을 세션 지시문에 미리 넣는다 (2026-10-19, 발화 단위 방식과 같은 데이터셋)
      glossary: this.ctx.domain.streamGlossary(stream.sourceLang, lane.targetLang),
      events: {
        turnStart: (turnId) => this.onTurnStart(lane, turnId),
        audio: (turnId, pcm) => this.onAudio(lane, turnId, pcm),
        translationDelta: (turnId, text) => {
          const turn = lane.turns.get(turnId);
          if (!turn || lane.closed) return;
          turn.translation += text;
          this.toListeners(lane, "stream:out:text", { turnId, kind: "translation", text });
          if (lane.primary) this.emit.toUser(stream.speakerId, "stream:mine:text", { sessionId: stream.sessionId, turnId, kind: "translation", text });
        },
        originalDelta: (turnId, text) => {
          // 받아쓰는 중 글자는 말한 사람에게만 (듣는 사람은 완성본만). 전사 세션 조각은 번역 응답(turnStart)보다 먼저 올 수 있다
          if (lane.closed || !lane.primary) return;
          this.emit.toUser(stream.speakerId, "stream:mine:text", { sessionId: stream.sessionId, turnId, kind: "original_partial", text });
        },
        original: (turnId, text) => {
          const turn = lane.turns.get(turnId);
          if (!turn || lane.closed) return;
          turn.original = text;
          this.toListeners(lane, "stream:out:text", { turnId, kind: "original", text });
          if (lane.primary) this.emit.toUser(stream.speakerId, "stream:mine:text", { sessionId: stream.sessionId, turnId, kind: "original", text });
        },
        turnEnd: (turnId, result) => void this.onTurnEnd(lane, turnId, result),
        closed: (reason) => void this.onEngineClosed(lane, reason),
      },
    });
  }

  private toListeners(lane: Lane, event: "stream:out:text", payload: { turnId: string; kind: "original" | "translation"; text: string }): void;
  private toListeners(lane: Lane, event: "stream:out:audio", payload: { turnId: string; seq: number; pcm: Buffer }): void;
  private toListeners(lane: Lane, event: "stream:out:text" | "stream:out:audio", payload: unknown): void {
    for (const userId of lane.listenerIds) this.emit.toUser(userId, event as "stream:out:text", payload as never);
  }

  // ─── 현장 전체 연결: 참여자 변화 ─────────────────────

  /**
   * 현장 전체 연결의 참여자가 바뀌었을 때 (LiveSessionService): 말하는 사람마다 레인을 지금 참여자에 맞춘다.
   * 새 언어면 통역 레인을 열고(상한을 넘거나 열지 못하면 그 언어만 빠진다 — 다른 언어는 계속), 아무도 안 듣는 언어의 레인은 닫는다.
   */
  async groupChanged(sessionId: string, participants: { userId: string; lang: Lang }[]): Promise<void> {
    const langs = new Map(participants.map((p) => [p.userId, p.lang]));
    for (const stream of [...this.streams.values()]) {
      if (stream.sessionId !== sessionId || !stream.group || stream.closed) continue;
      if (!langs.has(stream.speakerId)) {
        this.closeStream(stream);
        continue;
      }
      const plan = planLanes(stream.sourceLang, [...langs.keys()].filter((id) => id !== stream.speakerId), langs);
      for (const [lang, lane] of [...stream.lanes]) {
        if (plan.has(lang)) continue;
        this.closeLane(lane);
        stream.lanes.delete(lang);
      }
      const opening: Lane[] = [];
      for (const [lang, listenerIds] of plan) {
        const lane = stream.lanes.get(lang);
        if (lane) {
          lane.listenerIds = listenerIds;
          continue;
        }
        if (lang !== stream.sourceLang && (!this.engine || this.engineLanes() >= this.options.maxStreams)) {
          this.ctx.logger.warn({ sessionId, lang }, "현장 전체 연결: 통역 레인을 열 수 없음 (엔진 없음·상한)");
          continue;
        }
        opening.push(this.addLane(stream, lang, listenerIds));
      }
      // 대표 레인이 닫혔으면 남은 통역 레인 하나가 맡는다
      if (![...stream.lanes.values()].some((lane) => lane.primary)) {
        const next = [...stream.lanes.values()].find((lane) => !lane.relay);
        if (next) next.primary = true;
      }
      await Promise.all(
        opening
          .filter((lane) => !lane.relay)
          .map((lane) =>
            this.connectLane(lane).catch((error: unknown) => {
              this.ctx.logger.warn({ err: error, sessionId, lang: lane.targetLang }, "현장 전체 연결: 통역 레인 열기 실패");
              this.closeLane(lane);
              if (stream.lanes.get(lane.targetLang) === lane) stream.lanes.delete(lane.targetLang);
            }),
          ),
      );
    }
  }

  // ─── 입력 ─────────────────────────────────────────

  audio(userId: string, streamId: string, seq: number, pcm: Buffer): void {
    const stream = this.streams.get(streamId);
    // 다른 사람의 스트림·닫힌 스트림·이미 받은 순번은 무시한다
    if (!stream || stream.speakerId !== userId || stream.closed || seq <= stream.lastSeq) return;
    if (seq !== stream.lastSeq + 1 && stream.lastSeq >= 0) stream.gaps += seq - stream.lastSeq - 1;
    stream.lastSeq = seq;
    // 반이중 메아리 차단: 이 사람의 단말(현장 전체 연결이면 방의 누구든)이 재생 중(+ 꼬리 echoGuardMs)이면 조각을 버린다.
    // 통역 레인에는 버리는 대신 같은 길이의 무음을 (필터를 거치지 않고, 순서는 유지해) 넣는다 — 그래야 재생 전에 말하던 턴의
    // 말 끝 무음이 서버 VAD 에 닿아 턴이 끝난다. 그냥 버리면 그 말이 끝나지 않고 다음 말과 붙어 모두 사라진다 (2026-10-19 실제 OpenAI 확인)
    if (this.isEchoing(stream)) {
      stream.echoDropped += 1;
      stream.filter.after(() => this.ingest(stream, Buffer.alloc(pcm.length), true));
      return;
    }
    // 서버 노이즈 필터 → (같은 언어) 그대로 전달 / (통역) 표본률 변환 후 엔진
    stream.filter.push(pcm, (frame) => this.ingest(stream, frame, false));
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

  /** 이 스트림의 조각을 메아리로 봐야 하는가 */
  private isEchoing(stream: Stream): boolean {
    if (stream.group) return this.roomPlaying(stream.sessionId);
    return this.devicePlaying(stream);
  }

  /** 이 사람의 단말이 재생 중인가: 앱 신호가 있으면 그것(재생 중 또는 꼬리), 없으면 서버 추정 */
  private devicePlaying(stream: Stream): boolean {
    if (stream.appPlaying !== null) return stream.appPlaying || Date.now() < stream.appGuardUntil;
    return this.isPlayingTo(stream.speakerId);
  }

  /** 현장 전체 연결: 방의 누구든 단말에서 통역이 나오고 있는가 (말하는 사람은 앱 신호, 듣기만 하는 사람은 서버 추정) */
  private roomPlaying(sessionId: string): boolean {
    const others = new Set<string>();
    for (const stream of this.streams.values()) {
      if (stream.sessionId !== sessionId) continue;
      if (this.devicePlaying(stream)) return true;
      for (const lane of stream.lanes.values()) for (const userId of lane.listenerIds) others.add(userId);
    }
    for (const userId of others) if (this.isPlayingTo(userId)) return true;
    return false;
  }

  // ─── 메아리 차단 (반이중, 서버 추정) ─────────────────
  // stream:out:start 를 보낼 때 playbackStarted, stream:out:end 를 보낼 때 playbackEnded. 모든 start/end 는 이 두 곳을 거친다.
  // 앱이 stream:playing 을 보내는 스트림에서는 참고하지 않는다 (devicePlaying).

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

  /** 필터를 거친 조각을 레인마다 넣는다. silence = 메아리 차단으로 바꾼 무음 (직접 전달은 보내지 않는다) */
  private ingest(stream: Stream, pcm: Buffer, silence: boolean): void {
    if (stream.closed) return;
    for (const lane of stream.lanes.values()) {
      if (lane.closed) continue;
      if (lane.relay) {
        if (!silence) this.relayAudio(lane, pcm);
        continue;
      }
      const converted = lane.resampler.push(pcm);
      if (converted.length === 0) continue;
      lane.pendingInput.push(converted);
      lane.pendingBytes += converted.length;
      const maxBytes = this.options.maxTurnSeconds * (this.engine?.sampleRate ?? 24_000) * 2;
      while (lane.pendingBytes > maxBytes && lane.pendingInput.length > 1) lane.pendingBytes -= lane.pendingInput.shift()!.length;
      lane.connection?.append(converted);
    }
  }

  pause(userId: string, streamId: string): void {
    const stream = this.streams.get(streamId);
    if (!stream || stream.speakerId !== userId || stream.closed) return;
    // stream:pause = 단말이 보내기를 멈췄다는 뜻. 통역 레인의 말 끝은 엔진(서버 VAD)만 정한다 — 수동 commit 은 보내지 않는다
    // (수동 commit 은 OpenAI 세션의 VAD 를 멈춰 뒤의 말이 모두 사라졌다 — 2026-10-19 실측). 대신 실제로 소리가 끊긴 만큼 무음을
    // 엔진에 넣어 서버 VAD 가 말 끝을 확실히 보게 한다 (필터 처리 중인 조각 뒤에, 순서 유지). 같은 언어 직접 전달은 턴을 닫는다
    const bytes = Math.round((stream.sampleRate * this.options.pauseSilenceMs) / 1000) * 2;
    stream.filter.after(() => {
      if (stream.closed) return;
      for (const lane of stream.lanes.values()) if (lane.relay && !lane.closed) this.endRelayTurn(lane);
      if (bytes > 0) this.ingest(stream, Buffer.alloc(bytes), true);
    });
  }

  // ─── 같은 언어: 직접 전달 ───────────────────────────
  // 단말이 말소리 구간만 보내므로, 조각이 오기 시작하면 턴 시작, stream:pause 또는 조각이 끊기면 턴 끝.
  // 통역·전사가 없으므로 기록(메시지)은 남기지 않는다.

  private relayAudio(lane: Lane, pcm: Buffer): void {
    const stream = lane.stream;
    if (!lane.relayTurn) {
      lane.relayTurn = { id: randomUUID(), seq: 0 };
      for (const userId of lane.listenerIds) {
        this.playbackStarted(userId, lane.relayTurn.id);
        this.emit.toUser(userId, "stream:out:start", {
          sessionId: stream.sessionId,
          turnId: lane.relayTurn.id,
          fromUserId: stream.speakerId,
          lang: stream.sourceLang,
          sampleRate: stream.sampleRate,
        });
      }
    }
    const turn = lane.relayTurn;
    this.toListeners(lane, "stream:out:audio", { turnId: turn.id, seq: turn.seq++, pcm });
    if (lane.relayTimer) clearTimeout(lane.relayTimer);
    lane.relayTimer = setTimeout(() => this.endRelayTurn(lane), this.options.relayIdleMs);
  }

  private endRelayTurn(lane: Lane): void {
    if (lane.relayTimer) clearTimeout(lane.relayTimer);
    lane.relayTimer = null;
    const turn = lane.relayTurn;
    lane.relayTurn = null;
    if (!turn) return;
    for (const userId of lane.listenerIds) {
      this.emit.toUser(userId, "stream:out:end", { turnId: turn.id, status: "done", messageId: null });
      this.playbackEnded(userId, turn.id);
    }
  }

  close(userId: string, streamId: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream || stream.speakerId !== userId) return false;
    this.closeStream(stream);
    return true;
  }

  // ─── 엔진 출력 ─────────────────────────────────────

  private onTurnStart(lane: Lane, turnId: string): void {
    if (lane.closed) return;
    const input = Buffer.concat(lane.pendingInput);
    lane.pendingInput = [];
    lane.pendingBytes = 0;
    lane.turns.set(turnId, { id: turnId, seq: 0, output: [], input, translation: "", original: null, startedAt: Date.now(), firstAudioAt: null });
    for (const userId of lane.listenerIds) {
      this.playbackStarted(userId, turnId);
      this.emit.toUser(userId, "stream:out:start", {
        sessionId: lane.stream.sessionId,
        turnId,
        fromUserId: lane.stream.speakerId,
        lang: lane.targetLang,
        sampleRate: this.engine!.sampleRate,
      });
    }
  }

  private onAudio(lane: Lane, turnId: string, pcm: Buffer): void {
    const turn = lane.turns.get(turnId);
    if (!turn || lane.closed) return;
    turn.firstAudioAt ??= Date.now();
    turn.output.push(pcm);
    this.toListeners(lane, "stream:out:audio", { turnId, seq: turn.seq++, pcm });
  }

  private async onTurnEnd(lane: Lane, turnId: string, result: TurnEnd): Promise<void> {
    const stream = lane.stream;
    const turn = lane.turns.get(turnId);
    lane.turns.delete(turnId);
    if (!turn || lane.closed) {
      if (turn) this.endTurn(lane, turnId, "failed", null);
      return;
    }
    if (result.status === "failed") {
      this.ctx.logger.warn({ sessionId: stream.sessionId, turnId, code: result.code }, "스트리밍 턴 실패");
      this.endTurn(lane, turnId, "failed", null);
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
        recipientIds: lane.listenerIds,
        hiddenFromSender: !lane.primary,
        sourceLang: stream.sourceLang,
        targetLang: lane.targetLang,
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
    this.endTurn(lane, turnId, "done", saved?.messageId ?? null);
    await saved?.notify().catch((error: unknown) => this.ctx.logger.warn({ err: error, turnId }, "스트리밍 턴 기록 알림 실패"));
    const original = (result.original ?? turn.original)?.trim();
    if (original) {
      lane.history = [...lane.history, { original, translation: result.translation }].slice(-2);
      lane.connection?.setContext(lane.history);
    }
  }

  /** 통역 턴 끝: 듣는 사람(stream:out:end)과 말한 사람(stream:mine:end, 대표 레인만) 모두에게 */
  private endTurn(lane: Lane, turnId: string, status: "done" | "failed", messageId: string | null): void {
    for (const userId of lane.listenerIds) {
      this.emit.toUser(userId, "stream:out:end", { turnId, status, messageId });
      this.playbackEnded(userId, turnId);
    }
    if (lane.primary) this.emit.toUser(lane.stream.speakerId, "stream:mine:end", { sessionId: lane.stream.sessionId, turnId, status });
  }

  /** 엔진 연결이 예기치 않게 끝남: 진행 중 턴은 엔진이 실패로 닫았다. 다시 연결하거나 폴백 */
  private async onEngineClosed(lane: Lane, reason: "error" | "budget"): Promise<void> {
    const stream = lane.stream;
    if (lane.closed) return;
    lane.connection = null;
    for (const turnId of lane.turns.keys()) this.endTurn(lane, turnId, "failed", null);
    lane.turns.clear();
    if (reason === "budget") return this.fallback(stream, "BUDGET_EXCEEDED");
    const now = Date.now();
    lane.failures = [...lane.failures.filter((at) => now - at < this.options.failureWindowMs), now];
    if (lane.failures.length >= 2) return this.fallback(stream, "ENGINE_FAILED");
    this.ctx.logger.warn({ sessionId: stream.sessionId, streamId: stream.id, lang: lane.targetLang }, "스트리밍 엔진 끊김, 다시 연결");
    lane.reconnecting = true;
    try {
      const connection = await this.connect(lane);
      lane.reconnecting = false;
      if (lane.closed) return connection.close();
      lane.connection = connection;
      if (lane.history.length > 0) connection.setContext(lane.history);
    } catch (error) {
      lane.reconnecting = false;
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

  private closeLane(lane: Lane): void {
    if (lane.closed) return;
    if (lane.relay) this.endRelayTurn(lane);
    lane.closed = true;
    lane.connection?.close();
    lane.connection = null;
    // 듣는 사람·말한 사람 화면에 진행 중 턴이 남지 않게 닫는다
    for (const turnId of lane.turns.keys()) this.endTurn(lane, turnId, "failed", null);
    lane.turns.clear();
  }

  private closeStream(stream: Stream): void {
    if (stream.closed) return;
    stream.closed = true;
    stream.filter.close();
    // 입력 통계: 필터가 실제로 쓰였는지 (filtered = 필터 결과를 쓴 조각, failed = 원본을 쓴 조각), 메아리 차단으로 버린 조각(echoDropped), 빠진 순번(gaps)
    this.ctx.logger.info(
      {
        sessionId: stream.sessionId,
        streamId: stream.id,
        relay: [...stream.lanes.values()].every((lane) => lane.relay),
        lanes: stream.lanes.size,
        filter: this.ctx.streamAudioFilter.name,
        ...stream.filter.stats,
        echoDropped: stream.echoDropped,
        gaps: stream.gaps,
      },
      "스트리밍 노이즈 필터·메아리 차단 결과",
    );
    this.streams.delete(stream.id);
    for (const lane of stream.lanes.values()) this.closeLane(lane);
  }

  /** 통화가 끝나면 그 세션의 스트림을 모두 닫는다 (LiveSessionService.finish). 아직 등록 전인 열기도 막는다 */
  closeSession(sessionId: string): void {
    for (const pending of this.pendingOpens) if (pending.sessionId === sessionId) pending.revoked = true;
    for (const stream of [...this.streams.values()]) if (stream.sessionId === sessionId) this.closeStream(stream);
  }

  /** 현장 전체 연결에서 나간 사람의 스트림을 닫는다 (다른 사람들의 레인은 groupChanged 가 맞춘다) */
  closeSpeaker(sessionId: string, userId: string): void {
    for (const stream of [...this.streams.values()]) if (stream.sessionId === sessionId && stream.speakerId === userId) this.closeStream(stream);
  }

  /** 실시간 연결이 끊기면 그 연결이 연 스트림을 닫는다 (앱은 다시 연결한 뒤 새로 연다) */
  closeSocket(socketId: string): void {
    for (const stream of [...this.streams.values()]) if (stream.socketId === socketId) this.closeStream(stream);
  }

  dispose(): void {
    for (const stream of [...this.streams.values()]) this.closeStream(stream);
  }
}

/** 듣는 사람들을 언어별로 묶는다 (레인 계획). 언어 순서는 정렬해서 대표 레인이 매번 같게 */
function planLanes(_sourceLang: Lang, listenerIds: string[], langs: Map<string, Lang>): Map<Lang, string[]> {
  const plan = new Map<Lang, string[]>();
  for (const userId of listenerIds) {
    const lang = langs.get(userId);
    if (!lang) continue;
    plan.set(lang, [...(plan.get(lang) ?? []), userId]);
  }
  return new Map([...plan].sort(([a], [b]) => a.localeCompare(b)));
}
