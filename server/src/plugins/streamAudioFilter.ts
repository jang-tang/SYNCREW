// ─────────────────────────────────────────────────────────────
// 스트리밍 통화용 노이즈 필터 연결 지점 (2026-10-14 결정: 노이즈 필터는 서버에서 실행)
//
// 담당 개발자는 StreamAudioFilter 인터페이스(src/engine/audio/streamAudioFilter.ts)를 구현해
// 아래 STREAM_FILTERS 에 이름과 함께 등록하고, .env 의 STREAM_AUDIO_FILTER 에 그 이름을 적는다.
//
//   입력/출력: PCM16 mono Int16Array 100ms 조각 (앱 기본 16kHz → 1600표본), 같은 길이로 돌려줄 것
//   제한: 조각당 50ms 안에 끝나야 한다. 오류·시간 초과·길이가 다른 출력이면 원본 조각을 쓰고,
//         연속 5번 실패하면 그 통화에서 필터를 끈다 (통역은 계속된다)
//   발화 단위 방식(녹음 전체)은 별도 플러그인 src/plugins/audioPreprocessor.ts 를 쓴다
// ─────────────────────────────────────────────────────────────
import { SidecarStreamFilter } from "../engine/audio/sidecarStreamFilter";
import { PassthroughStreamFilter, type StreamAudioFilter } from "../engine/audio/streamAudioFilter";

const STREAM_FILTERS: Record<string, () => StreamAudioFilter> = {
  passthrough: () => new PassthroughStreamFilter(),
  // 노이즈 필터 사이드카 컨테이너 (규격 docs/denoise-sidecar.md, compose 서비스 denoise)
  sidecar: () => new SidecarStreamFilter(process.env.DENOISE_URL ?? "ws://denoise:8765"),
  // "dl-noise-filter-stream": () => new DeepLearningStreamFilter(),
};

export function createStreamAudioFilter(name: string): StreamAudioFilter {
  const factory = STREAM_FILTERS[name];
  if (!factory) {
    throw new Error(`알 수 없는 STREAM_AUDIO_FILTER: ${name}. 사용 가능: ${Object.keys(STREAM_FILTERS).join(", ")}`);
  }
  return factory();
}
