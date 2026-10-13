import type { Lang } from "../../shared/languages";
import type { Dataset } from "../dataset/types";

// 받아쓰기(STT) 용어 힌트 (2026-10-14 시험, **지금은 쓰지 않는다**).
// 측정(scripts/stt-hint-compare.ts) 결과: gpt-4o-mini-transcribe 에서는 거의 차이가 없고, gpt-4o-transcribe 에서는
// 용어 목록을 넣으면 오히려 틀린 곳이 늘었다("이번 프레스", "보호세시"). 그래서 서버는 기본 안내(BASE_TRANSCRIPTION_PROMPT)만 쓰고
// 받아쓰기 모델을 gpt-4o-transcribe 로 바꿨다. 데이터셋을 바꾸거나 모델이 바뀌면 같은 스크립트로 다시 재 본다.
//
// 원래 목적: 현장 용어를 미리 알려 원문 받아쓰기 오류를 줄인다.
// 스트리밍 원문 기록에서 "비계→기계", "거푸집→커푸직", "안전모→단물" 같은 오류가 있었다 (docs/streaming-plan.md 5-1절).
// "기계"처럼 실제로 있는 단어로 잘못 들은 경우는 받아쓴 뒤 사전으로 고칠 수 없으므로(맞는 문장까지 바뀐다)
// 받아쓰기 단계에서 용어를 알려 주는 것이 유일한 방법이다.

/** 언어와 무관한 기본 안내 (기존 STT_PROMPT 와 같은 내용) */
export const BASE_TRANSCRIPTION_PROMPT =
  "Construction and manufacturing workplace speech. Preserve machine names, PPE terms, emergency stop, safety helmet, defects, and numbers.";

export type TranscriptionHintOptions = {
  /** 힌트에 넣을 최대 용어 수 (받아쓰기 모델 힌트 길이를 짧게 유지) */
  maxTerms: number;
  /** 용어 최대 글자 수 (문장형 표현 제외) */
  maxTermLength: number;
};

const DEFAULTS: TranscriptionHintOptions = { maxTerms: 120, maxTermLength: 12 };

/**
 * 언어별 현장 용어 목록. 데이터셋 용어는 한국어 기준이라
 *   ko: 표준 표현 + 변형(은어·표준어), 그 외 언어: 그 언어 번역 값
 * 순서: 검증 문장(현장에서 실제 쓰는 문장)에 많이 나오는 용어부터 → 같으면 표준 표현 먼저 → 데이터 순서.
 * (데이터 순서대로 넣으면 은어가 앞에 몰려 "거푸집·안전모·지게차" 같은 표준 용어가 빠졌다 — 2026-10-14 확인)
 * 중복을 빼고 짧은 표현(2–12자)만 maxTerms 개까지.
 */
export function transcriptionTerms(dataset: Dataset, lang: Lang, options: Partial<TranscriptionHintOptions> = {}): string[] {
  const { maxTerms, maxTermLength } = { ...DEFAULTS, ...options };
  const candidates = new Map<string, { order: number; canonical: boolean }>();
  const add = (term: string | undefined, canonical: boolean) => {
    const value = term?.trim();
    if (!value || value.length < 2 || value.length > maxTermLength) return;
    const existing = candidates.get(value);
    if (!existing) candidates.set(value, { order: candidates.size, canonical });
    else if (canonical) existing.canonical = true;
  };
  for (const entry of dataset.lexicon) {
    if (entry.lang === lang) {
      add(entry.canonical, true);
      entry.variants.forEach((variant) => add(variant, false));
    } else {
      add(entry.translations[lang], true);
    }
  }
  // 검증 문장 중 이 언어로 된 것 (원문 또는 번역)
  const sentences = dataset.phrases
    .map((phrase) => (phrase.lang === lang ? phrase.text : phrase.translations[lang]))
    .filter((text): text is string => !!text)
    .map((text) => text.toLowerCase());
  const frequency = (term: string) => {
    const needle = term.toLowerCase();
    let count = 0;
    for (const sentence of sentences) if (sentence.includes(needle)) count += 1;
    return count;
  };
  return [...candidates.entries()]
    .map(([term, info]) => ({ term, ...info, frequency: frequency(term) }))
    .sort((a, b) => b.frequency - a.frequency || Number(b.canonical) - Number(a.canonical) || a.order - b.order)
    .slice(0, maxTerms)
    .map((item) => item.term);
}

/** 받아쓰기 모델에 줄 힌트: 기본 안내 + 현장 용어 목록. 언어별로 한 번만 만든다 */
export function createTranscriptionPrompts(dataset: Dataset, options: Partial<TranscriptionHintOptions> = {}) {
  const cache = new Map<Lang, string>();
  return (lang: Lang): string => {
    let prompt = cache.get(lang);
    if (prompt === undefined) {
      const terms = transcriptionTerms(dataset, lang, options);
      prompt = terms.length > 0 ? `${BASE_TRANSCRIPTION_PROMPT} Site terms: ${terms.join(", ")}.` : BASE_TRANSCRIPTION_PROMPT;
      cache.set(lang, prompt);
    }
    return prompt;
  };
}
