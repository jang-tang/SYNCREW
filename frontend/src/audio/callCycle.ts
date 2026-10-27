// 통화 중 음량 버튼으로 상대 바꾸기 (C1, docs/implementation-plan.md C1, docs/live-interpretation.md 3-1절, 2026-10-26).
// 음량 증가 두 번 → 다음 멤버, 감소 두 번 → 이전 멤버. 한 번만 누르면 음량만 바뀐다(두 번째를 DOUBLE_PRESS_MS 기다린 뒤).
// 순서는 멤버 탭과 같고(관리자 먼저), 끝에서 다음은 처음·처음에서 이전은 끝으로 돌아간다.
// 네이티브 버튼 신호·통화 바꾸기는 여기서 하지 않는다 — 판정과 순서 계산만 (단위 테스트: e2e/callCycle.test.mjs).

import type { Member } from "@shared/api";

export type VolumeDirection = "up" | "down";

/**
 * 두 번 누르기로 보는 간격. 10-26 실기기(iPhone 17 Pro·Note 9, 휴대폰·헤드셋 버튼) 두 번 누르기 41번: 중간값 0.22초, 90% 0.38초.
 * 처음 0.6초 → 사용자 요청으로 줄임 (한 번 누름의 음량이 이만큼 늦게 바뀐다)
 */
export const DOUBLE_PRESS_MS = 450;

export type VolumeKeyDetector = {
  /** 음량 버튼이 한 번 눌렸다 */
  press(direction: VolumeDirection): void;
  /** 통화가 끝날 때: 기다리던 한 번 누름은 버린다 (음량도 바꾸지 않는다) */
  reset(): void;
};

/**
 * 같은 방향이 windowMs 안에 두 번이면 onDouble, 아니면 windowMs 뒤 onSingle.
 * 다른 방향이 끼면 앞의 누름은 한 번 누름으로 바로 처리하고 새로 센다. 세 번째 누름은 새 첫 누름이다.
 */
export function createVolumeKeyDetector(
  handlers: { onSingle: (direction: VolumeDirection) => void; onDouble: (direction: VolumeDirection) => void },
  options: { windowMs: number },
  timers: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: never) => void } = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  },
): VolumeKeyDetector {
  let pending: { direction: VolumeDirection; timer: unknown } | null = null;
  const clear = () => {
    if (pending) timers.clearTimeout(pending.timer as never);
    pending = null;
  };
  return {
    press(direction) {
      if (pending?.direction === direction) {
        clear();
        handlers.onDouble(direction);
        return;
      }
      if (pending) {
        const previous = pending.direction;
        clear();
        handlers.onSingle(previous);
      }
      const timer = timers.setTimeout(() => {
        pending = null;
        handlers.onSingle(direction);
      }, options.windowMs);
      pending = { direction, timer };
    },
    reset: clear,
  };
}

/** 순회 순서: 현장 활성 멤버(나 제외)를 멤버 탭과 같은 순서로 — 관리자 먼저, 그 안에서는 받은 순서 그대로 */
export function callOrder(members: readonly Member[], myId: string): Member[] {
  return members
    .filter((m) => m.status === "active" && m.userId !== myId)
    .sort((a, b) => Number(b.role === "manager") - Number(a.role === "manager"));
}

/**
 * 지금 상대에서 한 방향으로 한 바퀴 도는 동안 걸 수 있는 사람(접속 중) 순서. 지금 상대는 빠진다.
 * 첫 사람에게 걸고, 그 사이 다른 통화 중(BUSY)이면 다음 사람으로 넘어가는 데 쓴다. 비어 있으면 걸 사람이 없다.
 * 지금 상대가 목록에 없으면(그 사이 현장에서 빠짐) 다음은 처음부터, 이전은 끝부터.
 */
export function cycleCandidates(order: readonly Member[], currentId: string, direction: VolumeDirection): Member[] {
  const count = order.length;
  const step = direction === "up" ? 1 : -1;
  const index = order.findIndex((m) => m.userId === currentId);
  const start = index >= 0 ? index : direction === "up" ? -1 : count;
  const result: Member[] = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const member = order[(((start + step * offset) % count) + count) % count]!;
    if (member.userId !== currentId && member.online) result.push(member);
  }
  return result;
}
