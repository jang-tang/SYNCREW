import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { DeviceStatus } from "@shared/api";
import { selectHeadsetInput } from "./audioDevice";
import { enterCallRoute, exitCallRoute } from "./duplex";
import { setMicLevel, setMicLevelDb } from "./micLevel";
import { usePlaybackStore } from "./playback";
import { preprocessRecording } from "./preprocess";
import type { Recording } from "./useVoiceRecorder";
import { createVad } from "./vad";

// 핸즈프리 통역: 통화·일괄 지시가 연결된 동안 계속 듣다가, 말이 끝나면(VAD) 그 구간을 잘라 보내고 바로 다음 구간을 녹음한다.
// - 버튼을 누를 필요가 없다. 받은 통역 음성이 재생되는 동안에는 듣기를 멈춘다(내 이어폰 소리가 다시 들어가지 않게).
// - 블루투스 헤드셋이 있으면 그 마이크를 쓰고, 상태를 onDevice 로 알린다.
// - 진짜 오디오 스트리밍이 아니라 "발화 단위" 전송이다. 지연은 말이 끝난 뒤 처리 시간만큼 생긴다 (docs/live-interpretation.md).
// - 마이크 음량은 React 상태가 아니라 audio/micLevel 저장소에 쓴다 (100ms 마다 화면 전체를 다시 그리지 않게, 2026-10-20)

/** 음성 인식용: 16kHz mono AAC (30초 ≈ 120KB, 서버 제한 2MB 안) */
const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  isMeteringEnabled: true,
  // 통화용 입력: 기기의 에코 제거·자동 음량 조절을 쓰고, 블루투스 SCO 마이크와 함께 동작한다.
  android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource: "voice_communication" },
};

const TICK_MS = 100;
/** 헤드셋 연결·해제 확인 간격 */
const DEVICE_CHECK_MS = 5000;

export type HandsFreeState =
  /** 꺼짐 */
  | "off"
  /** 마이크 준비 중 */
  | "starting"
  /** 듣는 중 (말하면 자동 감지) */
  | "listening"
  /** 말하는 중 */
  | "speaking"
  /** 받은 통역 재생 중이라 잠시 멈춤 */
  | "paused"
  /** 내가 마이크를 끔 */
  | "muted"
  /** 마이크 권한 없음·녹음 실패 */
  | "error";

export type HandsFreeError = "permission" | "failed";

