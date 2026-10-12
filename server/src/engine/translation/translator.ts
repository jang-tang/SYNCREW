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
  /** 번역 음성: PCM16 little-endian mono (Realtime 출력은 24kHz). 서버가 WAV로 감싸 저장한다. */
  audio?: { data: Buffer; sampleRate: number };
  model: string;
  usage: UsageTokens;
};

/** 번역기 인터페이스. 구현: RealtimeTranslator(gpt-realtime-2.1), FakeTranslator(테스트·개발) */
export interface Translator {
  readonly name: string;
  translate(input: TranslateInput): Promise<TranslateOutput>;
}
