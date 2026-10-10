// ─────────────────────────────────────────────────────────────
// 노이즈 필터 연결 지점
//
// 다른 개발자가 만든 딥러닝 노이즈 필터는 AudioPreprocessor 인터페이스를 구현한 뒤
// 아래 PREPROCESSORS 에 이름과 함께 등록하고, .env 의 AUDIO_PREPROCESSOR 에 그 이름을 적는다.
//
//   입력/출력: PCM16 mono (Int16Array) + sampleRate. 서버 파이프라인은 16kHz로 넘긴다.
//   제한: 3초 안에 끝나야 하며, 오류·시간 초과 시 원본 오디오로 통역을 계속한다.
// ─────────────────────────────────────────────────────────────
import { PassthroughPreprocessor, type AudioPreprocessor } from "../engine/audio/audioPreprocessor";

const PREPROCESSORS: Record<string, () => AudioPreprocessor> = {
  passthrough: () => new PassthroughPreprocessor(),
  // "dl-noise-filter": () => new DeepLearningNoiseFilter(),
};

export const PREPROCESS_TIMEOUT_MS = 3000;

export function createAudioPreprocessor(name: string): AudioPreprocessor {
  const factory = PREPROCESSORS[name];
  if (!factory) {
    throw new Error(
      `알 수 없는 AUDIO_PREPROCESSOR: ${name}. 사용 가능: ${Object.keys(PREPROCESSORS).join(", ")}`,
    );
  }
  return factory();
}
