import WebSocket from "ws";
import type { Lang } from "../shared/languages";
import { BudgetExceededError, type BudgetGuard, type Reservation } from "../engine/budget/budgetGuard";
import type { UsageTokens } from "../engine/budget/pricing";
import { STT_PROMPT } from "../messaging/pipeline";
import {
  buildStreamInstructions,
  type ContextLine,
  type StreamConnection,
  type StreamEngine,
  type StreamEngineEvents,
  type StreamOpenOptions,
} from "./engine";

// OpenAI Realtime 스트리밍 엔진 (gpt-realtime-2.1, GA 인터페이스 — 2026-10-13 S0 측정 스크립트로 실제 확인한 설정).
//   - 화자 1명 × 대상 언어 1개당 WebSocket 세션 1개를 통화 내내 연다
//   - server_vad(무음 500ms, 앞 300ms) + create_response, interrupt_response=false (이어 말해도 앞 번역을 끊지 않음)
//   - 입력 전사(원문 기록) = STT_MODEL (기본 gpt-4o-transcribe), 출력 PCM16 24kHz 음성 + 자막
//   - 턴이 끝나면 세션 안 대화 항목을 모두 지우고(conversation.item.delete), 직전 1–2턴은 텍스트로 지시문에 넣는다 (P3)
//   - 비용: 열기 전 남은 한도 확인, 턴마다 예상치 예약 → response.done 사용량으로 기록 (BudgetGuard)
// 이벤트 이름·필드: docs/s0-report.md 1절, server/scripts/stream-measure.ts.

const URL_BASE = "wss://api.openai.com/v1/realtime";
const RATE = 24_000;
const OPEN_TIMEOUT_MS = 10_000;
/** 번역이 끝난 뒤 원문 전사를 기다리는 최대 시간 */
const ORIGINAL_WAIT_MS = 4_000;
/** 세션을 열 때 남아 있어야 하는 최소 한도 (말한 약 10초 분량) */
const MIN_REMAINING_USD = 0.03;

export type RealtimeStreamOptions = {
  apiKey: string;
  model: string;
  transcribeModel: string;
  voice: string;
  reasoning: "minimal" | "low" | "medium" | "high";
  silenceMs: number;
  budget: BudgetGuard;
  /** 테스트용 엔드포인트 교체 */
  url?: string;
  log?: (message: string, detail?: Record<string, unknown>) => void;
};

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

type ServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  response_id?: string;
  item?: { id?: string };
  error?: { message?: string; code?: string };
  usage?: { input_tokens?: number; output_tokens?: number; input_token_details?: { text_tokens?: number; audio_tokens?: number } };
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

  async open({ sourceLang, targetLang, events }: StreamOpenOptions): Promise<StreamConnection> {
    const status = await this.options.budget.status();
    if (status.remainingUsd < MIN_REMAINING_USD) {
      throw new BudgetExceededError(status.limitUsd, status.spentUsd, MIN_REMAINING_USD);
    }
    const connection = new RealtimeConnection(this.options, sourceLang, targetLang, events);
    await connection.ready;
    return connection;
  }
}

type Turn = {
  id: string;
  /** 이 턴에 들어간 입력 음성 길이 (예상 비용 계산용) */
  inputSeconds: number;
  responseId: string | null;
  started: boolean;
  translation: string;
  original: string | null;
  originalDone: boolean;
  responseDone: boolean;
  responseStatus: string | null;
  itemIds: string[];
  reservation: Reservation | null;
  sttReservation: Reservation | null;
  /** 예약이 끝날 때까지 (응답이 예약보다 먼저 끝나도 사용량을 빠뜨리지 않기 위해 기다린다) */
  reserved: Promise<void>;
  cancelled: boolean;
  originalTimer: NodeJS.Timeout | null;
};

class RealtimeConnection implements StreamConnection {
  readonly ready: Promise<void>;
  private readonly ws: WebSocket;
  private readonly turns = new Map<string, Turn>();
  /** 응답이 아직 안 붙은 확정 턴 (순서대로) */
  private readonly awaitingResponse: Turn[] = [];
  private readonly responseToTurn = new Map<string, Turn>();
  private bytesSinceCommit = 0;
  private speaking = false;
  private context: ContextLine[] = [];
  private closedByUs = false;
  private failed = false;

