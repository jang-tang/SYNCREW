// 서버와 프론트엔드가 함께 쓰는 계약 파일. 외부 패키지를 import하지 않는다.
// 프론트엔드는 `@shared/languages` 경로로 이 파일을 직접 참조한다.

export const SUPPORTED_LANGUAGES = [
  { code: "ko", name: "Korean", nativeName: "한국어", locale: "ko-KR" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文", locale: "zh-CN" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", locale: "vi-VN" },
  { code: "uz", name: "Uzbek", nativeName: "Oʻzbekcha", locale: "uz-UZ" },
  { code: "ru", name: "Russian", nativeName: "Русский", locale: "ru-RU" },
] as const;

export type Lang = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const LANG_CODES: readonly Lang[] = SUPPORTED_LANGUAGES.map((language) => language.code);

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANG_CODES as readonly string[]).includes(value);
}
