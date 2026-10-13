import type { Lang } from "@shared/languages";

// 일괄 지시 대상 선택 계산 (화면과 분리해 단위 테스트한다: e2e/recipients.test.mjs).
// 대상 후보는 Member 중 필요한 필드만 쓴다.

export type Candidate = {
  userId: string;
  displayName: string;
  lang: Lang;
  online: boolean;
  device: { audioRoute: "bluetooth" | "wired" | "builtin" | "unknown" } | null;
};

export type QuickGroup = {
  key: string;
  kind: "last" | "group" | "online" | "headset" | "lang";
  lang?: Lang;
  /** 작업조 (kind group) */
  groupId?: string;
  name?: string;
  userIds: string[];
};

/** 저장된 작업조 (B2) — 서버 TargetGroup 중 필요한 것 */
export type SavedGroup = { id: string; name: string; userIds: string[] };

/** 접속 중이고 이어폰(블루투스·유선)으로 확인된 사람 */
export const hasHeadset = (c: Candidate) => c.online && (c.device?.audioRoute === "bluetooth" || c.device?.audioRoute === "wired");

/**
 * 빠른 선택 묶음: 지난번 대상 → 작업조(이름순) → 접속 중 → 이어폰 연결됨 → 언어별 (인원 많은 순).
 * 지난번 대상·작업조는 지금 후보에 남아 있는 사람만 (그 사이 제외된 사람은 자동으로 빠짐). 빈 묶음은 만들지 않는다.
 */
export function quickGroups(candidates: Candidate[], lastUserIds: readonly string[] | null, saved: readonly SavedGroup[] = []): QuickGroup[] {
  const groups: QuickGroup[] = [];
  const ids = (list: Candidate[]) => list.map((c) => c.userId);
  if (lastUserIds) {
    const alive = new Set(lastUserIds);
    const last = candidates.filter((c) => alive.has(c.userId));
    if (last.length > 0) groups.push({ key: "last", kind: "last", userIds: ids(last) });
  }
  const present = new Set(ids(candidates));
  [...saved]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((g) => {
      const userIds = g.userIds.filter((id) => present.has(id));
      if (userIds.length > 0) groups.push({ key: `group:${g.id}`, kind: "group", groupId: g.id, name: g.name, userIds });
    });
  const online = candidates.filter((c) => c.online);
  if (online.length > 0) groups.push({ key: "online", kind: "online", userIds: ids(online) });
  const headset = candidates.filter(hasHeadset);
  if (headset.length > 0) groups.push({ key: "headset", kind: "headset", userIds: ids(headset) });
  const byLang = new Map<Lang, string[]>();
  candidates.forEach((c) => byLang.set(c.lang, [...(byLang.get(c.lang) ?? []), c.userId]));
  [...byLang]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([lang, userIds]) => groups.push({ key: `lang:${lang}`, kind: "lang", lang, userIds }));
  return groups;
}

/** 묶음의 모든 사람이 선택돼 있으면 켜진 상태 */
export const groupActive = (group: QuickGroup, selected: ReadonlySet<string>) =>
  group.userIds.length > 0 && group.userIds.every((id) => selected.has(id));

/** 묶음 칩 누르기: 켜져 있으면 그 사람들을 빼고, 아니면 더한다 (여러 칩 조합 가능) */
export function toggleGroup(selected: ReadonlySet<string>, group: QuickGroup): Set<string> {
  const next = new Set(selected);
  if (groupActive(group, selected)) group.userIds.forEach((id) => next.delete(id));
  else group.userIds.forEach((id) => next.add(id));
  return next;
}

/** 이름 검색 (대소문자·앞뒤 공백 무시). 선택 상태와는 무관하게 목록만 거른다 */
export function filterByName<T extends Candidate>(candidates: T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => c.displayName.toLocaleLowerCase().includes(q));
}

/** 보이는 목록 기준 전체 선택·해제·반전 (검색으로 가려진 사람의 선택은 그대로 둔다) */
export function bulkSelect(selected: ReadonlySet<string>, visible: Candidate[], action: "all" | "none" | "invert"): Set<string> {
  const next = new Set(selected);
  for (const c of visible) {
    if (action === "all") next.add(c.userId);
    else if (action === "none") next.delete(c.userId);
    else if (next.has(c.userId)) next.delete(c.userId);
    else next.add(c.userId);
  }
  return next;
}

/** 보내기 전 요약: 인원·언어 수·접속 인원·언어별 인원 */
export function summarize(targets: Candidate[]) {
  const counts = new Map<Lang, number>();
  targets.forEach((c) => counts.set(c.lang, (counts.get(c.lang) ?? 0) + 1));
  return { total: targets.length, langs: [...counts], online: targets.filter((c) => c.online).length };
}

/** 지난 선택 저장 키 (관리자·현장별, 단말에만 저장) */
export const lastTargetsKey = (userId: string, siteId: string) => `syncrew.lastTargets.${userId}.${siteId}`;

export function parseLastTargets(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : null;
  } catch {
    return null;
  }
}
