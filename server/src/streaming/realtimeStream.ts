import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { Lang } from "../shared/languages";
import { BudgetExceededError, type BudgetGuard, type Reservation } from "../engine/budget/budgetGuard";
import type { UsageTokens } from "../engine/budget/pricing";
import { STT_PROMPT } from "../messaging/pipeline";
import type { StreamGlossary } from "../engine/domain/domainProcessor";
import {
  buildStreamInstructions,
  type ContextLine,
  type StreamConnection,
  type StreamEngine,
  type StreamEngineEvents,
  type StreamOpenOptions,
} from "./engine";

// OpenAI Realtime 스트리밍 엔진 (gpt-realtime-2.1, GA 인터페이스 — 2026-10-13 S0 측정 스크립트로 실제 확인한 설정).
//   - 화자 1명 × 대상 언어 1개당 **번역 세션**(conversation) WebSocket 1개를 통화 내내 연다
//   - server_vad(무음 500ms, 앞 300ms) + create_response, interrupt_response=false (이어 말해도 앞 번역을 끊지 않음)
//   - **말 끝은 서버 VAD 만 정한다.** 단말은 말이 멎은 뒤 ≥0.6초 무음까지 보내고, stream:pause 는 "보내기 중단" 뜻일 뿐이다.
//     수동 input_audio_buffer.commit 은 보내지 않는다 — 2026-10-19 실제 API 실측: 수동 commit 을 한 번 보내면 그 세션의
//     서버 VAD 가 다시는 speech_started 를 내지 않아 뒤의 말이 모두 조용히 사라진다. 수동 commit 없이 무음 ≥0.5초면
//     speech_stopped → committed → response.created 가 저절로 이어지고 여러 턴이 모두 된다 (말 끝 뒤 약 10ms 에 응답 시작)
//   - **전사 전용 세션 (2026-10-19, liveTranscription)**: 같은 음성을 `?intent=transcription` 세션(STT_MODEL, 같은 server_vad)에도
//     넣는다. 번역 세션의 입력 전사는 턴이 확정된 뒤에야 시작돼 말한 사람 자막이 말 끝 0.5–1.5초 뒤에 떴고 아예 안 오기도 했다
//     (실기기 2026-10-19). 전사 세션의 ...transcription.delta 를 originalDelta 로, 완성본을 original 로 올린다.
//     **실측(2026-10-19, gpt-4o-transcribe)**: 전사 세션도 조각을 턴 확정(speech_stopped→committed) 뒤에야 낸다 — 확정된 구간을
//     전사하면서 글자를 흘려보내는 것이라 말하는 도중에는 오지 않는다. 다만 번역 응답과 분리돼 첫 조각이 말 끝 0.07–0.40초,
//     완성본이 0.52–0.76초 뒤에 오고 4턴 모두 원문이 있었다 (전에는 0.5–1.5초·4턴 중 2턴 누락). 말하는 도중 자막은
//     OpenAI 문서의 gpt-live-transcribe(turn_detection 없이 연속 전사) 가 필요 — 모델·가격 결정 뒤 후속 (docs/streaming-plan.md 4-3절).
//     번역 세션의 audio.input.transcription 은 끈다 (받아쓰기를 2번 청구하지 않기 위해). 전사 세션을 못 열거나 끊기면 번역 세션
//     전사로 되돌아간다(예전 동작).
//   - 턴 = 엔진이 만든 id 로, 두 세션의 항목(item_id)을 **순서대로** 묶는다 (아래 "턴 짝짓기")
//   - 입력 전사(원문 기록) = STT_MODEL (기본 gpt-4o-transcribe), 출력 PCM16 24kHz 음성 + 자막
//   - 턴이 끝나면 세션 안 대화 항목을 모두 지우고(conversation.item.delete), 직전 1–2턴은 텍스트로 지시문에 넣는다 (P3)
//   - 언어 쌍 용어집(glossary)은 세션을 열 때 지시문 앞쪽에 고정 (2026-10-19, buildStreamInstructions)
//   - 비용: 열기 전 남은 한도 확인, 턴마다 예상치 예약 → response.done / 전사 completed 사용량으로 기록 (BudgetGuard)
//
// 턴 짝짓기 (전사 세션 ↔ 번역 세션): 두 세션은 같은 음성·같은 VAD 설정이라 같은 자리에서 말 끝을 낸다고 가정하고,
//   어느 세션이든 새 item_id 가 처음 보이면 "상대 세션 항목이 아직 안 붙은 가장 오래된 턴"에 붙이고, 없으면 새 턴을 만든다 (FIFO).
//   실패 모드: 한 세션만 말을 둘로 나누면(VAD 가 다르게 판단) 그 뒤 턴들의 원문이 하나씩 밀린다. 완화: 번역 세션 항목이 없는 전사 턴은
//   완성 뒤 ORIGINAL_WAIT_MS 안에 짝이 안 생기면 버리고, 전사가 없는 번역 턴은 응답 뒤 ORIGINAL_WAIT_MS 만 기다렸다 원문 없이 끝낸다.
//   (STREAM_DEBUG=1 로 두 세션의 이벤트를 모두 남겨 진단한다)
// 이벤트 이름·필드: docs/s0-report.md 1절, server/scripts/stream-measure.ts.

