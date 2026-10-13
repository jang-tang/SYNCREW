import { Platform } from "react-native";
import type { DuplexAudio } from "./types";
import { createWebDuplex } from "./web";

export type { AudioFrame, AudioRoute, DuplexAudio } from "./types";

/**
 * 이 기기에서 쓸 수 있는 이중 오디오. 없으면 null → 통화는 발화 단위 방식으로.
 * - 웹: 검증용 구현 (S2)
 * - iOS·Android: S3에서 네이티브 구현을 붙인다 (그 전까지 null)
 */
export function createDuplexAudio(): DuplexAudio | null {
  if (Platform.OS === "web" && typeof window !== "undefined" && "AudioWorkletNode" in window) return createWebDuplex();
  return null;
}
