// 받은 통역 자막을 몇 줄 보여 줄지 (2026-10-28 사용자): 짧게 여러 번 말하면 번역 자막이 하나만 보여 앞 말을 글로 놓쳤다.
// 최근 windowMs 안에 시작된 턴은 모두 보여 주고, 그보다 오래된 것은 지운다. 가장 최근 턴 하나는 시간이 지나도 늘 남긴다.

export type TimedCaption = { at: number };

export const RECENT_CAPTION_MS = 10_000;

export function recentCaptions<T extends TimedCaption>(captions: readonly T[], now: number, windowMs = RECENT_CAPTION_MS): T[] {
  if (captions.length === 0) return [];
  const recent = captions.filter((caption) => now - caption.at <= windowMs);
  return recent.length > 0 ? recent : [captions[captions.length - 1]!];
}
