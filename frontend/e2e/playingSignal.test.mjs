// 통역 재생 신호(stream:playing) 떨림 제거 단위 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayingReporter } from "../src/audio/playingSignal.ts";

/** 가짜 타이머: 등록한 순서대로 시각을 가진다 */
function fakeTimers() {
  let now = 0;
  const queue = [];
  return {
    setTimeout(fn, ms) {
      const handle = { at: now + ms, fn };
      queue.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      const i = queue.indexOf(handle);
      if (i >= 0) queue.splice(i, 1);
    },
    advance(ms) {
      now += ms;
      for (const handle of [...queue].sort((a, b) => a.at - b.at)) {
        if (handle.at > now) break;
        queue.splice(queue.indexOf(handle), 1);
        handle.fn();
      }
    },
  };
}

function setup() {
  const sent = [];
  const timers = fakeTimers();
  const reporter = createPlayingReporter((playing) => sent.push(playing), { debounceMs: 200 }, timers);
  return { sent, timers, reporter };
}

test("재생 시작은 바로 보내고, 같은 상태는 다시 보내지 않는다", () => {
  const { sent, reporter } = setup();
  reporter.update(true);
  reporter.update(true);
  assert.deepEqual(sent, [true]);
});

test("재생 끝은 200ms 뒤에 보낸다 (그 사이 시작이 오면 보내지 않는다 — 턴 사이 짧은 끊김)", () => {
  const { sent, timers, reporter } = setup();
  reporter.update(true);
  reporter.update(false);
  timers.advance(150);
  assert.deepEqual(sent, [true]); // 아직
  reporter.update(true); // 200ms 안에 다음 턴 재생 시작
  timers.advance(300);
  assert.deepEqual(sent, [true]); // 끝·시작 모두 보내지 않음
  reporter.update(false);
  timers.advance(200);
  assert.deepEqual(sent, [true, false]);
});

test("시작 전의 끝은 보내지 않고, reset 뒤에는 기다리던 끝을 버리고 다시 시작부터 보낸다", () => {
  const { sent, timers, reporter } = setup();
  reporter.update(false);
  timers.advance(500);
  assert.deepEqual(sent, []);
  reporter.update(true);
  reporter.update(false);
  reporter.reset();
  timers.advance(500);
  assert.deepEqual(sent, [true]);
  reporter.update(true);
  assert.deepEqual(sent, [true, true]);
});
