import type { AudioRecorder } from "expo-audio";
import type { DeviceStatus } from "@shared/api";

// 오디오 입력 장치 판별·선택 (블루투스 헤드셋 우선)
// expo-audio 가 알려 주는 입력 종류: iOS AVAudioSession 포트 이름(BluetoothHFP, MicrophoneBuiltIn, MicrophoneWired …),
// Android(BluetoothSCO, MicrophoneBuiltIn, MicrophoneWired …). 웹은 장치 이름만 알 수 있다.
// 출력 경로는 확인할 수 없으므로, 블루투스 입력(HFP/SCO)을 쓰면 통역 음성도 같은 헤드셋으로 나간다고 본다.

type Input = { name: string; type: string; uid: string };

export function routeOf(input: Input | null | undefined): DeviceStatus["audioRoute"] {
  if (!input) return "unknown";
  const type = input.type.toLowerCase();
  if (type.includes("bluetooth")) return "bluetooth";
  if (type.includes("wired") || type.includes("headset")) return "wired";
  if (type.includes("builtin")) return "builtin";
  return "unknown";
}

/**
 * 블루투스 헤드셋 입력이 있으면 그것으로 바꾼다 (Android 는 SCO 연결, iOS 는 HFP 입력 선택).
 * 녹음기가 준비(prepare)된 뒤에만 부를 수 있다. 확인할 수 없으면 unknown 으로 돌려준다.
 */
export async function selectHeadsetInput(recorder: AudioRecorder): Promise<Pick<DeviceStatus, "audioRoute" | "inputName">> {
  try {
    const inputs = recorder.getAvailableInputs() as Input[];
    const bluetooth = inputs.find((input) => routeOf(input) === "bluetooth");
    const wired = inputs.find((input) => routeOf(input) === "wired");
    const preferred = bluetooth ?? wired;
    if (preferred) {
      try {
        recorder.setInput(preferred.uid);
      } catch {
        // 일부 기기(Android 9 이하 등)는 입력 선택을 지원하지 않는다. 기본 입력으로 진행.
      }
    }
    const current = (await recorder.getCurrentInput().catch(() => null)) as Input | null;
    const used = current ?? preferred ?? inputs[0] ?? null;
    return { audioRoute: routeOf(used), inputName: used?.name ?? null };
  } catch {
    return { audioRoute: "unknown", inputName: null };
  }
}
