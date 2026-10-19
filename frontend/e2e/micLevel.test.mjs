// 마이크 음량 저장소 단위 테스트 (양자화·10Hz 제한). 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { getMicLevel, setMicLevel, setMicLevelDb, subscribeMicLevel } from "../src/audio/micLevel.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("값은 1/20 단계로 양자화되고 0–1 로 잘린다", () => {
  setMicLevel(0.512);
  assert.equal(getMicLevel(), 0.5);
  setMicLevel(2);
  assert.equal(getMicLevel(), 1);
  setMicLevelDb(-160);
  assert.equal(getMicLevel(), 0);
  setMicLevelDb(-30);
  assert.equal(getMicLevel(), 0.5);
});

test("구독자 알림은 값이 달라질 때만, 100ms 에 한 번 이하", async () => {
  setMicLevel(0);
  await sleep(120);
  let notified = 0;
  const off = subscribeMicLevel(() => (notified += 1));
  // 10ms 마다 다른 값 30번 (300ms) → 알림은 3~4번
  for (let i = 1; i <= 30; i++) {
    setMicLevel((i % 20) / 20);
    await sleep(10);
  }
  await sleep(120);
  assert.ok(notified >= 2 && notified <= 5, `notified=${notified}`);
  const before = notified;
  setMicLevel(getMicLevel()); // 같은 값 → 알림 없음
  await sleep(120);
  assert.equal(notified, before);
  off();
});
