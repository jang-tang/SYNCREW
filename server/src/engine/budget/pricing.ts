import { z } from "zod";

/** OpenAI 응답의 usage를 정리한 토큰 수 */
export type UsageTokens = {
  inputTextTokens?: number;
  inputAudioTokens?: number;
  cachedInputTokens?: number;
  outputTextTokens?: number;
  outputAudioTokens?: number;
};

const priceSchema = z.object({
  inputText: z.number().nonnegative(),
  outputText: z.number().nonnegative(),
  inputAudio: z.number().nonnegative(),
  outputAudio: z.number().nonnegative(),
  cachedInput: z.number().nonnegative(),
});

/** USD per 1M tokens */
export type ModelPrice = z.infer<typeof priceSchema>;
export type PricingTable = Record<string, ModelPrice>;

/**
 * 기본 단가 (2026-10-12 OpenAI 가격 페이지 확인).
 * - gpt-realtime-2.1 (기본 번역 모델) = gpt-realtime-2 와 같은 가격. 둘 다 등록해 TRANSLATION_MODEL 로 고를 수 있다
 * - 받아쓰기 (2026-10-14 갱신, 가격 정리 사이트 기준 — OpenAI 가격표로 다시 확인 권장):
 *   gpt-4o-transcribe(기본, 2026-10-14부터): 텍스트 입력 $2.5, 출력 $10, 음성 입력 $6 (약 $0.006/분)
 *   gpt-4o-mini-transcribe: 텍스트 입력 $1.25, 출력 $5, 음성 입력 $3 (약 $0.003/분). 이전에는 음성 입력을 $1.25 로 잘못 두어 받아쓰기 비용을 약 2.4배 적게 기록했다
 *   gpt-live-transcribe (2026-10-20, 스트리밍 전사 전용 세션 기본 STREAM_STT_MODEL): OpenAI 가격표는 **말한 시간 기준 $0.017/분**이고
 *   API 사용량도 토큰이 아니라 duration(초)으로 온다. 표·DB 는 토큰 열뿐이라 **1분 = 1,000 "음성 토큰"**(DURATION_AUDIO_TOKENS_PER_SECOND)
 *   으로 환산해 음성 입력 $17/1M 로 적는다 (durationUsage) — 결과는 정확히 $0.017/분. 텍스트·출력 단가는 없다(0)
 * 실제 단가가 다르면 OPENAI_PRICING_JSON 으로 덮어쓴다.
 *
 * ── 음성 메시지 1건 비용 (추정) ─────────────────────────────
 * 가정: 5초 발화 → 번역 음성 약 3초, 대상 언어 1개(1:1 대화)
 *   STT    음성 5초: OpenAI 안내 단가 약 $0.003/분 → 약 $0.00025
 *          + 인식 텍스트 출력 약 20토큰 × $5/1M → 약 $0.0001
 *          = 약 $0.0004
 *   번역   지시문·용어·원문 입력 약 500토큰 × $4/1M          → 약 $0.002
 *          번역문(전사) 출력 약 30토큰 × $24/1M              → 약 $0.0007
 *          번역 음성 3초 ≈ 60토큰 × $64/1M (초당 약 20토큰 가정) → 약 $0.004
 *          추론(low) 토큰 0–100 × $24/1M                    → 0–$0.0024
 *          = 대상 언어 1개당 약 $0.007–0.009
 *   합계   1:1 음성 메시지 1건 ≈ $0.008–0.01  → 월 한도 $5 로 약 500–600건
 *          텍스트 메시지(STT 없음) ≈ 대상 언어당 $0.007–0.009
 *          TRANSLATION_AUDIO=off(기기 TTS 재생)면 대상 언어당 약 $0.003–0.005
 *          그룹·일괄 지시는 수신자 수가 아니라 "대상 언어 수"만큼 곱한다 (언어별 1회 번역)
 * 음성 출력 토큰 비율(초당 약 20토큰)과 추론 토큰 수는 공식 수치가 아닌 추정이다.
 * 실제 비용은 호출마다 openai_usage 테이블에 기록되므로 실호출 후 이 표를 보정한다.
 * (비용 한도 예약은 이보다 넉넉하게 잡아 두었다가 실제 사용량으로 기록한다 — metered.ts)
 */
export const DEFAULT_PRICING: PricingTable = {
  "gpt-realtime-2.1": { inputText: 4, outputText: 24, inputAudio: 32, outputAudio: 64, cachedInput: 0.4 },
  "gpt-realtime-2": { inputText: 4, outputText: 24, inputAudio: 32, outputAudio: 64, cachedInput: 0.4 },
  "gpt-4o-transcribe": { inputText: 2.5, outputText: 10, inputAudio: 6, outputAudio: 0, cachedInput: 2.5 },
  "gpt-4o-mini-transcribe": { inputText: 1.25, outputText: 5, inputAudio: 3, outputAudio: 0, cachedInput: 1.25 },
  "gpt-live-transcribe": { inputText: 0, outputText: 0, inputAudio: 17, outputAudio: 0, cachedInput: 0 },
};

/**
 * 시간(초) 기준으로 청구되는 모델(gpt-live-transcribe, usage.type === "duration")의 환산율: 1분 = 1,000 음성 토큰.
 * 단가표의 inputAudio(USD/1M 토큰) × 이 환산율 = 분당 요금 ÷ 1,000 → gpt-live-transcribe $17/1M ↔ $0.017/분
 */
export const DURATION_AUDIO_TOKENS_PER_SECOND = 1000 / 60;

/** 말한 시간(초)을 단가표 형식(음성 입력 토큰)으로. 올림이라 0초도 0, 짧은 턴은 1토큰 이상 */
export function durationUsage(seconds: number): UsageTokens {
  return { inputAudioTokens: Math.ceil(Math.max(0, seconds) * DURATION_AUDIO_TOKENS_PER_SECOND) };
}

export function buildPricingTable(overrideJson: string | undefined): PricingTable {
  if (!overrideJson) return { ...DEFAULT_PRICING };
  const parsed = z.record(z.string(), priceSchema).safeParse(JSON.parse(overrideJson));
  if (!parsed.success) {
    throw new Error(`OPENAI_PRICING_JSON 형식이 올바르지 않습니다: ${parsed.error.message}`);
  }
  return { ...DEFAULT_PRICING, ...parsed.data };
}

export class UnknownModelPriceError extends Error {
  constructor(readonly model: string) {
    super(`모델 단가가 없습니다: ${model}. OPENAI_PRICING_JSON에 추가하세요.`);
    this.name = "UnknownModelPriceError";
  }
}

export function estimateCostUsd(pricing: PricingTable, model: string, usage: UsageTokens): number {
  const price = pricing[model];
  if (!price) throw new UnknownModelPriceError(model);
  const perToken = (pricePerMillion: number, tokens = 0) => (pricePerMillion * tokens) / 1_000_000;
  return (
    perToken(price.inputText, usage.inputTextTokens) +
    perToken(price.inputAudio, usage.inputAudioTokens) +
    perToken(price.cachedInput, usage.cachedInputTokens) +
    perToken(price.outputText, usage.outputTextTokens) +
    perToken(price.outputAudio, usage.outputAudioTokens)
  );
}
