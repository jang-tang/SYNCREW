import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { Lang } from "../shared/languages";
import { BudgetExceededError, type BudgetGuard, type Reservation } from "../engine/budget/budgetGuard";
import { durationUsage, type UsageTokens } from "../engine/budget/pricing";
import { STT_PROMPT } from "../messaging/pipeline";
import type { ContextTerm, StreamGlossary } from "../engine/domain/domainProcessor";
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
//   - server_vad(무음 500ms, 앞 300ms), interrupt_response=false (이어 말해도 앞 번역을 끊지 않음)
//   - **응답은 서버가 하나씩 요청한다 (2026-10-27, create_response 끔)**: 말 끝(committed)마다 그 항목만 가리켜
//     (`response.input = [item_reference]`) response.create 를 보내고, 앞 응답이 끝나야(response.done) 다음을 보낸다.
//     예전(자동 응답)에는 번역이 나오는 중에 다음 말·잡음이 끝나면 OpenAI 가 그 응답을 거절(conversation_already_has_active_response)해
//     ① 응답 ↔ 턴 짝이 한 칸씩 밀리고(원문 자막과 번역이 어긋남) ② 거절된 말이 대화에 남아 다음 번역마다 예전 말이 함께 번역됐다
//     (2026-10-27 시드니 실기기 "예전에 했던 말이 다시 전달", 로그 거절 6건). 요청에 이벤트 id 를 붙여 거절되면 다시 줄 세운다
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
//   - **gpt-live-transcribe (2026-10-20, STREAM_STT_MODEL 기본)**: 전사 세션을 `turn_detection: null` + `languages:[원문 언어]` + `delay:"low"`
//     (+ 용어집 keywords ≤50) 로 연다. VAD 없이 입력을 따라가며 받아쓰므로 조각이 **말하는 도중**(실측 말 시작 약 1초 뒤)에 온다.
//     말 끝은 여전히 번역 세션의 server_vad 가 정한다: 번역 세션이 `input_audio_buffer.committed` 를 내면 서버가 전사 세션에
//     `input_audio_buffer.commit` 을 보내 그 턴의 전사 항목을 닫는다 (턴당 정확히 1번 → 두 세션 항목이 1:1). 완성본은 commit 뒤 `completed`.
//     사용량은 duration(초) 형 → durationUsage 로 기록 ($0.017/분). STREAM_STT_MODEL=gpt-4o-transcribe 면 위의 server_vad 방식 그대로.
//   - 턴 = 엔진이 만든 id 로, 두 세션의 항목(item_id)을 **순서대로** 묶는다 (아래 "턴 짝짓기")
//   - 입력 전사(원문 기록) = STT_MODEL (기본 gpt-4o-transcribe), 출력 PCM16 24kHz 음성 + 자막
//   - 턴이 끝나면 세션 안 대화 항목을 모두 지우고(conversation.item.delete), 직전 1–2턴은 텍스트로 지시문에 넣는다 (P3).
//     응답 입력은 그 턴 항목만이라(item_reference) 지우기 전의 예전 항목이 번역에 섞이지 않는다
//   - 언어 쌍 용어집(glossary)은 세션을 열 때 지시문 앞쪽에 고정 (2026-10-19, buildStreamInstructions)
//   - 턴 용어(turnTerms, 2026-10-24 실험, 기본 off): 말하는 도중 전사 조각에서 이번 턴 용어(뜻·규칙)를 찾아 지시문 끝에 넣는다
//       update: 찾는 즉시 session.update (자동 응답 그대로 — 말 끝 전에 도착해야 반영)
//       create: 말 끝(committed) 뒤 그 턴의 response.create 지시문에 넣는다 (응답 요청은 이제 항상 서버가 한다)
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
/** 응답 요청(response.create) 뒤 response.created 가 이만큼 안 오면 그 턴을 실패로 넘기고 다음 턴을 요청한다 (멈춤 방지) */
const CREATE_TIMEOUT_MS = 8_000;
/** 원문에 말이 있는지 아직 모를 때 번역 음성·자막을 붙잡아 두는 최대 시간. 넘으면 그대로 내보낸다 (전사가 늦거나 안 올 때) */
const SPEECH_HOLD_MS = 2_000;

