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
  /**
   * 은어 항목의 표준 한국어 뜻 (예: 아시바 → "비계, 발판"). 언어별 번역이 없을 때도 번역 모델이 뜻을 알 수 있게 한다
   * (2026-10-23 결정: 은어 → 표준 한국어 중심, docs/field-terms.md 0절)
   */
  standardKo?: string;
  /** 의미 설명 (번역 컨텍스트로 전달) */
  meaning?: string;
  /** 번역 규칙 (예: 음차 금지) */
  rule?: string;
  /** 안전 위험도 (데이터셋의 risk_level). 스트리밍 용어집에서 우선순위로 쓴다 — critical > high > normal */
  risk?: RiskLevel;
  /** 데이터셋이 핵심(자주 쓰는 기본) 용어로 표시한 항목 (vi-priority 의 priority: core). 스트리밍 용어집에서 같은 위험도 안의 우선순위 */
  core?: boolean;
  /** 데이터셋의 분야 표시 (예: safety, ppe, safety_emergency, construction_safety_slang, manufacturing_machine). 먼저 읽은 값 */
  domain?: string;
};

export type RiskLevel = "critical" | "high" | "normal";

/** 데이터셋의 risk_level 문자열 → RiskLevel (모르는 값은 normal) */
export function toRiskLevel(value: string | undefined): RiskLevel | undefined {
  if (value === undefined) return undefined;
  return value === "critical" || value === "high" ? value : "normal";
}

const RISK_RANK: Record<RiskLevel, number> = { critical: 0, high: 1, normal: 2 };

/** 정렬용 순위 (낮을수록 중요). 값이 없으면 normal 과 같다 */
export function riskRank(risk: RiskLevel | undefined): number {
  return RISK_RANK[risk ?? "normal"];
}

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
