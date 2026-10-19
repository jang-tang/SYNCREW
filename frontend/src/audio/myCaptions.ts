// 내 말 자막 (스트리밍 통화에서 말한 사람 화면에 보여 줄 상태, 2026-10-19)
// 실기기에서 내 말이 기록 알림(message:new) 뒤에야 떠서 같은 말을 여러 번 하게 됨 → 말하는 순간부터 상태를 보여 준다.
//   speaking   : 단말 VAD 가 말을 감지해 보내는 중 ("듣고 있어요…")
//   processing : 말 끝을 알렸고 서버 받아쓰기·번역을 기다림 ("받아쓰는 중…" → 원문·번역이 오는 대로 표시)
//   done/failed: 서버 턴 끝 (stream:mine:end). 응답이 끝내 없으면 failed ("다시 말해 주세요")
// 서버 턴(turnId)은 단말 말과 1:1 로 짝이 맞지 않을 수 있어(서버 VAD 가 먼저 끊기도 함), 아직 짝이 없는 오래된 말부터 붙인다.

export type MyCaptionStatus = "speaking" | "processing" | "done" | "failed";

export type MyCaption = {
  /** 단말이 붙인 키 (말 1개) */
  key: string;
  /** 서버 턴 (stream:mine:*) — 아직 짝이 없으면 null */
  turnId: string | null;
  original: string | null;
  translation: string;
  status: MyCaptionStatus;
};

/** 화면에 남겨 두는 내 말 수 */
export const MAX_MY_CAPTIONS = 2;

const keep = (list: MyCaption[]) => list.slice(-MAX_MY_CAPTIONS);

/** 조건에 맞는 마지막 항목 위치 (Hermes 버전에 따라 findLastIndex 가 없을 수 있어 직접) */
function lastIndex(list: MyCaption[], match: (c: MyCaption) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i]!)) return i;
  return -1;
}

/** 단말 VAD 가 말을 감지함 */
export function startMine(list: MyCaption[], key: string): MyCaption[] {
  return keep([...list, { key, turnId: null, original: null, translation: "", status: "speaking" }]);
}

/** 말 끝을 서버에 알림 → 가장 최근 말하는 중인 말을 받아쓰는 중으로 */
export function endMine(list: MyCaption[]): MyCaption[] {
  const index = lastIndex(list, (c) => c.status === "speaking");
  if (index < 0) return list;
  return list.map((c, i) => (i === index ? { ...c, status: "processing" } : c));
}

/** 단말 VAD 가 너무 짧다고 버린 소리 → 가장 최근 말하는 중인 말을 지운다 */
export function discardMine(list: MyCaption[]): MyCaption[] {
  const index = lastIndex(list, (c) => c.status === "speaking" && c.turnId === null);
  if (index < 0) return list;
  return list.filter((_, i) => i !== index);
}

/** 서버 턴에 맞는 내 말을 찾거나(이미 붙은 것 → 짝 없는 오래된 것), 없으면 새로 만든다 */
function attach(list: MyCaption[], turnId: string): [MyCaption[], number] {
  const existing = list.findIndex((c) => c.turnId === turnId);
  if (existing >= 0) return [list, existing];
  const waiting = list.findIndex((c) => c.turnId === null && (c.status === "processing" || c.status === "speaking"));
  if (waiting >= 0) return [list.map((c, i) => (i === waiting ? { ...c, turnId } : c)), waiting];
  const next = keep([...list, { key: `turn:${turnId}`, turnId, original: null, translation: "", status: "processing" }]);
  return [next, next.length - 1];
}

/** stream:mine:text — original 은 완성본, translation 은 조각 */
export function mineText(list: MyCaption[], turnId: string, kind: "original" | "translation", text: string): MyCaption[] {
  const [attached, index] = attach(list, turnId);
  return attached.map((c, i) =>
    i !== index ? c : kind === "original" ? { ...c, original: text } : { ...c, translation: c.translation + text },
  );
}

/** stream:mine:end */
export function mineEnd(list: MyCaption[], turnId: string, status: "done" | "failed"): MyCaption[] {
  const [attached, index] = attach(list, turnId);
  return attached.map((c, i) => (i === index ? { ...c, status } : c));
}

/** 받아쓰는 중인데 서버 응답이 끝내 없음 (서버가 말로 인식하지 않음 등) → 다시 말해 달라고 */
export function expireMine(list: MyCaption[], key: string): MyCaption[] {
  return list.map((c) => (c.key === key && c.turnId === null && c.status !== "done" ? { ...c, status: "failed" } : c));
}
