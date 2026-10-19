import type { Lang } from "../shared/languages";
import type { StreamGlossary } from "../engine/domain/domainProcessor";
import { buildInstructions } from "../engine/translation/realtimeTranslator";

// 스트리밍 통역 엔진 계약 (docs/streaming-plan.md 4절). 구현: realtimeStream.ts(OpenAI), fakeStream.ts(테스트·개발).
// 연결 1개 = 화자 1명 × 대상 언어 1개. 통화 내내 열어 두고, 엔진이 말 끝을 감지할 때마다 "턴"이 하나 생긴다.
// 입력·출력 음성은 모두 PCM16 mono, 엔진의 sampleRate(OpenAI 24kHz).

/** 직전 턴의 원문 → 번역문 (다음 턴 지시문에 텍스트 문맥으로 넣는다. 2026-10-13 결정 P3) */
export type ContextLine = { original: string; translation: string };

export type TurnEnd =
  | { status: "done"; original: string | null; translation: string; model: string }
  | { status: "failed"; code: "ENGINE_CLOSED" | "BUDGET_EXCEEDED" | "TRANSLATION_FAILED" | "EMPTY" };

export type StreamEngineEvents = {
  /** 엔진(서버 VAD)이 말 끝을 감지해 번역을 시작함 */
  turnStart(turnId: string): void;
  /** 번역 음성 조각 (PCM16, 엔진 sampleRate) */
  audio(turnId: string, pcm: Buffer): void;
  /** 번역 자막 조각 */
  translationDelta(turnId: string, text: string): void;
  /** 원문 전사 조각 (받아쓰는 중 글자, 이어 붙인다. 완성본 original 이 오면 그것으로 바꾼다) */
  originalDelta(turnId: string, text: string): void;
  /** 원문 전사 (완성본, 번역보다 늦게 올 수 있다) */
  original(turnId: string, text: string): void;
  turnEnd(turnId: string, result: TurnEnd): void;
  /** 연결이 예기치 않게 끝남. budget = 비용 한도로 더 진행할 수 없음 */
  closed(reason: "error" | "budget"): void;
};

export interface StreamConnection {
  /** 입력 음성 조각 (PCM16, 엔진 sampleRate) */
  append(pcm: Buffer): void;
  /**
   * 단말이 보내기를 멈춤(stream:pause). 말 끝은 엔진(서버 VAD)만 정하므로 OpenAI 구현은 아무것도 보내지 않는다
   * (수동 commit 은 그 세션의 VAD 를 멈춘다 — 2026-10-19 실측). 가짜 엔진은 횟수만 센다
   */
  commit(): void;
  /** 다음 턴부터 쓸 텍스트 문맥 */
  setContext(lines: ContextLine[]): void;
  /** 정상 종료 (closed 이벤트를 보내지 않는다) */
  close(): void;
}

export type StreamOpenOptions = {
  sourceLang: Lang;
  targetLang: Lang;
  events: StreamEngineEvents;
  /** 언어 쌍 기준 미리 넣는 현장 용어집 (DomainProcessor.streamGlossary). 없으면 용어 없이 */
  glossary?: StreamGlossary;
};

export interface StreamEngine {
  readonly name: string;
  readonly sampleRate: number;
  /** 비용 한도가 모자라면 BudgetExceededError */
  open(options: StreamOpenOptions): Promise<StreamConnection>;
}

/** 스트리밍 지시문 전체 길이 상한 (글자). 용어 110개 + 검증 문장 12개 + 문맥 2줄이 이 안에 들어야 한다 — test/streamingEngine.test.ts 가 모든 언어 쌍에서 확인 */
export const STREAM_INSTRUCTIONS_MAX_CHARS = 4_500;

const EMPTY_GLOSSARY: StreamGlossary = { terms: [], phrases: [] };

/**
 * 스트리밍 지시문 = [고정 부분] 번역 규칙(buildInstructions) + 언어 쌍 용어집 + 검증 문장 + 실시간 통화 안내
 *                 + [턴마다 바뀌는 부분] 직전 턴 텍스트 문맥.
 * 용어집은 번역 전에 텍스트가 없어 언어 쌍 기준으로 고르고(DomainProcessor.streamGlossary, 상한 110개·문장 12개),
 * 지시문 **앞쪽**에 고정해 setContext 로 문맥이 바뀌어도 OpenAI 프롬프트 캐시(앞부분 일치)가 유지되게 한다 (2026-10-19).
 * 문맥은 참고용이며 다시 번역하거나 대답하지 않도록 명시한다.
 */
export function buildStreamInstructions(sourceLang: Lang, targetLang: Lang, context: ContextLine[], glossary: StreamGlossary = EMPTY_GLOSSARY): string {
  const base = buildInstructions(sourceLang, targetLang, { terms: glossary.terms });
  const lines = [base];
  if (glossary.phrases.length > 0) {
    lines.push("Verified sentence translations (when a turn says one of these, use the translation as is):");
    for (const phrase of glossary.phrases) lines.push(`- "${phrase.source}" → "${phrase.target}"`);
  }
  lines.push("Each user turn is live speech from a phone call. Translate every turn independently as soon as it ends.");
  if (context.length > 0) {
    lines.push("Recent turns, for reference only (pronouns, topic). Do NOT translate, repeat, or answer them again:");
    for (const line of context) lines.push(`- "${line.original}" → "${line.translation}"`);
  }
  return lines.join("\n");
}
