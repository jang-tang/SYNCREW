// 발화 감지(VAD) 단위 테스트. 실행: npm run test:unit (Node 22 의 TypeScript 타입 제거 기능으로 .ts 를 바로 읽는다)
import assert from "node:assert/strict";
import { test } from "node:test";
import { createVad } from "../src/audio/vad.ts";

const STEP = 100; // 녹음기 음량을 100ms마다 읽는다

/** [dB, 지속 ms] 목록을 흘려보내고 발생한 이벤트를 시각과 함께 모은다 */
function run(vad, pattern, start = 0) {
  const events = [];
  let now = start;
  vad.reset(now);
  for (const [db, ms] of pattern) {
    for (let t = 0; t < ms; t += STEP) {
      now += STEP;
      const event = vad.push(db, now);
      if (event) events.push({ ...event, at: now });
    }
  }
  return events;
}

test("조용한 곳: 말하고 0.8초 쉬면 발화 끝", () => {
  const events = run(createVad(), [[-60, 1000], [-25, 2000], [-60, 1200]]);
  assert.deepEqual(events.map((e) => e.type), ["speechStart", "utteranceEnd"]);
  assert.equal(events[1].reason, "silence");
  assert.ok(events[1].speechMs >= 1800);
});

test("시끄러운 현장(-35dB 소음): 소음은 말로 보지 않고, 그보다 큰 말소리만 감지", () => {
  const events = run(createVad(), [[-35, 3000], [-15, 1500], [-35, 1200]]);
  assert.deepEqual(events.map((e) => e.type), ["speechStart", "utteranceEnd"]);
});

test("짧은 충격음(0.1초)은 말 시작으로 보지 않는다", () => {
  const events = run(createVad(), [[-60, 1000], [-10, 100], [-60, 2000]]);
  assert.deepEqual(events, []);
});

test("너무 짧은 발화(0.3초)는 버린다", () => {
  const events = run(createVad(), [[-60, 1000], [-25, 300], [-60, 1200]]);
  assert.deepEqual(events.map((e) => [e.type, e.reason]), [["speechStart", undefined], ["discard", "tooShort"]]);
});

test("말 사이 짧은 쉼(0.5초)에서는 끊지 않는다", () => {
  const events = run(createVad(), [[-60, 1000], [-25, 1000], [-60, 500], [-25, 1000], [-60, 1200]]);
  assert.deepEqual(events.map((e) => e.type), ["speechStart", "utteranceEnd"]);
});

test("25초를 넘게 말하면 끊어서 보낸다", () => {
  const events = run(createVad(), [[-60, 500], [-20, 26_000]]);
  assert.deepEqual(events.map((e) => [e.type, e.reason]).slice(0, 2), [["speechStart", undefined], ["utteranceEnd", "maxLength"]]);
});

test("통화 중 소음이 갑자기 커져 계속되면(기계 가동) 한 번 끊긴 뒤 기준선을 올려 더는 말로 보지 않는다", () => {
  const events = run(createVad(), [[-60, 1000], [-30, 60_000]]);
  assert.deepEqual(events.map((e) => [e.type, e.reason]).slice(0, 2), [["speechStart", undefined], ["utteranceEnd", "maxLength"]]);
  assert.equal(events.filter((e) => e.type === "speechStart").length, 1);
});

test("그 소음 위에서 더 크게 말하면 다시 감지한다", () => {
  const vad = createVad();
  run(vad, [[-60, 1000], [-30, 26_000]]);
  const events = run(vad, [[-30, 1000], [-12, 1500], [-30, 1200]], 100_000);
  assert.deepEqual(events.map((e) => e.type), ["speechStart", "utteranceEnd"]);
});

test("발화가 끝나면 다음 구간이 자동으로 시작돼 두 번째 발화도 감지한다", () => {
  const events = run(createVad(), [[-60, 1000], [-25, 1000], [-60, 1000], [-25, 1000], [-60, 1000]]);
  assert.deepEqual(events.map((e) => e.type), ["speechStart", "utteranceEnd", "speechStart", "utteranceEnd"]);
});

test("15초 동안 말이 없으면 녹음을 버리고 새로 시작하라고 알린다", () => {
  const events = run(createVad(), [[-60, 16_000]]);
  assert.deepEqual(events.map((e) => [e.type, e.reason]), [["discard", "idle"]]);
});

test("음량을 읽지 못하면(-160 또는 NaN) 무음으로 본다", () => {
  const events = run(createVad(), [[Number.NaN, 2000], [-160, 2000]]);
  assert.deepEqual(events, []);
});