const URL_BASE = "wss://api.openai.com/v1/realtime";
const RATE = 24_000;
const OPEN_TIMEOUT_MS = 10_000;
/** 번역이 끝난 뒤 원문 전사를 기다리는 최대 시간 = 전사만 있고 번역 턴이 안 붙을 때 버리기까지의 시간 */
const ORIGINAL_WAIT_MS = 4_000;
/** 세션을 열 때 남아 있어야 하는 최소 한도 (말한 약 10초 분량) */
const MIN_REMAINING_USD = 0.03;

export type SessionKind = "conversation" | "transcription";

export type RealtimeStreamOptions = {
  apiKey: string;
  model: string;
  transcribeModel: string;
  voice: string;
  reasoning: "minimal" | "low" | "medium" | "high";
  silenceMs: number;
  budget: BudgetGuard;
  /** 전사 전용 세션을 열어 말하는 도중 원문 조각을 받는다 (기본 true). false 면 번역 세션이 전사까지 한다 (예전 동작) */
  liveTranscription?: boolean;
  /** 테스트용 엔드포인트 교체 */
  url?: string;
  log?: (message: string, detail?: Record<string, unknown>) => void;
  /** STREAM_DEBUG: 조각(delta)이 아닌 모든 서버 이벤트 + 턴마다 첫 전사 조각 (세션 종류 포함) */
  trace?: (session: SessionKind, type: string, detail: Record<string, unknown>) => void;
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

/** 전사 completed 의 사용량: tokens 형(gpt-4o-transcribe) 또는 duration 형(whisper) */
type SttUsage = {
  type?: "tokens" | "duration";
  seconds?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number };
};

type ServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  response_id?: string;
  item?: { id?: string };
  error?: { message?: string; code?: string };
  usage?: SttUsage;
  response?: { id?: string; status?: string; usage?: Usage; output?: { id?: string }[] };
};

/** response.done 사용량 → BudgetGuard 형식. 캐시된 입력은 종류별로 빼고 캐시 단가로 기록한다 */
export function realtimeUsage(usage: Usage | undefined): UsageTokens {
  const cached = usage?.input_token_details?.cached_tokens ?? 0;
  const cachedAudio = usage?.input_token_details?.cached_tokens_details?.audio_tokens ?? 0;
  const cachedText = Math.max(0, cached - cachedAudio);
  const outputAudio = usage?.output_token_details?.audio_tokens ?? 0;
  return {
    inputTextTokens: Math.max(0, (usage?.input_token_details?.text_tokens ?? 0) - cachedText),
    inputAudioTokens: Math.max(0, (usage?.input_token_details?.audio_tokens ?? 0) - cachedAudio),
    cachedInputTokens: cached,
    // 추론 토큰은 세부 항목에 없을 수 있어 전체 출력에서 음성을 뺀 나머지를 텍스트 단가로
    outputTextTokens: Math.max(usage?.output_token_details?.text_tokens ?? 0, (usage?.output_tokens ?? 0) - outputAudio),
    outputAudioTokens: outputAudio,
  };
}

