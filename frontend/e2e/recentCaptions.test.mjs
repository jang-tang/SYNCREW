// 받은 자막 여러 줄 보이기 (2026-10-28) 단위 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { recentCaptions } from "../src/audio/recentCaptions.ts";

const c = (id, at) => ({ id, at });

test("최근 10초 안의 턴은 모두 순서대로 보인다", () => {
  const list = [c("a", 1_000), c("b", 4_000), c("c", 9_000)];
  assert.deepEqual(recentCaptions(list, 10_000).map((x) => x.id), ["a", "b", "c"]);
});

test("10초가 지난 턴은 빠진다 (대조군: 10초 안의 턴은 남음)", () => {
  const list = [c("a", 1_000), c("b", 4_000), c("c", 9_000)];
  assert.deepEqual(recentCaptions(list, 12_000).map((x) => x.id), ["b", "c"]);
});

test("모두 10초가 지나도 가장 최근 턴 하나는 남는다", () => {
  const list = [c("a", 1_000), c("b", 4_000)];
  assert.deepEqual(recentCaptions(list, 60_000).map((x) => x.id), ["b"]);
});

test("빈 목록은 빈 목록", () => {
  assert.deepEqual(recentCaptions([], 0), []);
});
