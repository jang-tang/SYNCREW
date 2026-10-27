// 내 말 자막 (스트리밍 통화에서 말한 사람 화면에 보여 줄 상태, 2026-10-19)
// 실기기에서 내 말이 기록 알림(message:new) 뒤에야 떠서 같은 말을 여러 번 하게 됨 → 말하는 순간부터 상태를 보여 준다.
//   speaking   : 단말 VAD 가 말을 감지해 보내는 중 ("듣고 있어요…")
//   processing : 말 끝을 알렸고 서버 받아쓰기·번역을 기다림 ("받아쓰는 중…" → 받아쓰는 중 조각(partial)·원문·번역이 오는 대로 표시)
//   done/failed: 서버 턴 끝 (stream:mine:end). failed 는 서버가 명시적으로 실패를 알린 때만 ("다시 말해 주세요")
//
// 서버 턴(turnId)과 단말 말의 짝 규칙 (2026-10-19 실기기 에코 문제로 바꿈):
//   스피커로 나온 상대 번역 음성이 마이크로 다시 들어와(에코) 단말 VAD 가 가짜 말을 여러 개 만든다. 서버는 에코를 말로 보지 않아
//   턴을 만들지 않으므로, 예전처럼 "짝 없는 오래된 말부터" 붙이면 진짜 말의 턴이 앞선 에코 말에 붙고 진짜 말은 빈 채로 남아
//   8초 뒤 "다시 말해 주세요" 가 떴다(서버 로그엔 실패 턴 없음). 그래서:
//   1. 서버 턴은 짝 없는 말 중 가장 최근 것에 붙인다. 그보다 오래된 짝 없는 말은 더는 턴을 받을 수 없으니(에코·잡음) 함께 지운다.
//   2. 시간이 지나도 턴이 안 붙은 말은 조용히 지운다(expireMine). failed 는 서버가 stream:mine:end status=failed 로 알릴 때만.

export type MyCaptionStatus = "speaking" | "processing" | "done" | "failed";

export type MyCaption = {
  /** 단말이 붙인 키 (말 1개) */
  key: string;
  /** 서버 턴 (stream:mine:*) — 아직 짝이 없으면 null */
  turnId: string | null;
  /** 원문 전사 완성본 (오면 partial 대신 보여 준다) */
  original: string | null;
  /** 받아쓰는 중 원문 조각을 이어 붙인 것 (original_partial) */
  partial: string;
  translation: string;
  status: MyCaptionStatus;
  /** 말을 시작한 시각 — 화면에는 최근 10초 안의 말을 여러 줄로 보여 준다 (audio/recentCaptions.ts, 2026-10-28) */
  at: number;
};

/** 남겨 두는 내 말 수 (보이는 것은 최근 10초 — 받은 자막과 같은 규칙, 2026-10-28 2 → 8) */
export const MAX_MY_CAPTIONS = 8;

const keep = (list: MyCaption[]) => list.slice(-MAX_MY_CAPTIONS);

/** 조건에 맞는 마지막 항목 위치 (Hermes 버전에 따라 findLastIndex 가 없을 수 있어 직접) */
function lastIndex(list: MyCaption[], match: (c: MyCaption) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i]!)) return i;
  return -1;
}

/** 단말 VAD 가 말을 감지함 */
export function startMine(list: MyCaption[], key: string, at = Date.now()): MyCaption[] {
  return keep([...list, { key, turnId: null, original: null, partial: "", translation: "", status: "speaking", at }]);
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

/** 서버 턴에 맞는 내 말을 찾거나(이미 붙은 것 → 짝 없는 가장 최근 것), 없으면 새로 만든다. 붙일 때 그보다 오래된 짝 없는 말은 지운다 (에코·잡음) */
function attach(list: MyCaption[], turnId: string): [MyCaption[], number] {
  const existing = list.findIndex((c) => c.turnId === turnId);
  if (existing >= 0) return [list, existing];
  const waiting = lastIndex(list, (c) => c.turnId === null && (c.status === "processing" || c.status === "speaking"));
  if (waiting >= 0) {
    const next: MyCaption[] = [];
    list.forEach((c, i) => {
      if (i < waiting && c.turnId === null) return;
      next.push(i === waiting ? { ...c, turnId } : c);
    });
    return [next, next.findIndex((c) => c.turnId === turnId)];
  }
  const next = keep([...list, { key: `turn:${turnId}`, turnId, original: null, partial: "", translation: "", status: "processing", at: Date.now() }]);
  return [next, next.length - 1];
}

export type MineTextKind = "original" | "original_partial" | "translation";

/** stream:mine:text — original_partial 은 받아쓰는 중 조각(이어 붙임), original 은 완성본(조각을 대신함), translation 은 조각 */
export function mineText(list: MyCaption[], turnId: string, kind: MineTextKind, text: string): MyCaption[] {
  const [attached, index] = attach(list, turnId);
  return attached.map((c, i) => {
    if (i !== index) return c;
    if (kind === "original") return { ...c, original: text };
    if (kind === "original_partial") return { ...c, partial: c.partial + text };
    return { ...c, translation: c.translation + text };
  });
}

/** stream:mine:end */
export function mineEnd(list: MyCaption[], turnId: string, status: "done" | "failed"): MyCaption[] {
  const [attached, index] = attach(list, turnId);
  return attached.map((c, i) => (i === index ? { ...c, status } : c));
}

/** 시간이 지나도 서버 턴이 안 붙은 말(에코·잡음 등 서버가 말로 보지 않음) → 조용히 지운다. 이미 턴이 붙었으면 그대로 (no-op) */
export function expireMine(list: MyCaption[], key: string): MyCaption[] {
  return list.filter((c) => !(c.key === key && c.turnId === null));
}