export class RealtimeStreamEngine implements StreamEngine {
  readonly name = "openai-realtime-stream";
  readonly sampleRate = RATE;

  constructor(private readonly options: RealtimeStreamOptions) {}

  async open({ sourceLang, targetLang, events, glossary }: StreamOpenOptions): Promise<StreamConnection> {
    const status = await this.options.budget.status();
    if (status.remainingUsd < MIN_REMAINING_USD) {
      throw new BudgetExceededError(status.limitUsd, status.spentUsd, MIN_REMAINING_USD);
    }
    const connection = new RealtimeConnection(this.options, sourceLang, targetLang, events, glossary);
    await connection.ready;
    return connection;
  }
}

type Turn = {
  /** 엔진이 만든 턴 id (두 세션 항목을 묶는다. 앱·기록에 쓰는 turnId) */
  id: string;
  /** 번역 세션 입력 항목 (input_audio_buffer.committed) — 없으면 아직 번역 세션이 말 끝을 안 냈다 */
  convItemId: string | null;
  /** 전사 세션 입력 항목 — 없으면 전사 세션이 이 턴을 안 봤다 (전사 세션 없이 번역 세션이 전사하면 항상 null) */
  sttItemId: string | null;
  /** 이 턴에 들어간 입력 음성 길이 (예상 비용 계산용) */
  inputSeconds: number;
  responseId: string | null;
  started: boolean;
  translation: string;
  original: string | null;
  originalDone: boolean;
  /** 전사 completed 사용량 (예약이 늦게 잡혀도 기록할 수 있게 보관) */
  sttUsage: SttUsage | null | undefined;
  responseDone: boolean;
  responseStatus: string | null;
  itemIds: string[];
  reservation: Reservation | null;
  sttReservation: Reservation | null;
  /** 예약이 끝날 때까지 (응답이 예약보다 먼저 끝나도 사용량을 빠뜨리지 않기 위해 기다린다) */
  reserved: Promise<void>;
  cancelled: boolean;
  /** 응답 뒤 원문을 기다리는 시간 / 전사만 있는 턴이 짝을 기다리는 시간 */
  originalTimer: NodeJS.Timeout | null;
  firstDeltaSeen: boolean;
};

class RealtimeConnection implements StreamConnection {
  readonly ready: Promise<void>;
  private readonly ws: WebSocket;
  /** 전사 전용 세션 (liveTranscription 일 때만) */
  private stt: WebSocket | null = null;
  /** 전사 세션이 살아 있어 번역 세션의 전사를 끈 상태 */
  private sttAlive = false;
  private readonly turns = new Map<string, Turn>();
  private readonly byConvItem = new Map<string, Turn>();
  private readonly bySttItem = new Map<string, Turn>();
  /** 응답이 아직 안 붙은 확정 턴 (순서대로) */
  private readonly awaitingResponse: Turn[] = [];
  private readonly responseToTurn = new Map<string, Turn>();
  private bytesSinceCommit = 0;
  private context: ContextLine[] = [];
  private closedByUs = false;
  private failed = false;

