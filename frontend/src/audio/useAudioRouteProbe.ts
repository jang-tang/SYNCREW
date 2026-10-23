import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import type { DeviceStatus } from "@shared/api";
import { selectHeadsetInput } from "./audioDevice";
import { setAudioMode } from "./audioMode";

const CHECK_MS = 10_000;

/**
 * 듣기만 하는 화면(일괄 지시 수신)에서 이어폰 연결 상태를 확인한다.
 * 입력 장치 목록은 녹음기를 준비해야 알 수 있으므로 녹음은 하지 않고 준비만 한다.
 * 블루투스 헤드셋 입력을 고르면 통역 음성도 그 헤드셋으로 나간다.
 */
export function useAudioRouteProbe(enabled: boolean, onDevice: (device: DeviceStatus) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const callback = useRef(onDevice);
  callback.current = onDevice;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const report = (next: DeviceStatus) => {
      if (cancelled) return;
      setDevice((current) => {
        if (current && current.audioRoute === next.audioRoute && current.inputName === next.inputName && current.micPermission === next.micPermission) {
          return current;
        }
        callback.current(next);
        return next;
      });
    };
    const check = async (prepare: boolean) => {
      try {
        if (prepare) {
          const permission = await requestRecordingPermissionsAsync();
          if (!permission.granted) return report({ audioRoute: "unknown", inputName: null, micPermission: "denied" });
          await setAudioMode({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
          await recorder.prepareToRecordAsync();
        }
        report({ ...(await selectHeadsetInput(recorder)), micPermission: "granted" });
      } catch {
        report({ audioRoute: "unknown", inputName: null, micPermission: "granted" });
      }
    };
    void check(true);
    const timer = setInterval(() => void check(false), CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      void setAudioMode({ allowsRecording: false }).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return device;
}
