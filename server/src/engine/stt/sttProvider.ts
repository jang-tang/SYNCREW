import type { Lang } from "../../shared/languages";
import type { PcmAudio } from "../audio/audioPreprocessor";
import type { UsageTokens } from "../budget/pricing";

export type TranscribeInput = {
  audio: PcmAudio;
  /** 발신자 언어 (인식 힌트) */
  lang: Lang;
  /** 현장 용어 힌트 */
  prompt?: string;
};

export type TranscribeOutput = {
  text: string;
  model: string;
  usage: UsageTokens;
};

/** STT 제공자 인터페이스. OpenAI 구현은 Phase 4. */
export interface SttProvider {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<TranscribeOutput>;
}