export function useHandsFree(options: {
  /** 세션이 연결된 동안 true */
  active: boolean;
  muted: boolean;
  /** 보낸 발화. Promise 를 돌려주면 iOS 에서는 끝날 때까지 다음 녹음을 시작하지 않는다 (아래 cut 참고) */
  onUtterance: (recording: Recording) => void | Promise<unknown>;
  onDevice?: (device: DeviceStatus) => void;
}) {
  const recorder = useAudioRecorder(OPTIONS);
  const playing = usePlaybackStore((state) => state.playingId !== null);
  const [state, setState] = useState<HandsFreeState>("off");
  const [error, setError] = useState<HandsFreeError | null>(null);
  const [device, setDevice] = useState<DeviceStatus | null>(null);

  // 최신 콜백·상태를 타이머 안에서 쓰기 위한 참조
  const callbacks = useRef(options);
  callbacks.current = options;
  const loop = useRef({ recording: false, busy: false, speaking: false, startedAt: 0 });
  const vad = useRef(createVad());

  const reportDevice = (next: DeviceStatus) => {
    setDevice((current) => {
      if (current && current.audioRoute === next.audioRoute && current.inputName === next.inputName && current.micPermission === next.micPermission) {
        return current;
      }
      callbacks.current.onDevice?.(next);
      return next;
    });
  };

  const paused = options.muted || playing;
  const shouldRecord = options.active && !paused && error === null;

  // ─── 녹음 구간 시작·종료 ───────────────────────────

  async function startSegment() {
    const l = loop.current;
    await recorder.prepareToRecordAsync();
    recorder.record();
    l.recording = true;
    l.speaking = false;
    l.startedAt = Date.now();
    vad.current.reset(Date.now());
  }

  async function stopSegment(): Promise<Recording | null> {
    const l = loop.current;
    if (!l.recording) return null;
    l.recording = false;
    const durationMs = Date.now() - l.startedAt;
    try {
      await recorder.stop();
    } catch {
      return null;
    }
    if (!recorder.uri) return null;
    return { uri: recorder.uri, mimeType: Platform.OS === "web" ? "audio/webm" : "audio/mp4", durationMs };
  }

  /** 구간을 끝내고(보내거나 버리고) 계속 들어야 하면 다음 구간을 시작한다 */
  async function cut(send: boolean) {
    const l = loop.current;
    l.busy = true;
    try {
      const recording = await stopSegment();
      if (send && recording) {
        const uri = await preprocessRecording(recording.uri);
        const sending = callbacks.current.onUtterance({ ...recording, uri });
        // iOS 녹음기는 다음 녹음을 같은 파일 경로에 다시 쓰므로, 업로드가 파일을 다 읽기 전에 다음 녹음을 시작하면
        // 빈 파일(28바이트)이 올라간다 (2026-10-14 iPhone 17 Pro 실기기에서 발견). Android 는 매번 새 파일이라 기다리지 않는다.
        if (Platform.OS === "ios") await Promise.resolve(sending).catch(() => undefined);
      }
      if (shouldRecordRef.current) {
        await startSegment();
        setState("listening");
      } else {
        // 발화 중에 통역 재생이 시작됐거나 마이크를 끈 경우: 이 발화를 보낸 뒤 멈춘다
        setState(callbacks.current.muted ? "muted" : "paused");
      }
    } catch {
      setError("failed");
      setState("error");
    } finally {
      l.busy = false;
      setMicLevel(0);
    }
  }

  const shouldRecordRef = useRef(shouldRecord);
  shouldRecordRef.current = shouldRecord;

  // ─── 켜기·끄기·일시 정지 ───────────────────────────

  useEffect(() => {
    let cancelled = false;
    const l = loop.current;

    if (!options.active) {
      setState("off");
      setError(null);
      return;
    }
    if (error) return;

    if (!shouldRecord) {
      // 말하는 도중에 통역 재생이 시작되면 그 발화는 끝까지 듣고 보낸다 (끊으면 말이 잘린다)
      if (l.speaking && !options.muted) return;
      setState(options.muted ? "muted" : "paused");
      if (l.recording && !l.busy) void stopSegment();
      return;
    }

    (async () => {
      setState("starting");
      const permission = await requestRecordingPermissionsAsync().catch(() => null);
      if (cancelled) return;
      if (!permission?.granted) {
        setError("permission");
        setState("error");
        reportDevice({ audioRoute: "unknown", inputName: null, micPermission: "denied" });
        return;
      }
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: "doNotMix",
          shouldRouteThroughEarpiece: false,
        });
        // Android: 통신 모드 + 블루투스 헤드셋 SCO 를 먼저 연다 (녹음기가 헤드셋 마이크를 받도록)
        await enterCallRoute();
        if (!l.recording && !l.busy) await startSegment();
        if (cancelled) return;
        reportDevice({ ...(await detectDevice()), micPermission: "granted" });
        setState("listening");
      } catch {
        setError("failed");
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.active, shouldRecord, error]);

  // 세션이 끝나면 녹음을 멈추고 녹음 모드·통화 경로를 푼다
  useEffect(() => {
    if (options.active) return;
    void stopSegment()
      .then(() => setAudioModeAsync({ allowsRecording: false }).catch(() => undefined))
      .then(() => exitCallRoute());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.active]);

  // 화면을 떠날 때도 통화 경로를 푼다
  useEffect(() => () => void exitCallRoute(), []);

  /** 지금 쓰는 입력 장치: Android 는 통화 경로(통신 장치)를 다시 맞춘 결과, 그 밖에는 녹음기 입력 */
  async function detectDevice(): Promise<Pick<DeviceStatus, "audioRoute" | "inputName">> {
    const call = await enterCallRoute();
    if (call && call.route !== "unknown") {
      return { audioRoute: call.route === "speaker" ? "builtin" : call.route, inputName: call.name };
    }
    return selectHeadsetInput(recorder);
  }

  // ─── 음량 감시 → 말 시작·끝 ─────────────────────────

  useEffect(() => {
    if (!options.active) return;
    const timer = setInterval(() => {
      const l = loop.current;
      if (!l.recording || l.busy) return;
      const metering = recorder.getStatus().metering ?? -160;
      // Android(expo-audio)는 음량을 읽을 때마다 값이 초기화돼 중간중간 -160(값 없음)이 끼어든다. 무음이 아니라 "측정 없음"이므로 건너뛴다. (실제 무음도 마이크 잡음 때문에 -50 안팎이다)
      if (Platform.OS !== "web" && metering <= -160) return;
      setMicLevelDb(metering);
      const event = vad.current.push(metering, Date.now());
      if (!event) return;
      if (event.type === "speechStart") {
        l.speaking = true;
        setState("speaking");
      } else {
        l.speaking = false;
        void cut(event.type === "utteranceEnd");
      }
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.active]);

  // ─── 헤드셋 연결·해제 감시 ──────────────────────────

  useEffect(() => {
    if (!options.active) return;
    const timer = setInterval(() => {
      if (!loop.current.recording) return;
      void detectDevice().then((input) => reportDevice({ ...input, micPermission: "granted" }));
    }, DEVICE_CHECK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.active]);

  /** 권한 오류 뒤 다시 시도 (설정에서 권한을 켠 뒤) */
  const retry = () => {
    setError(null);
  };

  return { state, error, device, retry };
}
