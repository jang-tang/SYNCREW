import type { Lang } from "../shared/languages";
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
  /** 엔진이 말 끝을 감지(또는 commit)해 번역을 시작함 */
  turnStart(turnId: string): void;
  /** 번역 음성 조각 (PCM16, 엔진 sampleRate) */
  audio(turnId: string, pcm: Buffer): void;
  /** 번역 자막 조각 */
  translationDelta(turnId: string, text: string): void;
  /** 원문 전사 (완성본, 번역보다 늦게 올 수 있다) */
  original(turnId: string, text: string): void;
  turnEnd(turnId: string, result: TurnEnd): void;
  /** 연결이 예기치 않게 끝남. budget = 비용 한도로 더 진행할 수 없음 */
  closed(reason: "error" | "budget"): void;
};

export interface StreamConnection {
  /** 입력 음성 조각 (PCM16, 엔진 sampleRate) */
  append(pcm: Buffer): void;
  /** 단말이 말 끝을 알림: 말하는 중이던 턴을 바로 확정한다 (엔진 VAD 가 이미 확정했으면 무시) */
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
};

export interface StreamEngine {
  readonly name: string;
  readonly sampleRate: number;
  /** 비용 한도가 모자라면 BudgetExceededError */
  open(options: StreamOpenOptions): Promise<StreamConnection>;
}

/**
 * 스트리밍 지시문: 기존 번역 지시문(번역만, 대답 금지, 안전 지시·숫자 규칙) + 직전 턴 텍스트 문맥.
 * 문맥은 참고용이며 다시 번역하거나 대답하지 않도록 명시한다.
 * TODO(S2): 현장 용어집 미리 넣기 — 전체 용어집(수백 개)은 턴마다 수천 토큰이라 비용이 크므로 범위를 정해 측정 후 결정.
 */
export function buildStreamInstructions(sourceLang: Lang, targetLang: Lang, context: ContextLine[]): string {
  const base = buildInstructions(sourceLang, targetLang, { terms: [] });
  const lines = [
    base,
    "Each user turn is live speech from a phone call. Translate every turn independently as soon as it ends.",
  ];
  if (context.length > 0) {
    lines.push("Recent turns, for reference only (pronouns, topic). Do NOT translate, repeat, or answer them again:");
    for (const line of context) lines.push(`- "${line.original}" → "${line.translation}"`);
  }
  return lines.join("\n");
}
