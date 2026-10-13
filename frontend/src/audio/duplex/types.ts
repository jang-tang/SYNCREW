// 이중(동시 녹음·재생) 오디오 인터페이스 (docs/streaming-plan.md 2절 D2).
// 스트리밍 통화 코드는 이 인터페이스에만 의존한다. 구현: 웹(web.ts, 검증용) / 네이티브(S3에서 라이브러리 또는 자체 모듈).

export type AudioFrame = {
  /** PCM16 mono little-endian */
  pcm: ArrayBuffer;
  /** 이 조각의 음량 (dBFS, 0 = 최대, -160 = 무음) */
  levelDb: number;
  timestamp: number;
};

export type AudioRoute = "bluetooth" | "wired" | "speaker" | "unknown";

export type DuplexStartOptions = {
  sampleRate: 16000;
  frameMs: 100;
  echoCancellation: boolean;
};

export interface DuplexAudio {
  /** 마이크 권한이 없으면 Error("permission") */
  start(options: DuplexStartOptions): Promise<void>;
  stop(): Promise<void>;
  onFrame(listener: (frame: AudioFrame) => void): () => void;
  /** 받은 음성 조각을 streamId(턴) 별로 이어서 재생 (첫 조각 앞에 지터 버퍼) */
  enqueue(streamId: string, pcm: ArrayBuffer, sampleRate: number): void;
  /** 이 턴의 조각이 더 오지 않음 (남은 조각은 끝까지 재생) */
  endStream(streamId: string): void;
  stopPlayback(): void;
  onRoute(listener: (route: AudioRoute, deviceName?: string) => void): () => void;
  onPlayback(listener: (state: { streamId: string | null; playing: boolean }) => void): () => void;
}

/** PCM16 조각의 음량 (dBFS) */
export function levelDbOf(pcm: Int16Array): number {
  if (pcm.length === 0) return -160;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  const rms = Math.sqrt(sum / pcm.length) / 32768;
  return rms > 0 ? Math.max(-160, 20 * Math.log10(rms)) : -160;
}
