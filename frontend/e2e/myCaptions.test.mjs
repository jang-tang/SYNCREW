// 내 말 자막(통화 중 말한 사람 화면) 상태 계산 단위 테스트. 실행: npm run test:unit
// 2026-10-19 실기기: 내 말이 기록 알림(message:new) 뒤에야 떠서 같은 말을 여러 번 함 → 말하는 순간부터 상태를 보여 준다
import assert from "node:assert/strict";
import { test } from "node:test";
import { discardMine, endMine, expireMine, mineEnd, mineText, startMine } from "../src/audio/myCaptions.ts";

test("말 시작 → 듣는 중, 말 끝 → 받아쓰는 중", () => {
  let list = startMine([], "a");
  assert.deepEqual(list, [{ key: "a", turnId: null, original: null, translation: "", status: "speaking" }]);
  list = endMine(list);
  assert.equal(list[0].status, "processing");
});

test("서버 자막이 오면 기다리던 내 말에 붙고(원문·번역 조각), 턴 끝이면 done", () => {
  let list = endMine(startMine([], "a"));
  list = mineText(list, "t1", "original", "안전모 쓰세요");
  list = mineText(list, "t1", "translation", "Hãy đội ");
  list = mineText(list, "t1", "translation", "mũ bảo hộ");
  assert.deepEqual(list[0], { key: "a", turnId: "t1", original: "안전모 쓰세요", translation: "Hãy đội mũ bảo hộ", status: "processing" });
  list = mineEnd(list, "t1", "done");
  assert.equal(list[0].status, "done");
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

test("여러 말: 서버 턴은 오래된 대기부터 차례로 붙는다, 최근 2개만 남긴다", () => {
  let list = endMine(startMine([], "a"));
  list = endMine(startMine(list, "b"));
  list = mineText(list, "t1", "original", "첫째");
  list = mineText(list, "t2", "original", "둘째");
  assert.deepEqual(list.map((c) => [c.key, c.turnId]), [["a", "t1"], ["b", "t2"]]);
  list = startMine(list, "c");
  assert.deepEqual(list.map((c) => c.key), ["b", "c"]);
});

test("너무 짧은 소리(단말 VAD 가 버림)는 지운다", () => {
  const list = discardMine(startMine(endMine(startMine([], "a")), "b"));
  assert.deepEqual(list.map((c) => c.key), ["a"]);
});

test("받아쓰는 중에 서버 응답이 끝내 없으면 실패(다시 말해 달라), 이미 서버 턴이 붙었으면 그대로", () => {
  let list = endMine(startMine([], "a"));
  list = expireMine(list, "a");
  assert.equal(list[0].status, "failed");
  let other = mineText(endMine(startMine([], "b")), "t1", "original", "네");
  other = expireMine(other, "b");
  assert.equal(other[0].status, "processing");
});

test("턴 끝 failed 면 실패 표시", () => {
  const list = mineEnd(mineText(endMine(startMine([], "a")), "t1", "original", "음"), "t1", "failed");
  assert.equal(list[0].status, "failed");
});
