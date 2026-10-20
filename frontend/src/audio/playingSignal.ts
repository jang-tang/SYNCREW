// 내 단말의 통역 재생 시작/끝을 서버에 알리는 신호(stream:playing)의 떨림 제거 (docs/realtime-protocol.md 10절, 2026-10-19).
// 서버는 이 신호로 내 마이크 조각을 메아리로 보고 무음으로 바꾼다. 턴과 턴 사이(조각이 잠깐 끊김)에 끝→시작이 빠르게 반복되면
// 서버가 그 사이 조각을 말로 받을 수 있으므로, "끝"은 debounceMs 동안 다시 "시작"이 오지 않을 때만 보낸다. "시작"은 바로 보낸다.

export type PlayingReporter = {
  /** 이중 오디오의 onPlayback 상태를 넣는다 */
  update(playing: boolean): void;
  /** 스트림이 닫힐 때: 기다리던 "끝"은 보내지 않고 상태를 지운다 */
  reset(): void;
};

export function createPlayingReporter(
  send: (playing: boolean) => void,
  options: { debounceMs: number },
  timers: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: never) => void } = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  },
): PlayingReporter {
  let sent: boolean | null = null;
  let pendingStop: unknown = null;
  const cancelStop = () => {
    if (pendingStop !== null) timers.clearTimeout(pendingStop as never);
    pendingStop = null;
  };
  return {
    update(playing) {
      if (playing) {
        cancelStop();
        if (sent !== true) {
          sent = true;
          send(true);
        }
        return;
      }
      if (sent !== true || pendingStop !== null) return;
      pendingStop = timers.setTimeout(() => {
        pendingStop = null;
        sent = false;
        send(false);
      }, options.debounceMs);
    },
    reset() {
      cancelStop();
      sent = null;
    },
  };
}
