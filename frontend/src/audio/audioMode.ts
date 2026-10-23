import { setAudioModeAsync } from "expo-audio";
import { Platform } from "react-native";
import { audioModeAction, isSessionHeld, waitForRelease } from "./sessionOwner";

type AudioModeOptions = Parameters<typeof setAudioModeAsync>[0];

/** 녹음을 켜려는 쪽이 이중 오디오가 멈추기를 기다리는 최대 시간 (보통 1초 안에 멈춘다. 넘으면 예전처럼 그냥 적용) */
const RELEASE_WAIT_MS = 3_000;

/**
 * expo-audio 의 setAudioModeAsync 대신 쓴다. iOS 에서 스트리밍 통화의 이중 오디오가 세션을 쓰는 동안에는 덮어쓰지 않는다
 * (이유: sessionOwner.ts). 적용했으면 true, 건너뛰었으면 false. 오류는 setAudioModeAsync 와 같이 던진다.
 */
export async function setAudioMode(mode: AudioModeOptions): Promise<boolean> {
  const action = audioModeAction(Platform.OS, mode.allowsRecording, isSessionHeld());
  if (action === "skip") {
    if (__DEV__) console.log(`[audio-mode] skipped while streaming call holds the session: ${JSON.stringify(mode)}`);
    return false;
  }
  if (action === "wait") await waitForRelease(RELEASE_WAIT_MS);
  await setAudioModeAsync(mode);
  return true;
}