  constructor(
    private readonly options: RealtimeStreamOptions,
    private readonly sourceLang: Lang,
    private readonly targetLang: Lang,
    private readonly events: StreamEngineEvents,
    private readonly glossary?: StreamGlossary,
  ) {
    const base = options.url ?? URL_BASE;
    const headers = { Authorization: `Bearer ${options.apiKey}` };
    const live = options.liveTranscription !== false;
    this.sttAlive = live;
    this.ws = new WebSocket(`${base}?model=${encodeURIComponent(options.model)}`, { headers });
    const convReady = this.waitReady(this.ws, "conversation", () => this.send(this.sessionUpdate(true)));
    if (live) {
      this.stt = new WebSocket(`${base}?intent=transcription`, { headers });
      const stt = this.stt;
      const sttReady = this.waitReady(stt, "transcription", () => this.sendStt(this.transcriptionSessionUpdate())).then(
        () => {
          stt.on("message", (data) => this.handleStt(parse(data)));
          stt.on("error", (error) => this.options.log?.("Realtime 전사 세션 오류", { err: error.message }));
          stt.on("close", (code) => this.onSttClose(code));
        },
        (error: Error) => {
          // 전사 세션을 못 열면 번역 세션 전사로 되돌아간다 (예전 동작). 번역 세션 설정을 다시 보내 전사를 켠다
          this.options.log?.("Realtime 전사 세션 열기 실패, 번역 세션 전사로 대체", { err: error.message });
          this.dropStt();
        },
      );
      this.ready = Promise.all([convReady, sttReady]).then(() => undefined);
    } else {
      this.ready = convReady;
    }
    convReady.then(
      () => {
        this.ws.on("message", (data) => this.handle(parse(data)));
        this.ws.on("error", (error) => this.options.log?.("Realtime 스트림 오류", { err: error.message }));
        this.ws.on("close", (code) => this.onClose(code));
      },
      () => {
        // 번역 세션을 못 열면 열어 둔 전사 세션도 닫는다 (open() 은 ready 거부로 실패한다)
        this.closedByUs = true;
        this.stt?.terminate();
      },
    );
  }

