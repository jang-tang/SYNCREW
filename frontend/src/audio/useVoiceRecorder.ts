import {
  requestRecordingPermissionsAsync,
  RecordingPresets,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { useRef, useState } from "react";
import { Platform } from "react-native";
import { setAudioMode } from "./audioMode";
import { preprocessRecording } from "./preprocess";
import { stopPlayback } from "./playback";

// Android: 음성 인식용 입력 소스로 기기의 노이즈 억제를 활용한다.
const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource: "voice_recognition" },
};

/** 이보다 짧은 녹음은 실수로 누른 것으로 보고 버린다. */
const MIN_DURATION_MS = 600;

export type Recording = { uri: string; mimeType: string; durationMs: number };
export type RecorderError = "permission" | "too_short" | "failed";

/** 누르고 말하기용 녹음 */
export function useVoiceRecorder() {
  const recorder = useAudioRecorder(OPTIONS);
  const [isRecording, setRecording] = useState(false);
  const startedAt = useRef(0);
  const starting = useRef<Promise<void> | null>(null);

  async function start(): Promise<RecorderError | null> {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return "permission";
    try {
      stopPlayback();
      starting.current = (async () => {
        await setAudioMode({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      })();
      await starting.current;
      startedAt.current = Date.now();
      setRecording(true);
      return null;
    } catch {
      return "failed";
    } finally {
      starting.current = null;
    }
  }

  /** 녹음을 끝내고 파일을 돌려준다. 너무 짧으면 too_short. */
  async function stop(): Promise<Recording | RecorderError> {
    if (starting.current) await starting.current.catch(() => undefined);
    if (!recorder.isRecording && !isRecording) return "failed";
    const durationMs = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } finally {
      setRecording(false);
      await setAudioMode({ allowsRecording: false }).catch(() => undefined);
    }
    if (durationMs < MIN_DURATION_MS) return "too_short";
    if (!recorder.uri) return "failed";
    const uri = await preprocessRecording(recorder.uri);
    return { uri, mimeType: Platform.OS === "web" ? "audio/webm" : "audio/mp4", durationMs };
  }

  return { isRecording, start, stop };
}
