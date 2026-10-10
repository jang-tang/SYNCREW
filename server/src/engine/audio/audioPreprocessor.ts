import type { Lang } from "../../shared/languages";

/** 노이즈 필터 등 전처리기가 주고받는 오디오. PCM16 mono. */
export type PcmAudio = {
  data: Int16Array;
  sampleRate: number;
};

export type PreprocessContext = {
  siteId: string;
  userId: string;
  lang: Lang;
};

/**
 * 음성 전처리 플러그인 인터페이스 (딥러닝 노이즈 필터는 다른 개발자가 구현).
 * 구현체는 src/plugins/audioPreprocessor.ts 에 등록한다.
 */
export interface AudioPreprocessor {
  readonly name: string;
  process(audio: PcmAudio, context: PreprocessContext): Promise<PcmAudio>;
}

/** 기본값: 입력을 그대로 돌려준다. */
export class PassthroughPreprocessor implements AudioPreprocessor {
  readonly name = "passthrough";

  async process(audio: PcmAudio): Promise<PcmAudio> {
    return audio;
  }
}

export type SafePreprocessResult = {
  audio: PcmAudio;
  applied: boolean;
  /** 원본으로 대체한 이유 */
  fallbackReason?: "error" | "timeout" | "invalid_output";
  durationMs: number;
};

/**
 * 전처리기를 안전하게 실행한다. 오류·시간 초과·잘못된 출력이면 원본 오디오로 진행해
 * 노이즈 필터 문제로 통역 전체가 멈추지 않게 한다.
 */
export async function runPreprocessorSafely(
  preprocessor: AudioPreprocessor,
  audio: PcmAudio,
  context: PreprocessContext,
  options: { timeoutMs: number; onFallback?: (reason: string, error?: unknown) => void },
): Promise<SafePreprocessResult> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), options.timeoutMs);
  });

  try {
    const outcome = await Promise.race([preprocessor.process(audio, context), timeout]);
    if (outcome === "timeout") {
      options.onFallback?.("timeout");
      return { audio, applied: false, fallbackReason: "timeout", durationMs: elapsed() };
    }
    if (!(outcome?.data instanceof Int16Array) || !(outcome.sampleRate > 0)) {
      options.onFallback?.("invalid_output");
      return { audio, applied: false, fallbackReason: "invalid_output", durationMs: elapsed() };
    }
    return { audio: outcome, applied: true, durationMs: elapsed() };
  } catch (error) {
    options.onFallback?.("error", error);
    return { audio, applied: false, fallbackReason: "error", durationMs: elapsed() };
  } finally {
    clearTimeout(timer);
  }
}