  /** 연결 → 설정 보내기 → session.updated 까지 기다린다 (시간 초과·HTTP 오류·설정 오류는 거부) */
  private waitReady(ws: WebSocket, kind: SessionKind, configure: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const label = kind === "conversation" ? "Realtime 스트림" : "Realtime 전사 세션";
      const timer = setTimeout(() => {
        reject(new Error(`${label} 열기 시간 초과`));
        ws.terminate();
      }, OPEN_TIMEOUT_MS);
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      ws.once("unexpected-response", (_req, res) => fail(new Error(`${label} 연결 실패: HTTP ${res.statusCode}`)));
      ws.once("error", fail);
      ws.once("open", configure);
      const onReady = (raw: WebSocket.RawData) => {
        const event = parse(raw);
        if (!event) return;
        this.trace(kind, event);
        if (event.type === "session.updated" || event.type === "transcription_session.updated") {
          clearTimeout(timer);
          ws.off("message", onReady);
          ws.off("error", fail);
          resolve();
        } else if (event.type === "error") {
          fail(new Error(`${label} 설정 오류: ${event.error?.code ?? ""} ${event.error?.message ?? ""}`.trim()));
        }
      };
      ws.on("message", onReady);
    });
  }

  private sessionUpdate(full: boolean): object {
    const instructions = buildStreamInstructions(this.sourceLang, this.targetLang, this.context, this.glossary);
    if (!full) return { type: "session.update", session: { type: "realtime", instructions } };
    const { options } = this;
    return {
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: RATE },
            // 전사 세션이 있으면 번역 세션은 전사하지 않는다 (받아쓰기 2번 청구 방지)
            ...(this.sttAlive ? {} : { transcription: this.transcriptionConfig() }),
            turn_detection: this.turnDetection({ create_response: true, interrupt_response: false }),
          },
          output: { format: { type: "audio/pcm", rate: RATE }, voice: options.voice },
        },
        reasoning: { effort: options.reasoning },
      },
    };
  }

  /** 전사 전용 세션 설정 (session.type = transcription, 같은 음성 형식·같은 VAD) */
  private transcriptionSessionUpdate(): object {
    return {
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: RATE },
            transcription: this.transcriptionConfig(),
            turn_detection: this.turnDetection({}),
          },
        },
      },
    };
  }

  private transcriptionConfig(): object {
    return { model: this.options.transcribeModel, language: this.sourceLang, prompt: STT_PROMPT };
  }

  private turnDetection(extra: object): object {
    return { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: this.options.silenceMs, ...extra };
  }

  private send(event: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  private sendStt(event: object): void {
    if (this.stt?.readyState === WebSocket.OPEN) this.stt.send(JSON.stringify(event));
  }

  append(pcm: Buffer): void {
    if (this.failed || this.closedByUs) return;
    this.bytesSinceCommit += pcm.length;
    const event = JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(event);
    if (this.sttAlive && this.stt?.readyState === WebSocket.OPEN) this.stt.send(event);
  }

  commit(): void {
    // 아무것도 보내지 않는다. 말 끝은 서버 VAD 만 정한다 — 수동 input_audio_buffer.commit 은 그 세션의 VAD 를 멈춘다 (2026-10-19 실측)
  }

  setContext(lines: ContextLine[]): void {
    this.context = lines.slice(-2);
    this.send(this.sessionUpdate(false));
  }

  close(): void {
    this.closedByUs = true;
    for (const turn of this.turns.values()) this.releaseTurn(turn);
    this.turns.clear();
    this.byConvItem.clear();
    this.bySttItem.clear();
    for (const ws of [this.ws, this.stt]) {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
    }
  }

  private trace(session: SessionKind, event: ServerEvent): void {
    if (!this.options.trace || event.type.endsWith(".delta")) return;
    this.options.trace(session, event.type, {
      ...(event.item_id ? { itemId: event.item_id } : {}),
      ...(event.response_id || event.response?.id ? { responseId: event.response_id ?? event.response?.id } : {}),
      ...(event.response?.status ? { status: event.response.status } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(event.transcript !== undefined ? { transcript: event.transcript } : {}),
    });
  }

  // ─── 턴 짝짓기 ────────────────────────────────────

  /** 이 세션에서 처음 보는 항목이면 상대 세션 항목이 아직 안 붙은 가장 오래된 턴에 붙이고, 없으면 새 턴 */
  private turnFor(source: SessionKind, itemId: string): Turn {
    const own = source === "conversation" ? this.byConvItem : this.bySttItem;
    const existing = own.get(itemId);
    if (existing) return existing;
    let turn: Turn | undefined;
    for (const candidate of this.turns.values()) {
      const slot = source === "conversation" ? candidate.convItemId : candidate.sttItemId;
      if (slot === null) {
        turn = candidate;
        break;
      }
    }
    if (!turn) {
      turn = {
        id: randomUUID(),
        convItemId: null,
        sttItemId: null,
        inputSeconds: 0,
        responseId: null,
        started: false,
        translation: "",
        original: null,
        originalDone: false,
        sttUsage: undefined,
        responseDone: false,
        responseStatus: null,
        itemIds: [],
        reservation: null,
        sttReservation: null,
        reserved: Promise.resolve(),
        cancelled: false,
        originalTimer: null,
        firstDeltaSeen: false,
      };
      this.turns.set(turn.id, turn);
    }
    if (source === "conversation") turn.convItemId = itemId;
    else turn.sttItemId = itemId;
    own.set(itemId, turn);
    return turn;
  }

  private forget(turn: Turn): void {
    if (turn.originalTimer) clearTimeout(turn.originalTimer);
    turn.originalTimer = null;
    this.turns.delete(turn.id);
    if (turn.convItemId) this.byConvItem.delete(turn.convItemId);
    if (turn.sttItemId) this.bySttItem.delete(turn.sttItemId);
    if (turn.responseId) this.responseToTurn.delete(turn.responseId);
  }

  // ─── 번역 세션 이벤트 ───────────────────────────────

  private handle(event: ServerEvent | null): void {
    if (!event || this.failed) return;
    this.trace("conversation", event);
    switch (event.type) {
      case "input_audio_buffer.committed":
        // 서버 VAD 가 말 끝을 정해 확정함 → 턴 시작 (create_response 로 응답이 저절로 붙는다)
        if (event.item_id) void this.newTurn(event.item_id);
        break;
      case "response.created": {
        const turn = this.awaitingResponse.shift();
        if (!turn || !event.response?.id) break;
        turn.responseId = event.response.id;
        this.responseToTurn.set(event.response.id, turn);
        if (turn.cancelled) {
          this.send({ type: "response.cancel", response_id: event.response.id });
          break;
        }
        turn.started = true;
        this.events.turnStart(turn.id);
        // 전사 세션이 번역 응답보다 먼저 완성본을 낸 경우: 턴이 시작된 지금 올린다 (듣는 사람 앱은 start 뒤의 자막만 받는다)
        if (turn.originalDone && turn.original) this.events.original(turn.id, turn.original);
        break;
      }
      case "response.output_audio.delta": {
        const turn = this.turnOf(event.response_id);
        if (turn && !turn.cancelled && event.delta) this.events.audio(turn.id, Buffer.from(event.delta, "base64"));
        break;
      }
      case "response.output_audio_transcript.delta": {
        const turn = this.turnOf(event.response_id);
        if (turn && !turn.cancelled && event.delta) {
          turn.translation += event.delta;
          this.events.translationDelta(turn.id, event.delta);
        }
        break;
      }
      case "response.output_audio_transcript.done": {
        const turn = this.turnOf(event.response_id);
        if (turn && event.transcript) turn.translation = event.transcript;
        break;
      }
      case "conversation.item.input_audio_transcription.delta":
      case "conversation.item.input_audio_transcription.completed":
      case "conversation.item.input_audio_transcription.failed":
        // 전사 세션이 없을 때(liveTranscription off·전사 세션 실패)만 번역 세션이 전사한다
        this.onTranscription("conversation", event);
        break;
      case "response.done": {
        const turn = this.turnOf(event.response?.id);
        if (!turn) break;
        turn.responseDone = true;
        turn.responseStatus = event.response?.status ?? null;
        for (const item of event.response?.output ?? []) if (item.id) turn.itemIds.push(item.id);
        void this.commitTranslate(turn, event.response?.usage);
        if (!turn.originalDone) {
          if (turn.originalTimer) clearTimeout(turn.originalTimer);
          turn.originalTimer = setTimeout(() => {
            turn.originalDone = true;
            this.maybeFinish(turn);
          }, ORIGINAL_WAIT_MS);
        }
        this.maybeFinish(turn);
        break;
      }
      case "error":
        this.options.log?.("Realtime 스트림 오류 이벤트", { code: event.error?.code, message: event.error?.message });
        break;
    }
  }

  // ─── 전사 세션 이벤트 ───────────────────────────────

  private handleStt(event: ServerEvent | null): void {
    if (!event || this.failed || !this.sttAlive) return;
    this.trace("transcription", event);
    switch (event.type) {
      case "input_audio_buffer.speech_started":
      case "input_audio_buffer.committed":
        // 말 시작·말 끝: 턴을 미리 만들어 둔다 (조각이 오기 전에 짝을 맞추려고)
        if (event.item_id) this.turnFor("transcription", event.item_id);
        break;
      case "conversation.item.input_audio_transcription.delta":
      case "conversation.item.input_audio_transcription.completed":
      case "conversation.item.input_audio_transcription.failed":
        this.onTranscription("transcription", event);
        break;
      case "error":
        this.options.log?.("Realtime 전사 세션 오류 이벤트", { code: event.error?.code, message: event.error?.message });
        break;
    }
  }

  /** 원문 전사 조각·완성본 (어느 세션에서 왔든 같은 규칙) */
  private onTranscription(source: SessionKind, event: ServerEvent): void {
    if (!event.item_id) return;
    // 번역 세션 전사는 전사 세션이 없을 때만 (둘 다 오면 전사 세션 것만 쓴다)
    if (source === "conversation" && this.sttAlive) return;
    const turn = this.turnFor(source, event.item_id);
    if (event.type.endsWith(".delta")) {
      if (!turn.firstDeltaSeen) {
        turn.firstDeltaSeen = true;
        this.options.trace?.(source, `${event.type} (first)`, { itemId: event.item_id, turnId: turn.id, delta: event.delta });
      }
      if (!turn.cancelled && event.delta) this.events.originalDelta(turn.id, event.delta);
      return;
    }
    const text = event.type.endsWith("completed") ? (event.transcript ?? "").trim() : "";
    turn.original = text || null;
    turn.originalDone = true;
    turn.sttUsage = event.usage ?? null;
    // 완성본은 턴이 시작된(응답이 붙은) 뒤에만 올린다. 아직이면 response.created 에서 올린다
    if (turn.original && !turn.cancelled && turn.started) this.events.original(turn.id, turn.original);
    void this.commitStt(turn);
    if (turn.convItemId === null) {
      // 전사만 있고 번역 세션이 말 끝을 안 냈다: 잠시 기다렸다 짝이 안 생기면 버린다 (다음 턴에 잘못 붙지 않게)
      if (turn.originalTimer) clearTimeout(turn.originalTimer);
      turn.originalTimer = setTimeout(() => {
        if (turn.convItemId !== null || !this.turns.has(turn.id)) return;
        this.options.log?.("전사만 있고 번역 턴이 없어 버림", { turnId: turn.id, original: turn.original });
        this.forget(turn);
      }, ORIGINAL_WAIT_MS);
      return;
    }
    this.maybeFinish(turn);
  }

  private turnOf(responseId: string | undefined): Turn | undefined {
    return responseId ? this.responseToTurn.get(responseId) : undefined;
  }

  private async newTurn(itemId: string): Promise<void> {
    const inputSeconds = this.bytesSinceCommit / 2 / RATE;
    this.bytesSinceCommit = 0;
    const turn = this.turnFor("conversation", itemId);
    turn.inputSeconds = inputSeconds;
    turn.itemIds.push(itemId);
    // 전사만 있던 턴이면 짝을 기다리던 타이머를 멈춘다
    if (turn.originalTimer) clearTimeout(turn.originalTimer);
    turn.originalTimer = null;
    this.awaitingResponse.push(turn);
    const { budget, model, transcribeModel } = this.options;
    const instructionsChars = buildStreamInstructions(this.sourceLang, this.targetLang, this.context, this.glossary).length;
    let ok = true;
    turn.reserved = (async () => {
      try {
        turn.reservation = await budget.reserve(budget.estimate(model, turnEstimate(instructionsChars, inputSeconds)));
        turn.sttReservation = await budget.reserve(budget.estimate(transcribeModel, transcribeEstimate(inputSeconds)));
      } catch {
        ok = false;
      }
    })();
    await turn.reserved;
    if (!ok) {
      // 비용 한도: 이 턴은 취소하고 연결을 끝낸다 → 앱은 안내 후 발화 단위 방식(같은 한도로 막힘)으로
      turn.cancelled = true;
      // 응답이 아직 안 만들어졌어도 response_id 없이 보내면 진행 중(곧 만들어질) 응답을 취소한다. 그 뒤 연결도 닫는다
      this.send(turn.responseId ? { type: "response.cancel", response_id: turn.responseId } : { type: "response.cancel" });
      this.releaseTurn(turn);
      this.events.turnEnd(turn.id, { status: "failed", code: "BUDGET_EXCEEDED" });
      this.fail("budget");
      return;
    }
    // 전사 세션이 이미 완성본을 냈으면 지금 기록한다
    if (turn.originalDone) void this.commitStt(turn);
  }

  private async commitTranslate(turn: Turn, usage: Usage | undefined): Promise<void> {
    await turn.reserved;
    const reservation = turn.reservation;
    turn.reservation = null;
    if (!reservation) return;
    await this.options.budget.commit(reservation, { ...realtimeUsage(usage), kind: "translate", model: this.options.model }).catch(() => {});
  }

  /** 전사 사용량 기록: 완성본(사용량)과 예약이 모두 있을 때 한 번만 */
  private async commitStt(turn: Turn): Promise<void> {
    await turn.reserved;
    if (!turn.originalDone) return;
    const reservation = turn.sttReservation;
    turn.sttReservation = null;
    if (!reservation) return;
    const usage = turn.sttUsage;
    const tokens: UsageTokens =
      usage?.input_tokens !== undefined
        ? {
            inputAudioTokens: usage.input_token_details?.audio_tokens ?? usage.input_tokens,
            inputTextTokens: usage.input_token_details?.text_tokens ?? 0,
            outputTextTokens: usage.output_tokens ?? 0,
          }
        : transcribeEstimate(usage?.type === "duration" && usage.seconds !== undefined ? usage.seconds : turn.inputSeconds);
    await this.options.budget.commit(reservation, { ...tokens, kind: "stt", model: this.options.transcribeModel }).catch(() => {});
  }

  private releaseTurn(turn: Turn): void {
    if (turn.originalTimer) clearTimeout(turn.originalTimer);
    void turn.reserved.then(() => {
      if (turn.reservation) this.options.budget.release(turn.reservation);
      if (turn.sttReservation) this.options.budget.release(turn.sttReservation);
      turn.reservation = null;
      turn.sttReservation = null;
    });
  }

  /** 번역 응답과 원문 전사가 모두 끝나면 턴을 닫고, 세션 안 항목을 지운다 */
  private maybeFinish(turn: Turn): void {
    if (!turn.responseDone || !turn.originalDone || !this.turns.has(turn.id)) return;
    this.forget(turn);
    for (const itemId of turn.itemIds) this.send({ type: "conversation.item.delete", item_id: itemId });
    if (turn.cancelled) return;
    const translation = turn.translation.trim();
    if (turn.responseStatus !== "completed" || !translation) {
      this.events.turnEnd(turn.id, { status: "failed", code: translation ? "TRANSLATION_FAILED" : "EMPTY" });
      return;
    }
    this.events.turnEnd(turn.id, { status: "done", original: turn.original, translation, model: this.options.model });
  }

  private onClose(code: number): void {
    if (this.closedByUs || this.failed) return;
    this.options.log?.("Realtime 스트림 연결 끊김", { code });
    this.fail("error");
  }

  /** 전사 세션이 끊김: 번역 세션 전사로 되돌아간다 (통화는 계속) */
  private onSttClose(code: number): void {
    if (this.closedByUs || this.failed || !this.sttAlive) return;
    this.options.log?.("Realtime 전사 세션 끊김, 번역 세션 전사로 대체", { code });
    this.dropStt();
  }

  private dropStt(): void {
    this.sttAlive = false;
    const stt = this.stt;
    this.stt = null;
    if (stt && (stt.readyState === WebSocket.OPEN || stt.readyState === WebSocket.CONNECTING)) stt.close();
    // 번역 세션 설정을 다시 보내 전사를 켠다 (아직 열리는 중이면 open 때 보내는 설정에 이미 들어간다)
    if (this.ws.readyState === WebSocket.OPEN) this.send(this.sessionUpdate(true));
    // 전사만 있던 턴은 짝이 생기지 않는다 → 정리. 번역 턴은 응답 뒤 ORIGINAL_WAIT_MS 가 지나면 원문 없이 끝난다
    for (const turn of [...this.turns.values()]) if (turn.convItemId === null) this.forget(turn);
  }

  /** 진행 중인 턴을 실패로 닫고 연결을 끝낸다 */
  private fail(reason: "error" | "budget"): void {
    if (this.failed) return;
    this.failed = true;
    for (const turn of this.turns.values()) {
      this.releaseTurn(turn);
      if (!turn.cancelled && turn.started) this.events.turnEnd(turn.id, { status: "failed", code: "ENGINE_CLOSED" });
    }
    this.turns.clear();
    this.byConvItem.clear();
    this.bySttItem.clear();
    for (const ws of [this.ws, this.stt]) if (ws?.readyState === WebSocket.OPEN) ws.close();
    this.events.closed(reason);
  }
}

function parse(raw: WebSocket.RawData): ServerEvent | null {
  try {
    return JSON.parse(raw.toString()) as ServerEvent;
  } catch {
    return null;
  }
}

/** 턴 1개 예상 사용량 (S0 실측 기반, 여유 있게): 입력 음성 10토큰/초, 출력 음성 20토큰/초 × 1.5, 지시문 글자/2 */
export function turnEstimate(instructionsChars: number, inputSeconds: number): UsageTokens {
  return {
    inputTextTokens: Math.ceil(instructionsChars / 2) + 50,
    inputAudioTokens: Math.ceil((inputSeconds + 0.5) * 10),
    outputTextTokens: 150,
    outputAudioTokens: Math.ceil(inputSeconds * 1.5 * 20) + 40,
  };
}

const transcribeEstimate = (seconds: number): UsageTokens => ({ inputAudioTokens: Math.ceil((seconds + 0.5) * 40), outputTextTokens: 60 });
