import type { Lang } from "@shared/languages";
import { SUPPORTED_LANGUAGES } from "@shared/languages";

export const localeOf = (lang: Lang) => SUPPORTED_LANGUAGES.find((item) => item.code === lang)!.locale;
export const nativeNameOf = (lang: Lang) => SUPPORTED_LANGUAGES.find((item) => item.code === lang)!.nativeName;

/** 오늘이면 시:분, 아니면 월/일 */
export function formatTime(iso: string, lang: Lang): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(localeOf(lang), sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" }).format(date);
}

export function formatDateTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeOf(lang), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // 한글·한자는 첫 글자, 라틴·키릴은 단어 첫 글자 2개
  if (/^[\p{Script=Hangul}\p{Script=Han}]/u.test(trimmed)) return trimmed.slice(0, 1);
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
