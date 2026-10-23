// 스트리밍 통화의 이중 오디오(네이티브 모듈)가 오디오 세션을 쓰는 동안 expo-audio 가 iOS 세션을 바꾸지 못하게 하는 표시.
// expo-audio 의 setAudioModeAsync 는 iOS 에서 세션 범주·모드를 통째로 다시 정한다 — { allowsRecording: false } 는 soloAmbient + 기본 모드,
// { playsInSilentMode: true } 는 playback. 통화 화면에 함께 붙어 있는 발화 단위 녹음기(useHandsFree)가 처음 뜰 때 앞의 것을 불러
// 이중 오디오가 잡은 playAndRecord + voiceChat 을 덮어쓰면, voice processing 엔진이 멈춤 → 재구성 반복 → 반복 보호가 에코 제거를 끈다
// (2026-10-17 iPhone 15 Pro Max: 통화에서만 에코 제거가 꺼지고 점검 화면에서는 켜져 있었음). 네이티브도 덮어쓰기를 감지해 되돌린다.

let held = false;
let waiters: Array<() => void> = [];

/** 이중 오디오가 시작할 때 (native.start 전에 — 시작하는 동안 오는 변경도 막는다) */
export function holdSession(): void {
  held = true;
}

/** 이중 오디오가 멈춘 뒤, 또는 시작에 실패했을 때 */
export function releaseSession(): void {
  held = false;
  const list = waiters;
  waiters = [];
  list.forEach((wake) => wake());
}

export function isSessionHeld(): boolean {
  return held;
}

/** 이중 오디오가 세션을 놓을 때까지 기다린다. 놓았으면 true, timeoutMs 가 지나도 쥐고 있으면 false */
export function waitForRelease(timeoutMs: number): Promise<boolean> {
  if (!held) return Promise.resolve(true);
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w !== wake);
      resolve(false);
    }, timeoutMs);
    waiters.push(wake);
  });
}

export type AudioModeAction = "apply" | "wait" | "skip";

/**
 * expo-audio 모드 변경을 어떻게 할지. iOS 에서 이중 오디오가 세션을 쥐고 있을 때만 다르다:
 * - 녹음을 켜려는 쪽(allowsRecording: true — 스트리밍이 문장 단위로 넘어간 직후의 녹음기 등): 이중 오디오가 놓을 때까지 기다렸다 적용
 * - 그 밖(녹음 끄기·재생용): 건너뛴다. 이중 오디오가 멈출 때 세션을 스스로 정리한다
 * Android 는 expo-audio 가 iOS 처럼 세션 범주를 바꾸지 않으므로 그대로 둔다 (Android 경로 문제는 playback.ts·useHandsFree.ts 에서 따로 처리).
 */
export function audioModeAction(platform: string, allowsRecording: boolean | undefined, sessionHeld: boolean): AudioModeAction {
  if (platform !== "ios" || !sessionHeld) return "apply";
  return allowsRecording ? "wait" : "skip";
}
