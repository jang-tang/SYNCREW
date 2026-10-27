// 내 말 자막(통화 중 말한 사람 화면) 상태 계산 단위 테스트. 실행: npm run test:unit
// 2026-10-19 실기기: 내 말이 기록 알림(message:new) 뒤에야 떠서 같은 말을 여러 번 함 → 말하는 순간부터 상태를 보여 준다
import assert from "node:assert/strict";
import { test } from "node:test";
import { discardMine, endMine, expireMine, mineEnd, mineText, startMine } from "../src/audio/myCaptions.ts";

test("말 시작 → 듣는 중, 말 끝 → 받아쓰는 중", () => {
  let list = startMine([], "a", 1_000);
  assert.deepEqual(list, [{ key: "a", turnId: null, original: null, partial: "", translation: "", status: "speaking", at: 1_000 }]);
  list = endMine(list);
  assert.equal(list[0].status, "processing");
});

test("서버 자막이 오면 기다리던 내 말에 붙고(원문·번역 조각), 턴 끝이면 done", () => {
  let list = endMine(startMine([], "a", 1_000));
  list = mineText(list, "t1", "original", "안전모 쓰세요");
  list = mineText(list, "t1", "translation", "Hãy đội ");
  list = mineText(list, "t1", "translation", "mũ bảo hộ");
  assert.deepEqual(list[0], { key: "a", turnId: "t1", original: "안전모 쓰세요", partial: "", translation: "Hãy đội mũ bảo hộ", status: "processing", at: 1_000 });
  list = mineEnd(list, "t1", "done");
  assert.equal(list[0].status, "done");
});

test("받아쓰는 중 조각(original_partial)은 이어 붙고, 완성본(original)이 오면 그것으로 바뀐다", () => {
  let list = endMine(startMine([], "a"));
  list = mineText(list, "t1", "original_partial", "안전");
  list = mineText(list, "t1", "original_partial", "모 쓰");
  assert.equal(list[0].partial, "안전모 쓰");
  assert.equal(list[0].original, null); // 화면은 original ?? partial 로 보여 준다
  list = mineText(list, "t1", "original", "안전모 쓰세요.");
  assert.equal(list[0].original, "안전모 쓰세요.");
  assert.equal(list[0].turnId, "t1");
});

test("서버가 먼저 확정한 턴(단말 말 끝 전에)도 말하는 중인 내 말에 붙는다", () => {
  const list = mineText(startMine([], "a"), "t1", "original", "네");
  assert.equal(list[0].turnId, "t1");
  assert.equal(list[0].original, "네");
});

test("기다리는 내 말이 없는데 자막이 오면 새로 만든다, 이미 붙은 턴은 그 자리에", () => {
  let list = mineText([], "t9", "original", "혼자 온 자막");
  assert.equal(list.length, 1);
  assert.equal(list[0].turnId, "t9");
  list = mineText(list, "t9", "translation", "x");
  assert.equal(list.length, 1);
  assert.equal(list[0].translation, "x");
});

test("여러 말: 서버 턴은 짝 없는 말 중 가장 최근 것에 붙고, 그보다 오래된 짝 없는 말(에코·잡음)은 지운다", () => {
  // 2026-10-19 실기기: 에코로 생긴 a 뒤에 진짜 말 b → 서버 턴은 b 의 것. 예전엔 a 에 붙어 b 가 빈 채 남았다
  let list = endMine(startMine([], "a"));
  list = endMine(startMine(list, "b"));
  list = mineText(list, "t1", "original", "진짜 말");
  assert.deepEqual(list.map((c) => [c.key, c.turnId, c.original]), [["b", "t1", "진짜 말"]]);
  // 이미 붙은 말은 지우지 않고, 다음 턴은 그 뒤 새 말에 붙는다
  list = endMine(startMine(list, "c"));
  list = mineText(list, "t2", "original", "둘째");
  assert.deepEqual(list.map((c) => [c.key, c.turnId]), [["b", "t1"], ["c", "t2"]]);
  list = startMine(list, "d");
  assert.deepEqual(list.map((c) => c.key), ["b", "c", "d"]);
});

test("남겨 두는 내 말은 최대 8개 (화면에는 최근 10초만 — recentCaptions)", () => {
  let list = [];
  for (let i = 0; i < 10; i++) list = startMine(list, `k${i}`, i);
  assert.deepEqual(list.map((c) => c.key), ["k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"]);
});

test("서버 턴이 붙을 때 이미 턴이 붙은 오래된 말은 남긴다 (짝 없는 것만 지움)", () => {
  let list = mineEnd(mineText(endMine(startMine([], "a")), "t1", "original", "첫째"), "t1", "done");
  list = endMine(startMine(list, "b"));
  list = mineText(list, "t2", "original", "둘째");
  assert.deepEqual(list.map((c) => [c.key, c.turnId]), [["a", "t1"], ["b", "t2"]]);
});

test("너무 짧은 소리(단말 VAD 가 버림)는 지운다", () => {
  const list = discardMine(startMine(endMine(startMine([], "a")), "b"));
  assert.deepEqual(list.map((c) => c.key), ["a"]);
});

test("시간이 지나도 서버 턴이 안 붙은 말은 조용히 지운다 — failed 가 되지 않고 이전 말로 돌아간다", () => {
  let list = mineEnd(mineText(endMine(startMine([], "a")), "t1", "original", "첫째"), "t1", "done");
  list = endMine(startMine(list, "b"));
  list = expireMine(list, "b");
  assert.deepEqual(list.map((c) => [c.key, c.status]), [["a", "done"]]);
  assert.ok(list.every((c) => c.status !== "failed"));
  // 기다리는 말이 하나뿐이면 빈 목록
  assert.deepEqual(expireMine(endMine(startMine([], "x")), "x"), []);
});

test("시간이 지났어도 이미 서버 턴이 붙은 말은 그대로 (타이머 no-op)", () => {
  let list = mineText(endMine(startMine([], "b")), "t1", "original", "네");
  list = expireMine(list, "b");
  assert.deepEqual(list.map((c) => [c.key, c.turnId, c.status]), [["b", "t1", "processing"]]);
  // 다른 키의 타이머도 영향 없음
  assert.deepEqual(expireMine(list, "zzz"), list);
});

test("서버가 턴 끝을 failed 로 알린 때만 실패 표시", () => {
  const list = mineEnd(mineText(endMine(startMine([], "a")), "t1", "original", "음"), "t1", "failed");
  assert.equal(list[0].status, "failed");
});