  constructor(
    private readonly options: RealtimeStreamOptions,
    private readonly sourceLang: Lang,
    private readonly targetLang: Lang,
    private readonly events: StreamEngineEvents,
  ) {
    this.ws = new WebSocket(`${options.url ?? URL_BASE}?model=${encodeURIComponent(options.model)}`, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Realtime 스트림 열기 시간 초과"));
        this.ws.terminate();
      }, OPEN_TIMEOUT_MS);
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.ws.once("unexpected-response", (_req, res) => fail(new Error(`Realtime 연결 실패: HTTP ${res.statusCode}`)));
      this.ws.once("error", fail);
      this.ws.once("open", () => this.send(this.sessionUpdate(true)));
      const onReady = (raw: WebSocket.RawData) => {
        const event = parse(raw);
        if (event?.type === "session.updated") {
          clearTimeout(timer);
          this.ws.off("message", onReady);
          this.ws.off("error", fail);
          this.ws.on("message", (data) => this.handle(parse(data)));
          this.ws.on("error", (error) => this.options.log?.("Realtime 스트림 오류", { err: error.message }));
          this.ws.on("close", (code) => this.onClose(code));
          resolve();
        } else if (event?.type === "error") {
          fail(new Error(`Realtime 설정 오류: ${event.error?.code ?? ""} ${event.error?.message ?? ""}`.trim()));
        }
      };
      this.ws.on("message", onReady);
    });
  }

  private sessionUpdate(full: boolean): object {
    const instructions = buildStreamInstructions(this.sourceLang, this.targetLang, this.context);
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
            transcription: { model: options.transcribeModel, language: this.sourceLang, prompt: STT_PROMPT },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: options.silenceMs,
              create_response: true,
              interrupt_response: false,
            },
          },
          output: { format: { type: "audio/pcm", rate: RATE }, voice: options.voice },
        },
        reasoning: { effort: options.reasoning },
      },
    };
  }

  private send(event: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  append(pcm: Buffer): void {
    if (this.failed || this.closedByUs) return;
    this.bytesSinceCommit += pcm.length;
    this.send({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
  }

  commit(): void {
    // 엔진 VAD 가 이미 확정했으면(말하는 중이 아니면) 보내지 않는다 — 빈 버퍼 확정은 오류가 된다
    if (this.speaking) this.send({ type: "input_audio_buffer.commit" });
  }

  setContext(lines: ContextLine[]): void {
    this.context = lines.slice(-2);
    this.send(this.sessionUpdate(false));
  }

  close(): void {
    this.closedByUs = true;
    for (const turn of this.turns.values()) this.releaseTurn(turn);
    this.turns.clear();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }

  // ─── 이벤트 처리 ───────────────────────────────────

  private handle(event: ServerEvent | null): void {
    if (!event || this.failed) return;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.speaking = true;
        break;
      case "input_audio_buffer.committed":
        this.speaking = false;
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
      case "conversation.item.input_audio_transcription.completed":
      case "conversation.item.input_audio_transcription.failed": {
        const turn = event.item_id ? this.turns.get(event.item_id) : undefined;
        if (!turn) break;
        const text = event.type.endsWith("completed") ? (event.transcript ?? "").trim() : "";
        turn.original = text || null;
        turn.originalDone = true;
        if (turn.original && !turn.cancelled) this.events.original(turn.id, turn.original);
        void this.commitStt(turn, event.usage);
        this.maybeFinish(turn);
        break;
      }
      case "response.done": {
        const turn = this.turnOf(event.response?.id);
        if (!turn) break;
        turn.responseDone = true;
        turn.responseStatus = event.response?.status ?? null;
        for (const item of event.response?.output ?? []) if (item.id) turn.itemIds.push(item.id);
        void this.commitTranslate(turn, event.response?.usage);
        if (!turn.originalDone) {
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

  private turnOf(responseId: string | undefined): Turn | undefined {
    return responseId ? this.responseToTurn.get(responseId) : undefined;
  }

  private async newTurn(itemId: string): Promise<void> {
    const inputSeconds = this.bytesSinceCommit / 2 / RATE;
    this.bytesSinceCommit = 0;
    const turn: Turn = {
      id: itemId,
      inputSeconds,
      responseId: null,
      started: false,
      translation: "",
      original: null,
      originalDone: false,
      responseDone: false,
      responseStatus: null,
      itemIds: [itemId],
      reservation: null,
      sttReservation: null,
      reserved: Promise.resolve(),
      cancelled: false,
      originalTimer: null,
    };
    this.turns.set(itemId, turn);
    this.awaitingResponse.push(turn);
    const { budget, model, transcribeModel } = this.options;
    const instructionsChars = buildStreamInstructions(this.sourceLang, this.targetLang, this.context).length;
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
    }
  }

  private async commitTranslate(turn: Turn, usage: Usage | undefined): Promise<void> {
    await turn.reserved;
    const reservation = turn.reservation;
    turn.reservation = null;
    if (!reservation) return;
    await this.options.budget.commit(reservation, { ...realtimeUsage(usage), kind: "translate", model: this.options.model }).catch(() => {});
  }

  private async commitStt(turn: Turn, usage: ServerEvent["usage"]): Promise<void> {
    await turn.reserved;
    const reservation = turn.sttReservation;
    turn.sttReservation = null;
    if (!reservation) return;
    const tokens: UsageTokens =
      usage?.input_tokens !== undefined
        ? {
            inputAudioTokens: usage.input_token_details?.audio_tokens ?? usage.input_tokens,
            inputTextTokens: usage.input_token_details?.text_tokens ?? 0,
            outputTextTokens: usage.output_tokens ?? 0,
          }
        : transcribeEstimate(turn.inputSeconds);
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
    if (turn.originalTimer) clearTimeout(turn.originalTimer);
    this.turns.delete(turn.id);
    if (turn.responseId) this.responseToTurn.delete(turn.responseId);
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

  /** 진행 중인 턴을 실패로 닫고 연결을 끝낸다 */
  private fail(reason: "error" | "budget"): void {
    if (this.failed) return;
    this.failed = true;
    for (const turn of this.turns.values()) {
      this.releaseTurn(turn);
      if (!turn.cancelled && turn.started) this.events.turnEnd(turn.id, { status: "failed", code: "ENGINE_CLOSED" });
    }
    this.turns.clear();
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
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