/** 말이 아닌 소리로 치는 낱말 (글자마다 이 안에 들면 군소리). 5개 언어의 흔한 군소리 */
const FILLER_CHARS = new Set([..."음어아으흠엄에嗯啊呃哦唔额"]);
const FILLER_WORDS = new Set(["ừ", "ờ", "à", "ơ", "ư", "ừm", "ờm", "hm", "hmm", "um", "uh", "э", "эм", "м", "мм", "ну"]);

/**
 * 원문 전사에 실제 말이 있는지: 글자가 없거나 군소리("음,", "어…", "ừ")뿐이면 false.
 * 2026-10-24 S4 실측: 전사가 비거나 군소리뿐인 턴에서 번역 모델이 "멈춰!"·"안전모를 쓰세요" 같은 지시를 지어냈다 → 그런 턴은 내보내지 않는다
 */
export function hasSpeech(text: string): boolean {
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    if (FILLER_WORDS.has(word) || [...word].every((ch) => FILLER_CHARS.has(ch))) continue;
    return true;
  }
  return false;
}

export type SessionKind = "conversation" | "transcription";
export type TurnTermsMode = "off" | "update" | "create";

export type RealtimeStreamOptions = {
  apiKey: string;
  model: string;
  /** 받아쓰기 모델 (STT_MODEL): 전사 세션이 없을 때 번역 세션의 입력 전사에 쓴다 */
  transcribeModel: string;
  /** 전사 전용 세션 모델 (STREAM_STT_MODEL, 기본 transcribeModel). gpt-live-transcribe 면 VAD 없는 연속 전사 방식 */
  streamTranscribeModel?: string;
  voice: string;
  reasoning: "minimal" | "low" | "medium" | "high";
  silenceMs: number;
  budget: BudgetGuard;
  /** 전사 전용 세션을 열어 말하는 도중 원문 조각을 받는다 (기본 true). false 면 번역 세션이 전사까지 한다 (예전 동작) */
  liveTranscription?: boolean;
  /** 턴 용어 넣는 방식 (2026-10-24 실험, docs/field-terms.md 8절). 기본 off. 쓰려면 open 에 turnTerms 함수도 넘긴다 */
  turnTerms?: TurnTermsMode;
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

/** 전사 세션 모델이 VAD 없는 연속 전사(gpt-live-transcribe 계열)인지 */
export function isLiveTranscribeModel(model: string): boolean {
  return model.includes("live-transcribe");
}

/** 앱 언어 코드 → gpt-live-transcribe `languages` (ISO 639-1). 지금 5개 언어는 모두 ISO 639-1 과 같다 */
const ISO_639_1: Record<Lang, string> = { ko: "ko", zh: "zh", vi: "vi", uz: "uz", ru: "ru" };

/**
 * 전사 세션 keywords 상한. OpenAI 문서에 개수 제한은 없다 (한 줄, `<` `>` 줄바꿈 금지만). 2026-10-24 50 → 400:
 * 은어 전체(약 230개)를 넣어 말하는 도중 자막이 은어를 받아쓰게 한다 (docs/field-terms.md 9절)
 */
const MAX_KEYWORDS = 400;
const MAX_KEYWORD_CHARS = 64;

/** 용어집의 원문 언어 용어 + 한국어 은어 → gpt-live-transcribe keywords: 한 줄짜리, `<` `>` 없는 것만, 중복 제거, 최대 400개 */
export function transcriptionKeywords(glossary: StreamGlossary | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const words = [...(glossary?.terms ?? []).map((term) => term.source), ...(glossary?.slang ?? []).map((item) => item.source)];
  for (const raw of words) {
    const word = raw.trim();
    if (!word || word.length > MAX_KEYWORD_CHARS || /[\r\n<>]/.test(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

type ServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  response_id?: string;
  item?: { id?: string };
  error?: { message?: string; code?: string; event_id?: string };
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

  async open({ sourceLang, targetLang, events, glossary, turnTerms }: StreamOpenOptions): Promise<StreamConnection> {
    const status = await this.options.budget.status();
    if (status.remainingUsd < MIN_REMAINING_USD) {
      throw new BudgetExceededError(status.limitUsd, status.spentUsd, MIN_REMAINING_USD);
    }
    const connection = new RealtimeConnection(this.options, sourceLang, targetLang, events, glossary, turnTerms);
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
  /** 이 턴의 전사를 맡은 모델 (예약 시점의 세션 상태 기준 — 전사 세션이면 streamTranscribeModel, 아니면 transcribeModel) */
  sttModel: string;
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
  /** 말하는 도중 전사 조각을 이어 붙인 것 (턴 용어 찾기용) */
  partial: string;
  /** 이 턴에 넣은 턴 용어의 원문 표현 (같으면 다시 보내지 않는다) */
  termsKey: string;
  /** 원문에 말이 있는지: unknown 이면 번역 음성·자막을 held 에 붙잡아 두고, no 면 턴을 버린다 */
  speech: "unknown" | "yes" | "no";
  held: ({ audio: Buffer } | { text: string })[];
  holdTimer: NodeJS.Timeout | null;
};

class RealtimeConnection implements StreamConnection {
  readonly ready: Promise<void>;
  private readonly ws: WebSocket;
  /** 전사 전용 세션 (liveTranscription 일 때만) */
  private stt: WebSocket | null = null;
  /** 전사 세션이 살아 있어 번역 세션의 전사를 끈 상태 */
  private sttAlive = false;
  /** 전사 전용 세션 모델 */
  private readonly sttModel: string;
  /** 전사 세션이 VAD 없는 연속 전사(gpt-live-transcribe)라 번역 세션의 말 끝마다 서버가 commit 을 보내야 하는 방식 */
  private readonly liveStt: boolean;
  private readonly turns = new Map<string, Turn>();
  private readonly byConvItem = new Map<string, Turn>();
  private readonly bySttItem = new Map<string, Turn>();
  /** 응답을 아직 요청하지 않은 확정 턴 (순서대로, 한 번에 하나씩 요청한다) */
  private readonly createQueue: Turn[] = [];
  /** response.create 를 보내고 response.created 를 기다리는 턴 */
  private creating: { turn: Turn; eventId: string; timer: NodeJS.Timeout } | null = null;
  /** 진행 중인 응답이 있다 (response.created ~ response.done) — 그동안 다음 요청을 보내지 않는다 */
  private responseActive = false;
  private readonly responseToTurn = new Map<string, Turn>();
  private bytesSinceCommit = 0;
  private context: ContextLine[] = [];
  /** update 방식: 지금 세션 지시문 끝에 들어가 있는 턴 용어 */
  private sessionTurnTerms: ContextTerm[] = [];
  private readonly turnTermsMode: TurnTermsMode;
  private closedByUs = false;
  private failed = false;

  constructor(
    private readonly options: RealtimeStreamOptions,
    private readonly sourceLang: Lang,
    private readonly targetLang: Lang,
    private readonly events: StreamEngineEvents,
    private readonly glossary?: StreamGlossary,
    private readonly findTurnTerms?: (partialOriginal: string) => ContextTerm[],
  ) {
    this.turnTermsMode = findTurnTerms ? (options.turnTerms ?? "off") : "off";
    const base = options.url ?? URL_BASE;
    const headers = { Authorization: `Bearer ${options.apiKey}` };
    const live = options.liveTranscription !== false;
    this.sttAlive = live;
    this.sttModel = options.streamTranscribeModel ?? options.transcribeModel;
    this.liveStt = isLiveTranscribeModel(this.sttModel);
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
    const instructions = buildStreamInstructions(this.sourceLang, this.targetLang, this.context, this.glossary, this.sessionTurnTerms);
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
            // 응답은 서버가 턴마다 그 항목만 가리켜 하나씩 요청한다 (pumpResponses, 2026-10-27)
            turn_detection: this.turnDetection({ create_response: false, interrupt_response: false }),
          },
          output: { format: { type: "audio/pcm", rate: RATE }, voice: options.voice },
        },
        reasoning: { effort: options.reasoning },
      },
    };
  }

  /**
   * 전사 전용 세션 설정 (session.type = transcription, 같은 음성 형식).
   *   - gpt-live-transcribe: VAD 없음(turn_detection null) + languages + delay low + 용어집 keywords. 말 끝은 서버가 commit 으로 알린다
   *   - 그 외(gpt-4o-transcribe 등): 번역 세션과 같은 server_vad (예전 동작)
   */
  private transcriptionSessionUpdate(): object {
    const transcription = this.liveStt
      ? {
          model: this.sttModel,
          languages: [ISO_639_1[this.sourceLang]],
          delay: "low",
          prompt: STT_PROMPT,
          ...(transcriptionKeywords(this.glossary).length > 0 ? { keywords: transcriptionKeywords(this.glossary) } : {}),
        }
      : { model: this.sttModel, language: this.sourceLang, prompt: STT_PROMPT };
    return {
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: RATE },
            transcription,
            turn_detection: this.liveStt ? null : this.turnDetection({}),
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
    this.clearRequests();
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
        sttModel: this.options.transcribeModel,
        responseDone: false,
        responseStatus: null,
        itemIds: [],
        reservation: null,
        sttReservation: null,
        reserved: Promise.resolve(),
        cancelled: false,
        originalTimer: null,
        firstDeltaSeen: false,
        partial: "",
        termsKey: "",
        speech: "unknown",
        held: [],
        holdTimer: null,
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
    if (turn.holdTimer) clearTimeout(turn.holdTimer);
    turn.holdTimer = null;
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
        // gpt-live-transcribe 전사 세션은 VAD 가 없어 같은 자리에서 서버가 commit 을 보내 그 턴의 전사 항목을 닫는다 (턴당 1번)
        if (this.sttAlive && this.liveStt) this.sendStt({ type: "input_audio_buffer.commit" });
        if (event.item_id) {
          void this.newTurn(event.item_id);
          const turn = this.turnFor("conversation", event.item_id);
          if (this.turnTermsMode === "update") {
            this.options.trace?.("conversation", "turnTerms.atCommit", { turnId: turn.id, partial: turn.partial, terms: turn.termsKey });
          }
          this.createQueue.push(turn);
          this.pumpResponses();
        }
        break;
      case "response.created": {
        const pending = this.creating;
        if (!pending || !event.response?.id) break;
        clearTimeout(pending.timer);
        this.creating = null;
        this.responseActive = true;
        const turn = pending.turn;
        turn.responseId = event.response.id;
        this.responseToTurn.set(event.response.id, turn);
        if (turn.cancelled) {
          this.send({ type: "response.cancel", response_id: event.response.id });
          break;
        }
        turn.started = true;
        this.events.turnStart(turn.id);
        // update 방식: 이 응답은 이미 만들어졌으므로 지시문 끝의 턴 용어를 비운다 (다음 턴에 남지 않게)
        if (this.sessionTurnTerms.length > 0) {
          this.sessionTurnTerms = [];
          this.send(this.sessionUpdate(false));
        }
        // 전사 세션이 번역 응답보다 먼저 완성본을 낸 경우: 턴이 시작된 지금 올린다 (듣는 사람 앱은 start 뒤의 자막만 받는다)
        if (turn.originalDone && turn.original) this.events.original(turn.id, turn.original);
        break;
      }
      case "response.output_audio.delta": {
        const turn = this.turnOf(event.response_id);
        if (turn && !turn.cancelled && event.delta) this.output(turn, { audio: Buffer.from(event.delta, "base64") });
        break;
      }
      case "response.output_audio_transcript.delta": {
        const turn = this.turnOf(event.response_id);
        if (turn && !turn.cancelled && event.delta) {
          turn.translation += event.delta;
          this.output(turn, { text: event.delta });
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
        this.responseActive = false;
        // 다음 턴 응답을 요청한다 (이 턴 정리와 별개)
        queueMicrotask(() => this.pumpResponses());
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
        this.onCreateError(event.error);
        break;
    }
  }

  // ─── 응답 요청 (한 번에 하나씩) ─────────────────────

  /** 진행 중인 응답·요청이 없으면 다음 턴의 응답을 요청한다. 이미 버린 턴(말 없음·비용 한도)은 요청 없이 정리한다 */
  private pumpResponses(): void {
    if (this.creating || this.responseActive || this.failed || this.closedByUs) return;
    while (this.createQueue.length > 0) {
      const turn = this.createQueue.shift()!;
      if (!this.turns.has(turn.id) || turn.convItemId === null) continue;
      if (turn.cancelled) {
        // 응답 전에 버린 턴: 응답이 끝난 것으로 치고 정리한다 (항목 지우기·예약 풀기)
        turn.responseDone = true;
        turn.responseStatus = "cancelled";
        this.releaseTurn(turn);
        this.maybeFinish(turn);
        continue;
      }
      const terms = this.turnTermsMode === "create" ? (this.findTurnTerms?.(turn.partial) ?? []) : this.sessionTurnTerms;
      if (this.turnTermsMode === "create") {
        turn.termsKey = terms.map((term) => term.source).join("|");
        this.options.trace?.("conversation", "turnTerms.create", { turnId: turn.id, partial: turn.partial, terms: turn.termsKey });
      }
      const eventId = `create_${turn.id}`;
      const timer = setTimeout(() => {
        if (this.creating?.turn !== turn) return;
        this.options.log?.("번역 응답이 시작되지 않아 턴을 넘김", { turnId: turn.id });
        this.creating = null;
        this.giveUp(turn);
        this.pumpResponses();
      }, CREATE_TIMEOUT_MS);
      this.creating = { turn, eventId, timer };
      this.send({
        type: "response.create",
        event_id: eventId,
        response: {
          instructions: buildStreamInstructions(this.sourceLang, this.targetLang, this.context, this.glossary, terms),
          // 이 턴의 말만 번역한다 (아직 안 지운 예전 항목이 섞이지 않게)
          input: [{ type: "item_reference", id: turn.convItemId }],
        },
      });
      return;
    }
  }

  /** 응답 요청이 거절됨: 다른 응답이 진행 중이면 다시 줄 세우고(그 응답이 끝나면 요청), 그 밖의 거절은 그 턴을 실패로 넘긴다 */
  private onCreateError(error: ServerEvent["error"]): void {
    const pending = this.creating;
    if (!pending || !error?.event_id || error.event_id !== pending.eventId) return;
    clearTimeout(pending.timer);
    this.creating = null;
    if (error.code === "conversation_already_has_active_response") {
      this.createQueue.unshift(pending.turn);
      this.responseActive = true; // 진행 중인 응답의 response.done 에서 다시 요청한다
      return;
    }
    this.giveUp(pending.turn);
    this.pumpResponses();
  }

  /** 응답을 받지 못한 턴: 실패로 닫는다 (턴 시작을 알리지 않았으므로 앱에는 보이지 않는다) */
  private giveUp(turn: Turn): void {
    turn.responseDone = true;
    turn.responseStatus = "failed";
    this.releaseTurn(turn);
    if (!turn.originalDone) {
      // 원문을 기다리다 안 오면 정리한다 (response.done 과 같은 규칙)
      if (turn.originalTimer) clearTimeout(turn.originalTimer);
      turn.originalTimer = setTimeout(() => {
        turn.originalDone = true;
        this.maybeFinish(turn);
      }, ORIGINAL_WAIT_MS);
    }
    this.maybeFinish(turn);
  }

  /** 응답 요청 대기열 비우기 (닫기·실패) */
  private clearRequests(): void {
    if (this.creating) clearTimeout(this.creating.timer);
    this.creating = null;
    this.createQueue.length = 0;
    this.responseActive = false;
  }

  // ─── 전사 세션 이벤트 ───────────────────────────────

  private handleStt(event: ServerEvent | null): void {
    if (!event || this.failed || !this.sttAlive) return;
    this.trace("transcription", event);
    switch (event.type) {
      case "input_audio_buffer.speech_started":
      case "input_audio_buffer.committed":
        // 말 시작·말 끝: 턴을 미리 만들어 둔다 (조각이 오기 전에 짝을 맞추려고). gpt-live-transcribe 는 speech_started 가 없고
        // committed 는 서버가 보낸 commit 의 응답이라 그 턴에 이미 조각이 붙어 있는 것이 보통이다
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
      if (!turn.cancelled && event.delta) {
        this.events.originalDelta(turn.id, event.delta);
        turn.partial += event.delta;
        if (turn.speech === "unknown" && hasSpeech(turn.partial)) this.allowOutput(turn);
        // update 방식: 번역 세션이 아직 말 끝을 안 냈으면 찾은 용어를 바로 지시문에 넣는다
        if (this.turnTermsMode === "update" && turn.convItemId === null) this.updateTurnTerms(turn);
      }
      return;
    }
    const completed = event.type.endsWith("completed");
    const text = completed ? (event.transcript ?? "").trim() : "";
    turn.original = text || null;
    turn.originalDone = true;
    turn.sttUsage = event.usage ?? null;
    // 말이 있는지 판정: 전사가 실패(failed)한 것은 말이 없다는 뜻이 아니므로 그대로 내보낸다
    if (turn.speech === "unknown") {
      if (!completed || hasSpeech(text)) this.allowOutput(turn);
      else this.dropNoSpeech(turn);
    }
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

  /** update 방식: 이 턴 전사 조각에서 찾은 용어가 바뀌었으면 session.update 로 지시문 끝에 넣는다 */
  private updateTurnTerms(turn: Turn): void {
    const terms = this.findTurnTerms?.(turn.partial) ?? [];
    const key = terms.map((term) => term.source).join("|");
    if (key === turn.termsKey) return;
    turn.termsKey = key;
    this.sessionTurnTerms = terms;
    this.send(this.sessionUpdate(false));
    this.options.trace?.("conversation", "turnTerms.update", { turnId: turn.id, partial: turn.partial, terms: key });
  }

  /** 번역 음성·자막 조각: 원문에 말이 있다고 확인된 턴은 바로, 아직 모르면 붙잡아 둔다 (SPEECH_HOLD_MS 넘으면 그대로 내보냄) */
  private output(turn: Turn, piece: { audio: Buffer } | { text: string }): void {
    if (turn.speech === "yes") {
      if ("audio" in piece) this.events.audio(turn.id, piece.audio);
      else this.events.translationDelta(turn.id, piece.text);
      return;
    }
    turn.held.push(piece);
    turn.holdTimer ??= setTimeout(() => {
      turn.holdTimer = null;
      this.options.log?.("원문 전사가 늦어 번역을 그대로 내보냄", { turnId: turn.id });
      this.allowOutput(turn);
    }, SPEECH_HOLD_MS);
  }

  private allowOutput(turn: Turn): void {
    turn.speech = "yes";
    if (turn.holdTimer) clearTimeout(turn.holdTimer);
    turn.holdTimer = null;
    const held = turn.held;
    turn.held = [];
    if (turn.cancelled) return;
    for (const piece of held) this.output(turn, piece);
  }

  /** 원문에 말이 없는 턴: 번역을 내보내지 않고 응답을 취소한다 (이미 시작을 알렸으면 EMPTY 실패로 닫는다) */
  private dropNoSpeech(turn: Turn): void {
    turn.speech = "no";
    if (turn.holdTimer) clearTimeout(turn.holdTimer);
    turn.holdTimer = null;
    turn.held = [];
    if (turn.cancelled) return;
    this.options.log?.("원문에 말이 없어 번역을 버림", { turnId: turn.id, original: turn.original, translation: turn.translation });
    turn.cancelled = true;
    if (turn.responseId && !turn.responseDone) this.send({ type: "response.cancel", response_id: turn.responseId });
    if (turn.started) this.events.turnEnd(turn.id, { status: "failed", code: "EMPTY" });
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
    const { budget, model } = this.options;
    // 전사를 맡은 모델: 전사 세션이 살아 있으면 전사 세션 모델, 아니면 번역 세션 전사(STT_MODEL)
    turn.sttModel = this.sttAlive ? this.sttModel : this.options.transcribeModel;
    const instructionsChars = buildStreamInstructions(this.sourceLang, this.targetLang, this.context, this.glossary).length;
    let ok = true;
    turn.reserved = (async () => {
      try {
        turn.reservation = await budget.reserve(budget.estimate(model, turnEstimate(instructionsChars, inputSeconds)));
        turn.sttReservation = await budget.reserve(budget.estimate(turn.sttModel, transcribeEstimate(turn.sttModel, inputSeconds)));
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
    // tokens 형(gpt-4o-transcribe) 은 그대로, duration 형(gpt-live-transcribe: 말한 초) 은 durationUsage 로 환산, 사용량이 없으면 입력 길이로 추정
    const tokens: UsageTokens =
      usage?.input_tokens !== undefined
        ? {
            inputAudioTokens: usage.input_token_details?.audio_tokens ?? usage.input_tokens,
            inputTextTokens: usage.input_token_details?.text_tokens ?? 0,
            outputTextTokens: usage.output_tokens ?? 0,
          }
        : usage?.type === "duration" && usage.seconds !== undefined
          ? durationUsage(usage.seconds)
          : transcribeEstimate(turn.sttModel, turn.inputSeconds);
    await this.options.budget.commit(reservation, { ...tokens, kind: "stt", model: turn.sttModel }).catch(() => {});
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
    // 전사 없이 기다림이 끝난 턴(ORIGINAL_WAIT_MS): 붙잡아 둔 번역을 내보내고 끝낸다
    if (turn.speech === "unknown") this.allowOutput(turn);
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
    this.clearRequests();
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

/** 전사 1턴 예상 사용량: 시간 기준 모델(gpt-live-transcribe)은 말한 초(+0.5초 여유), 토큰 기준 모델은 초당 40토큰(여유 있게) + 출력 60토큰 */
export const transcribeEstimate = (model: string, seconds: number): UsageTokens =>
  isLiveTranscribeModel(model) ? durationUsage(seconds + 0.5) : { inputAudioTokens: Math.ceil((seconds + 0.5) * 40), outputTextTokens: 60 };
