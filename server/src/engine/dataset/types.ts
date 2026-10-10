import type { Lang } from "../../shared/languages";

/** 현장 용어 1개. 데이터셋 형식과 무관한 엔진 내부 표현. */
export type LexiconEntry = {
  id: string;
  /** 표준 표현의 언어 (기존 데이터는 모두 ko) */
  lang: Lang;
  /** 표준 표현. 자동 보정의 결과로 쓰인다. */
  canonical: string;
  /** 은어·축약·발음 변형 */
  variants: string[];
  /** STT가 잘못 인식하는 형태 */
  asrCorrections: string[];
  /** 언어별 번역. 비어 있을 수 있다. */
  translations: Partial<Record<Lang, string>>;
  /** 의미 설명 (번역 컨텍스트로 전달) */
  meaning?: string;
  /** 번역 규칙 (예: 음차 금지) */
  rule?: string;
};

/** 검증된 문장 번역 1개. 정확히 일치하면 번역기에 우선 사용을 지시한다. */
export type PhraseEntry = {
  id: string;
  lang: Lang;
  text: string;
  translations: Partial<Record<Lang, string>>;
};

export type Dataset = {
  name: string;
  version: string;
  lexicon: LexiconEntry[];
  phrases: PhraseEntry[];
};

/** 데이터셋을 교체할 때 구현하는 인터페이스. */
export interface DatasetAdapter {
  readonly name: string;
  load(): Promise<Dataset>;
}
