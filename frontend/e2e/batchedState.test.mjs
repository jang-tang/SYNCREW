// 자막 조각 갱신 모으기 단위 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { createBatchedUpdater } from "../src/audio/batchedState.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** setState 흉내: 적용 횟수와 최종 상태를 기록 */
function harness(initial) {
  const h = { state: initial, applies: 0, apply(reducer) { h.applies += 1; h.state = reducer(h.state); } };
  return h;
}

test("창 안의 조각은 한 번의 setState 로 순서대로 적용된다", async () => {
  const h = harness("");
  const b = createBatchedUpdater(h.apply, 30);
  b.queue((s) => s + "a");
  b.queue((s) => s + "b");
  b.queue((s) => s + "c");
  assert.equal(h.applies, 0);
  await sleep(60);
  assert.equal(h.applies, 1);
  assert.equal(h.state, "abc");
});

test("flush 는 쌓인 것을 바로 적용하고, 비어 있으면 아무것도 하지 않는다", async () => {
  const h = harness([]);
  const b = createBatchedUpdater(h.apply, 1000);
  b.flush();
  assert.equal(h.applies, 0);
  b.queue((s) => [...s, 1]);
  b.flush();
  assert.deepEqual(h.state, [1]);
  assert.equal(h.applies, 1);
  await sleep(20);
  assert.equal(h.applies, 1, "flush 뒤 타이머가 다시 적용하지 않는다");
});

test("clear 는 쌓인 갱신을 버린다 (화면을 떠날 때)", async () => {
  const h = harness(0);
  const b = createBatchedUpdater(h.apply, 10);
  b.queue((s) => s + 1);
  b.clear();
  await sleep(30);
  assert.equal(h.applies, 0);
  assert.equal(h.state, 0);
});

test("연속 100 조각 → setState 는 창 수만큼만", async () => {
  const h = harness(0);
  const b = createBatchedUpdater(h.apply, 50);
  for (let i = 0; i < 100; i++) {
    b.queue((s) => s + 1);
    await sleep(2);
  }
  await sleep(80);
  assert.equal(h.state, 100);
  assert.ok(h.applies <= 8, `applies=${h.applies}`);
});
