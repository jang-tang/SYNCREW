// 마이크 음량 표시용 외부 저장소 (2026-10-20 저사양 폰 최적화)
// 전에는 핸즈프리·스트리밍 훅이 100ms 마다 setLevel 로 통화 화면 전체(메시지 목록 포함)를 다시 그렸다.
// 이제 음량은 React 상태가 아니라 이 저장소에 쓰고, 음량 막대(MicMeter) 하나만 useSyncExternalStore 로 구독한다.
// - 값은 1/20 단계로 양자화해 막대가 실제로 달라질 때만 알린다 (마이크 잡음으로 소수점만 흔들릴 때 다시 그리지 않음)
// - 알림은 최대 10Hz 로 제한한다 (조각이 더 자주 와도 화면은 10번/초 이하)
// 마이크는 한 번에 하나만 켜지므로 앱 전체에 하나면 된다.

const STEPS = 20;
const MIN_INTERVAL_MS = 100;

let value = 0;
let lastNotifiedAt = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  lastNotifiedAt = Date.now();
  pending = null;
  listeners.forEach((listener) => listener());
};

/** 0–1 음량을 기록한다. 화면 갱신은 값이 달라질 때, 10Hz 이하로만 */
export function setMicLevel(level: number): void {
  const next = Math.round(Math.max(0, Math.min(1, level)) * STEPS) / STEPS;
  if (next === value) return;
  value = next;
  if (listeners.size === 0) return;
  if (pending) return;
  const wait = MIN_INTERVAL_MS - (Date.now() - lastNotifiedAt);
  if (wait <= 0) notify();
  else pending = setTimeout(notify, wait);
}

/** dBFS 음량(0 = 최대, -160 = 무음)을 0–1 로 바꿔 기록한다 */
export function setMicLevelDb(levelDb: number): void {
  setMicLevel((levelDb + 60) / 60);
}

export const getMicLevel = (): number => value;

export function subscribeMicLevel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
