// 일괄 지시 대상 선택 계산 단위 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkSelect, filterByName, groupActive, parseLastTargets, quickGroups, summarize, toggleGroup } from "../src/lib/recipients.ts";

const bt = { audioRoute: "bluetooth" };
const people = [
  { userId: "kim", displayName: "김민준", lang: "ko", online: true, device: bt },
  { userId: "nguyen", displayName: "Nguyễn Văn An", lang: "vi", online: true, device: bt },
  { userId: "tran", displayName: "Trần Thị Mai", lang: "vi", online: false, device: null },
  { userId: "li", displayName: "李伟", lang: "zh", online: true, device: { audioRoute: "builtin" } },
  { userId: "ivan", displayName: "Иван Петров", lang: "ru", online: true, device: { audioRoute: "wired" } },
];
const byKey = (groups) => Object.fromEntries(groups.map((g) => [g.key, g.userIds]));

test("빠른 선택 묶음: 접속 중·이어폰·언어별(인원 많은 순)", () => {
  const groups = quickGroups(people, null);
  assert.deepEqual(groups.map((g) => g.key), ["online", "headset", "lang:vi", "lang:ko", "lang:zh", "lang:ru"]);
  const g = byKey(groups);
  assert.deepEqual(g.online, ["kim", "nguyen", "li", "ivan"]);
  // 휴대폰 스피커(li)와 접속 끊긴 사람(tran)은 이어폰 묶음에서 빠진다
  assert.deepEqual(g.headset, ["kim", "nguyen", "ivan"]);
  assert.deepEqual(g["lang:vi"], ["nguyen", "tran"]);
});

test("지난번 대상: 그 사이 제외된 사람은 빠지고, 남은 사람이 없으면 칩을 만들지 않는다", () => {
  assert.deepEqual(byKey(quickGroups(people, ["nguyen", "gone", "ivan"])).last, ["nguyen", "ivan"]);
  assert.equal(quickGroups(people, ["gone"]).some((g) => g.kind === "last"), false);
  assert.equal(quickGroups([], null).length, 0);
});

test("칩 조합: 켜면 더하고, 다시 누르면 그 묶음만 뺀다", () => {
  const [vi, ru] = [quickGroups(people, null).find((g) => g.key === "lang:vi"), quickGroups(people, null).find((g) => g.key === "lang:ru")];
  let selected = toggleGroup(new Set(), vi);
  selected = toggleGroup(selected, ru);
  assert.deepEqual([...selected].sort(), ["ivan", "nguyen", "tran"]);
  assert.equal(groupActive(vi, selected), true);
  selected = toggleGroup(selected, vi);
  assert.deepEqual([...selected], ["ivan"]);
  // 일부만 선택된 묶음은 꺼진 상태 → 누르면 나머지를 더한다
  const partial = toggleGroup(new Set(["nguyen"]), vi);
  assert.deepEqual([...partial].sort(), ["nguyen", "tran"]);
});

test("이름 검색은 목록만 거르고, 일괄 선택은 보이는 사람에게만 적용", () => {
  assert.deepEqual(filterByName(people, "  nguy ").map((p) => p.userId), ["nguyen"]);
  assert.deepEqual(filterByName(people, "иван").map((p) => p.userId), ["ivan"]);
  assert.equal(filterByName(people, "").length, people.length);
  const visible = filterByName(people, "Tr");
  const selected = new Set(["kim"]);
  assert.deepEqual([...bulkSelect(selected, visible, "all")].sort(), ["kim", "tran"]);
  assert.deepEqual([...bulkSelect(new Set(["kim", "tran"]), visible, "none")], ["kim"]);
  assert.deepEqual([...bulkSelect(new Set(["kim", "li"]), people, "invert")].sort(), ["ivan", "nguyen", "tran"]);
});

test("요약: 인원·언어 수·접속 인원", () => {
  const s = summarize(people);
  assert.deepEqual({ total: s.total, langs: s.langs.length, online: s.online }, { total: 5, langs: 4, online: 4 });
  assert.deepEqual(summarize([]).total, 0);
});

test("저장된 지난 선택 읽기: 형식이 깨졌으면 무시", () => {
  assert.deepEqual(parseLastTargets('["a","b"]'), ["a", "b"]);
  assert.equal(parseLastTargets(null), null);
  assert.equal(parseLastTargets("{"), null);
  assert.equal(parseLastTargets('[1,2]'), null);
});
