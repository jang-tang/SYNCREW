import type { Lang } from "../../shared/languages";

/** 띄어쓰기가 일정하지 않아 공백을 무시하고 비교하는 언어 */
const SPACE_INSENSITIVE: ReadonlySet<Lang> = new Set(["ko", "zh"]);

const WHITESPACE = /\s/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const PUNCTUATION = /[\p{P}\p{S}]/gu;

/**
 * 비교용으로 정리한 텍스트와, 정리된 각 글자가 원문의 몇 번째 글자에서 왔는지를 담는다.
 * 원문 위치를 알아야 자동 보정에서 원문의 해당 구간을 바꿀 수 있다.
 */
export type PreparedText = {
  chars: string;
  /** chars[i] 의 원문 위치 */
  origin: number[];
};

export function usesWordBoundaries(lang: Lang): boolean {
  return !SPACE_INSENSITIVE.has(lang);
}

/**
 * 소문자화 + 유니코드 정규화(NFC) 후, ko·zh는 공백을 모두 제거하고
 * 그 외 언어는 연속 공백을 하나로 줄인다.
 */
export function prepareText(text: string, lang: Lang): PreparedText {
  const source = text.normalize("NFC");
  const dropSpaces = SPACE_INSENSITIVE.has(lang);
  let chars = "";
  const origin: number[] = [];
  let previousWasSpace = true; // 앞쪽 공백 제거

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (WHITESPACE.test(char)) {
      if (!dropSpaces && !previousWasSpace) {
        chars += " ";
        origin.push(index);
      }
      previousWasSpace = true;
      continue;
    }
    previousWasSpace = false;
    for (const lower of char.toLowerCase()) {
      chars += lower;
      origin.push(index);
    }
  }

  if (chars.endsWith(" ")) {
    chars = chars.slice(0, -1);
    origin.pop();
  }
  return { chars, origin };
}

/** 사전 키용: prepareText 결과의 문자열만 쓴다. */
export function matchKey(text: string, lang: Lang): string {
  return prepareText(text, lang).chars;
}

/** 문장 단위 일치 비교용: 문장부호·기호까지 제거한다. */
export function sentenceKey(text: string, lang: Lang): string {
  return matchKey(text.replace(PUNCTUATION, " "), lang);
}

export function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}
