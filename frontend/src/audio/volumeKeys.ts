import { Platform } from "react-native";
import { SyncrewDuplex } from "../../modules/syncrew-duplex";
import type { VolumeDirection } from "./callCycle";

// 음량 버튼 누름 받기 (C1, docs/implementation-plan.md C1 3단계). 판정(한 번·두 번)은 callCycle.ts 의 createVolumeKeyDetector.
// - iOS·Android: 네이티브 모듈(modules/syncrew-duplex VolumeKeys)이 누름마다 알리고 음량은 그대로 둔다(되돌림)
// - 웹(e2e 확인용): 키보드 화살표 위·아래 (입력 칸에 글자를 쓰는 중에는 받지 않는다)
// 지켜보는 화면이 여럿이어도 네이티브 시작·정지는 한 번씩만 한다.

const listeners = new Set<(direction: VolumeDirection) => void>();
let stopSource: (() => void) | null = null;

function startSource(): (() => void) | null {
  const emit = (direction: VolumeDirection) => listeners.forEach((listener) => listener(direction));
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable]")) return;
      const direction = event.key === "ArrowUp" || event.key === "AudioVolumeUp" ? "up" : event.key === "ArrowDown" || event.key === "AudioVolumeDown" ? "down" : null;
      if (!direction || event.repeat) return;
      event.preventDefault();
      emit(direction);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }
  const native = SyncrewDuplex;
  if (!native?.startVolumeKeys) return null;
  const subscription = native.addListener("onVolumeKey", (event) => emit(event.direction));
  native.startVolumeKeys();
  return () => {
    subscription.remove();
    native.stopVolumeKeys?.();
  };
}

/** 이 기기에서 음량 버튼을 받을 수 있는지 (이 기능 전에 빌드된 앱이면 false) */
export const volumeKeysAvailable = () => Platform.OS === "web" || !!SyncrewDuplex?.startVolumeKeys;

/** 음량 버튼 누름을 받는다. 돌려준 함수로 그만 받는다 */
export function watchVolumeKeys(listener: (direction: VolumeDirection) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stopSource = startSource();
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) {
      stopSource?.();
      stopSource = null;
    }
  };
}

/** 한 번 누름으로 판정됐을 때 음량을 한 칸 바꾼다 (iOS 는 시스템이 이미 바꿔 아무것도 안 함, 웹도 아무것도 하지 않는다) */
export function stepVolume(direction: VolumeDirection): void {
  if (Platform.OS !== "web") SyncrewDuplex?.stepVolume?.(direction);
}

/** 두 번 누름으로 판정됐을 때 누르기 전 음량으로 되돌린다 (iOS 만 할 일이 있다) */
export function restoreVolume(): void {
  if (Platform.OS !== "web") SyncrewDuplex?.restoreVolume?.();
}
