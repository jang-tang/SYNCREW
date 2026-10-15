import { requireOptionalNativeModule } from "expo";

// SYNCREW 이중 오디오 네이티브 모듈의 JS 쪽 계약 (구현: ios/SyncrewDuplexModule.swift, android/.../SyncrewDuplexModule.kt).
// 앱 코드는 이 파일을 직접 쓰지 않고 src/audio/duplex/native.ts 의 DuplexAudio 어댑터를 쓴다.
// PCM 은 이벤트·함수 경계에서 base64 문자열로 주고받는다 (100ms × 16kHz × 2바이트 = 3,200바이트 → 약 4.3KB, 초당 10번).

export type NativeRoute = "bluetooth" | "wired" | "speaker" | "unknown";

export type NativeFrameEvent = {
  /** PCM16 mono little-endian, base64 */
  pcm: string;
  /** 캡처 시각 (ms, epoch) */
  timestamp: number;
};

export type NativeRouteEvent = { route: NativeRoute; name: string | null };
export type NativePlaybackEvent = { streamId: string | null; playing: boolean };
export type NativeErrorEvent = { code: string; message: string };

type Subscription = { remove(): void };

export interface SyncrewDuplexNative {
  /** 통화용 오디오 세션을 열고 캡처·재생을 시작한다. 마이크 권한이 없으면 code "permission" 으로 거부 */
  start(sampleRate: number, frameMs: number, echoCancellation: boolean): Promise<void>;
  stop(): Promise<void>;
  /** 받은 음성 조각 재생 (같은 streamId 는 이어서, 새 streamId 는 앞 조각 뒤에) */
  enqueue(streamId: string, pcmBase64: string, sampleRate: number): void;
  endStream(streamId: string): void;
  stopPlayback(): void;
  /**
   * 녹음기를 따로 쓰는 경우(발화 단위 통화)에 통화용 오디오 경로만 잡는다: Android 는 통신 모드 + 블루투스 헤드셋(SCO)·유선·스피커 선택.
   * iOS 는 expo-audio 가 처리하므로 현재 경로만 돌려준다.
   */
  enterCallRoute(): Promise<NativeRouteEvent>;
  exitCallRoute(): Promise<void>;
  addListener(event: "onFrame", listener: (event: NativeFrameEvent) => void): Subscription;
  addListener(event: "onRoute", listener: (event: NativeRouteEvent) => void): Subscription;
  addListener(event: "onPlayback", listener: (event: NativePlaybackEvent) => void): Subscription;
  addListener(event: "onError", listener: (event: NativeErrorEvent) => void): Subscription;
}

/** 네이티브 모듈 (웹, 또는 이 모듈 없이 빌드된 앱이면 null → 통화는 발화 단위 방식) */
export const SyncrewDuplex = requireOptionalNativeModule<SyncrewDuplexNative>("SyncrewDuplex");
