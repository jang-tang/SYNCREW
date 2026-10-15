import { requestRecordingPermissionsAsync } from "expo-audio";
import { Platform } from "react-native";
import { SyncrewDuplex } from "../../../modules/syncrew-duplex";
import { createNativeDuplex } from "./native";
import type { AudioRoute, DuplexAudio } from "./types";
import { createWebDuplex } from "./web";

export type { AudioFrame, AudioRoute, DuplexAudio } from "./types";

let nativeDuplex: DuplexAudio | null | undefined;

/**
 * 이 기기에서 쓸 수 있는 이중 오디오. 없으면 null → 통화는 발화 단위 방식으로.
 * - 웹: 검증용 구현 (S2)
 * - iOS·Android: 네이티브 모듈 modules/syncrew-duplex (S3). 모듈 없이 빌드된 앱이면 null
 */
export function createDuplexAudio(): DuplexAudio | null {
  if (Platform.OS === "web") {
    return typeof window !== "undefined" && "AudioWorkletNode" in window ? createWebDuplex() : null;
  }
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  if (nativeDuplex === undefined) {
    nativeDuplex = SyncrewDuplex
      ? createNativeDuplex(SyncrewDuplex, async () => (await requestRecordingPermissionsAsync()).granted)
      : null;
  }
  return nativeDuplex;
}

/**
 * 발화 단위 통화(expo-audio 녹음)의 통화용 경로를 잡는다.
 * Android: 통신 모드 + 블루투스 헤드셋 SCO(없으면 유선·스피커) — 이게 없으면 헤드셋 마이크가 무음이다 (2026-10-14 실기기).
 * iOS·웹: expo-audio 가 처리하므로 아무것도 하지 않는다 (null).
 */
export async function enterCallRoute(): Promise<{ route: AudioRoute; name: string | null } | null> {
  if (Platform.OS !== "android" || !SyncrewDuplex) return null;
  try {
    return await SyncrewDuplex.enterCallRoute();
  } catch {
    return null;
  }
}

export async function exitCallRoute(): Promise<void> {
  if (Platform.OS !== "android" || !SyncrewDuplex) return;
  await SyncrewDuplex.exitCallRoute().catch(() => undefined);
}
