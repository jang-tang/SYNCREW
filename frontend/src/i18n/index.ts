import type { Lang } from "@shared/languages";
import { useSessionStore } from "@/stores/session";
import { STRINGS, type StringKey } from "./strings";

export type { StringKey };
export type Params = Record<string, string | number>;

export function translate(lang: Lang, key: StringKey, params?: Params): string {
  let text: string = STRINGS[key][lang] ?? STRINGS[key].ko;
  if (params) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** 현재 화면 언어로 번역하는 함수 t 와 언어 코드를 돌려준다. */
export function useT() {
  const lang = useSessionStore((state) => state.uiLang);
  const t = (key: StringKey, params?: Params) => translate(lang, key, params);
  return { t, lang };
}
