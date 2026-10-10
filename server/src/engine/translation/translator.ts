import type { Lang } from "../../shared/languages";
import type { UsageTokens } from "../budget/pricing";
import type { TranslationContext } from "../domain/domainProcessor";

export type TranslateInput = {
  /** 현장 특화 처리로 보정된 원문 */
  text: string;
  sourceLang: Lang;
  targetLang: Lang;
  context: TranslationContext;
  /** 번역 음성도 생성할지 */
  withAudio: boolean;
};

export type TranslateOutput = {
  text: string;
  /** PCM16 24kHz mono 등 번역기 출력 음성 */
  audio?: { data: Buffer; mime: string };
  model: string;
  usage: UsageTokens;
};

/** 번역기 인터페이스. gpt-realtime-2 구현(RealtimeTranslator)은 Phase 4. */
export interface Translator {
  readonly name: string;
  translate(input: TranslateInput): Promise<TranslateOutput>;
}
