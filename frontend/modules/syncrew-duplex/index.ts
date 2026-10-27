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

export type NativeRouteEvent = {
  route: NativeRoute;
  name: string | null;
  /** iOS: 지금 엔진에 에코 제거(voice processing)가 켜져 있는지. Android 는 보내지 않는다 */
  voiceProcessing?: boolean;
};
export type NativePlaybackEvent = { streamId: string | null; playing: boolean };
export type NativeErrorEvent = { code: string; message: string };
/** 음량 버튼 한 번 누름 (C1). 음량은 네이티브가 이미 되돌렸다(또는 바뀌지 않았다) */
export type NativeVolumeKeyEvent = { direction: "up" | "down" };

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
  /**
   * Android: 통화 경로(enterCallRoute)가 잡혀 있으면 음성 파일(URL)을 통화 용도로 재생하고, 끝나면 true.
   * 경로가 없으면 바로 false. expo-audio 재생기는 미디어 용도라 블루투스 SCO 중에는 헤드셋에서 들리지 않는다 (2026-10-23).
   * iOS 에는 없다 (expo-audio 가 통화 세션으로 재생).
   */
  playInCall?(url: string): Promise<boolean>;
  stopInCall?(): void;
  /**
   * iOS 실기기 시험용: 스피커 에코 제거 꺼짐(docs/streaming-plan.md 5-7절) 후보를 쉼표로 켠다 (다음 start 부터).
   * noInPlace(10-27 부터 inPlace 가 기본, 끄기)·connect48·connectHw·modeDefault·noIOBuffer. Android 에는 없다
   */
  setExperiments?(raw: string): void;
  /**
   * 통화 중 음량 버튼으로 상대 바꾸기 (C1): 지켜보는 동안 누를 때마다 onVolumeKey. JS 가 판정한 뒤
   * 한 번 누름 → stepVolume (Android: 한 칸 바꿈 / iOS: 시스템이 이미 바꿨으므로 아무것도 안 함),
   * 두 번 누름 → restoreVolume (iOS: 처음 누르기 전 음량으로 / Android: 누름마다 막거나 되돌렸으므로 아무것도 안 함).
   * Android 휴대폰 버튼은 입력을 가로채고, Android 헤드셋 버튼은 바뀐 음량을 곧바로 되돌린다. 이 기능 전에 빌드된 앱에는 없다
   */
  startVolumeKeys?(): void;
  stopVolumeKeys?(): void;
  stepVolume?(direction: "up" | "down"): void;
  restoreVolume?(): void;
  addListener(event: "onFrame", listener: (event: NativeFrameEvent) => void): Subscription;
  addListener(event: "onRoute", listener: (event: NativeRouteEvent) => void): Subscription;
  addListener(event: "onPlayback", listener: (event: NativePlaybackEvent) => void): Subscription;
  addListener(event: "onError", listener: (event: NativeErrorEvent) => void): Subscription;
  addListener(event: "onVolumeKey", listener: (event: NativeVolumeKeyEvent) => void): Subscription;
}

/** 네이티브 모듈 (웹, 또는 이 모듈 없이 빌드된 앱이면 null → 통화는 발화 단위 방식) */
export const SyncrewDuplex = requireOptionalNativeModule<SyncrewDuplexNative>("SyncrewDuplex");
