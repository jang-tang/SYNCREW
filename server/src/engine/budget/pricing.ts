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
 * 기본 단가 (2026-10-10 확인).
 * - gpt-realtime-2: OpenAI 모델 페이지 기준
 * - gpt-4o-mini-transcribe: 공식 단가를 확인하지 못해 보수적으로 추정한 값
 * 실제 단가가 다르면 OPENAI_PRICING_JSON 으로 덮어쓴다.
 */
export const DEFAULT_PRICING: PricingTable = {
  "gpt-realtime-2": { inputText: 4, outputText: 24, inputAudio: 32, outputAudio: 64, cachedInput: 0.4 },
  "gpt-4o-mini-transcribe": { inputText: 1.25, outputText: 5, inputAudio: 3, outputAudio: 0, cachedInput: 1.25 },
};

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
