// 통화 상대 바꾸기(C1) 판정·순서 단위 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { callOrder, createVolumeKeyDetector, cycleCandidates } from "../src/audio/callCycle.ts";

// 가짜 시계: setTimeout 을 모아 두고 advance 로 시간을 흘린다
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const queue = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      queue.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => queue.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, item] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (item.at <= now) {
          queue.delete(id);
          item.fn();
        }
      }
    },
  };
}

function detector() {
  const timers = fakeTimers();
  const events = [];
  const d = createVolumeKeyDetector(
    { onSingle: (dir) => events.push(`single:${dir}`), onDouble: (dir) => events.push(`double:${dir}`) },
    { windowMs: 600 },
    timers,
  );
  return { d, timers, events };
}

test("두 번 누르기: 같은 방향이 0.6초 안에 두 번이면 바로 double, 한 번 누름은 생기지 않는다", () => {
  const { d, timers, events } = detector();
  d.press("up");
  timers.advance(300);
  d.press("up");
  assert.deepEqual(events, ["double:up"]);
  timers.advance(2000);
  assert.deepEqual(events, ["double:up"]);
});

test("한 번 누름: 0.6초 동안 두 번째가 없으면 single (그 전에는 아무것도 안 함)", () => {
  const { d, timers, events } = detector();
  d.press("down");
  timers.advance(599);
  assert.deepEqual(events, []);
  timers.advance(1);
  assert.deepEqual(events, ["single:down"]);
});

test("0.6초가 지난 뒤 두 번째 누름은 한 번 누름 두 개", () => {
  const { d, timers, events } = detector();
  d.press("up");
  timers.advance(700);
  d.press("up");
  timers.advance(700);
  assert.deepEqual(events, ["single:up", "single:up"]);
});

test("다른 방향이 섞이면 앞은 바로 single, 새로 센다", () => {
  const { d, timers, events } = detector();
  d.press("up");
  timers.advance(200);
  d.press("down");
  assert.deepEqual(events, ["single:up"]);
  timers.advance(200);
  d.press("down");
  assert.deepEqual(events, ["single:up", "double:down"]);
});

test("세 번 누르면 double 뒤 새 첫 누름 (→ 한 번 누름)", () => {
  const { d, timers, events } = detector();
  d.press("up");
  d.press("up");
  d.press("up");
  timers.advance(600);
  assert.deepEqual(events, ["double:up", "single:up"]);
});

test("reset: 기다리던 한 번 누름은 버린다 (대조군: reset 없으면 single)", () => {
  const { d, timers, events } = detector();
  d.press("up");
  d.reset();
  timers.advance(1000);
  assert.deepEqual(events, []);
  d.press("up");
  timers.advance(1000);
  assert.deepEqual(events, ["single:up"]);
});

const member = (userId, role = "member", extra = {}) => ({
  userId, displayName: userId, role, status: "active", lang: "vi", online: true, device: null, ...extra,
});
const ids = (list) => list.map((m) => m.userId);

test("순서: 관리자 먼저, 나·승인 대기 빠짐, 그 안은 받은 순서", () => {
  const members = [
    member("a"), member("me", "manager"), member("b"), member("boss", "manager"), member("p", "member", { status: "pending" }), member("c"),
  ];
  assert.deepEqual(ids(callOrder(members, "me")), ["boss", "a", "b", "c"]);
});

const order = [member("boss", "manager"), member("a"), member("b"), member("c")];

test("다음: 지금 상대 다음부터 한 바퀴, 끝에서는 처음으로 (지금 상대 빠짐)", () => {
  assert.deepEqual(ids(cycleCandidates(order, "a", "up")), ["b", "c", "boss"]);
  assert.deepEqual(ids(cycleCandidates(order, "c", "up")), ["boss", "a", "b"]);
});

test("이전: 처음에서는 끝으로", () => {
  assert.deepEqual(ids(cycleCandidates(order, "boss", "down")), ["c", "b", "a"]);
  assert.deepEqual(ids(cycleCandidates(order, "b", "down")), ["a", "boss", "c"]);
});

test("접속 안 한 사람은 건너뛴다", () => {
  const withOffline = [member("boss", "manager"), member("a"), member("b", "member", { online: false }), member("c")];
  assert.deepEqual(ids(cycleCandidates(withOffline, "a", "up")), ["c", "boss"]);
});

test("걸 수 있는 사람이 없으면 빈 목록 (모두 접속 끊김 / 상대 1명뿐)", () => {
  const allOff = [member("a"), member("b", "member", { online: false })];
  assert.deepEqual(cycleCandidates(allOff, "a", "up"), []);
  assert.deepEqual(cycleCandidates([member("a")], "a", "down"), []);
  assert.deepEqual(cycleCandidates([], "a", "up"), []);
});

test("지금 상대가 목록에 없으면 다음은 처음부터, 이전은 끝부터", () => {
  assert.deepEqual(ids(cycleCandidates(order, "gone", "up")), ["boss", "a", "b", "c"]);
  assert.deepEqual(ids(cycleCandidates(order, "gone", "down")), ["c", "b", "a", "boss"]);
});
