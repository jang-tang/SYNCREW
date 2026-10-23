import type { Lang } from "../../shared/languages";
import { riskRank, type Dataset, type LexiconEntry, type PhraseEntry } from "../dataset/types";
import { isWordChar, matchKey, prepareText, sentenceKey, usesWordBoundaries } from "./textMatching";

/** 어떤 형태로 용어가 감지됐는지 */
export type HitKind = "canonical" | "variant" | "asr" | "translation";

export type TermHit = {
  entryId: string;
  kind: HitKind;
  /** 원문에서 일치한 구간 그대로 */
  matched: string;
  /** 원문 기준 위치 [start, end) */
  start: number;
  end: number;
  /** 원문을 표준 표현으로 바꿨는지 */
  corrected: boolean;
};

export type DomainResult = {
  sourceLang: Lang;
  originalText: string;
  /** 용어 자동 보정 후 원문. 번역기에 이 텍스트를 넣는다. */
  correctedText: string;
  hits: TermHit[];
  /** 보정 원문과 정확히 일치하는 검증 문장 */
  phraseId?: string;
};

export type ContextTerm = {
  /** 원문 언어로 된 용어 */
  source: string;
  /** 대상 언어 번역 (데이터에 없으면 생략) */
  target?: string;
  meaning?: string;
  rule?: string;
};

export type TranslationContext = {
  terms: ContextTerm[];
  /** 검증 문장 번역이 있으면 그대로 쓰도록 지시한다. */
  phrase?: { source: string; target: string };
};

export type DomainProcessorOptions = {
  /** 이보다 짧은 표현은 오탐이 많아 감지하지 않는다 (정리된 글자 수 기준). */
  minSurfaceLength: number;
  /** 번역 컨텍스트에 넣을 최대 용어 수 */
  maxContextTerms: number;
};

const DEFAULT_OPTIONS: DomainProcessorOptions = { minSurfaceLength: 2, maxContextTerms: 12 };

/**
 * 스트리밍 통역용 미리 넣는 용어집 (언어 쌍 기준, 2026-10-19).
 * 스트리밍은 번역 전에 텍스트가 없어 원문으로 용어를 고를 수 없으므로, 언어 쌍마다 고정된 묶음을 세션 지시문에 미리 넣는다.
 * 묶음은 결정적(같은 입력 → 같은 순서)이어야 OpenAI 프롬프트 캐시가 맞는다.
 */
export type StreamGlossary = {
  /** 용어: 원문 언어 표현 → 대상 언어 표현 (의미·규칙은 글자 수를 아끼려 넣지 않는다) */
  terms: ContextTerm[];
  /** 검증 문장 (긴급 문장 우선): 턴이 그 문장과 같으면 그대로 쓰도록 */
  phrases: { source: string; target: string }[];
  /**
   * 한국어 현장 은어 → 표준 한국어 뜻 (원문이 ko 일 때만, 대상 언어 번역이 없는 은어). 언어별 번역 없이도 은어를 알게 한다
   * (2026-10-23, docs/field-terms.md 0절). 없으면 빈 것으로 본다
   */
  slang?: { source: string; standardKo: string }[];
};

export type StreamGlossaryOptions = {
  /** 용어 최대 수 */
  maxTerms: number;
  /** 검증 문장 최대 수 */
  maxPhrases: number;
  /** 은어(표준 한국어 뜻) 최대 수 */
  maxSlang: number;
  /** 용어 + 은어 합계 상한 (지시문 글자 수 상한을 지키려고. 용어가 많은 언어 쌍은 은어가 줄어든다) */
  maxEntries: number;
};

/**
 * 상한 (docs/streaming-plan.md 4-2절): 용어 110개 + 검증 문장 12개 → ko↔vi 지시문 약 3,900자 (STREAM_INSTRUCTIONS_MAX_CHARS 4,500 안).
 * 턴마다 입력 텍스트 토큰으로 들어가지만 지시문 앞부분이 바뀌지 않아 2번째 턴부터는 캐시 단가(1/10)로 계산된다.
 * 110개인 이유 (ko→vi 데이터 기준): critical 64개 + high 중 안전·PPE·긴급·건설 안전 은어 분야 40개가 모두 들어가는 크기.
 * 60개로 자르면 critical 만 남아 안전모·장갑 같은 PPE 용어가 빠진다.
 * 은어(2026-10-23 60개 → 2026-10-24 300개, 용어와 합쳐 420개): 은어 전체가 들어간다. 2026-10-24 실험에서 말하는 도중 자막으로
 * 턴마다 은어를 찾는 방식(turnTerms)은 자막이 은어를 잘못 받아써 효과가 없어, 미리 넣는 목록을 넉넉하게 늘렸다 (docs/field-terms.md 8절).
 */
export const DEFAULT_STREAM_GLOSSARY_OPTIONS: StreamGlossaryOptions = { maxTerms: 110, maxPhrases: 12, maxSlang: 300, maxEntries: 420 };

/** 안전 분야 (데이터셋 domain 값: safety, ppe, safety_emergency, construction_safety_slang 등) */
const SAFETY_DOMAIN = /safety|ppe|emergency/i;

/** 용어 우선순위 묶음 (낮을수록 먼저): critical → high+안전 분야 → high+핵심 → high → normal+핵심 → normal */
function glossaryGroup(entry: LexiconEntry): number {
  if (entry.risk === "critical") return 0;
  const base = riskRank(entry.risk) * 3;
  if (entry.domain && SAFETY_DOMAIN.test(entry.domain)) return base - 2;
  return base - (entry.core ? 1 : 0);
}

/** 결정적 문자열 비교 (로케일 무관, 코드 포인트 순서) */
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type Surface = { key: string; entry: LexiconEntry; kind: HitKind };

/** 용어·문장의 언어별 표현. 원어는 표준 표현, 나머지는 번역 값. */
function formsOf(lang: Lang, base: string, translations: Partial<Record<Lang, string>>) {
  return { ...translations, [lang]: base } as Partial<Record<Lang, string>>;
}

/**
 * 현장 언어 특화 처리 (PDF 22쪽: STT 텍스트 → 현장 용어 감지 → 용어 자동 보정 → 번역 컨텍스트).
 * 데이터셋 형식과 무관하게 `Dataset`만 받는다.
 */
export class DomainProcessor {
  private readonly options: DomainProcessorOptions;
  private readonly entries = new Map<string, LexiconEntry>();
  /** 언어별 → 첫 글자별 → 길이 내림차순 표현 목록 */
  private readonly surfaces = new Map<Lang, Map<string, Surface[]>>();
  private readonly phrases = new Map<Lang, Map<string, PhraseEntry>>();
  /** 언어 쌍별 스트리밍 용어집 (데이터셋이 바뀌지 않으므로 한 번 만들면 그대로) */
  private readonly streamGlossaries = new Map<string, StreamGlossary>();

  constructor(
    readonly dataset: Dataset,
    options: Partial<DomainProcessorOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    for (const entry of dataset.lexicon) this.indexEntry(entry);
    for (const index of this.surfaces.values()) {
      for (const list of index.values()) list.sort((a, b) => b.key.length - a.key.length);
    }
    for (const phrase of dataset.phrases) this.indexPhrase(phrase);
  }

  private indexEntry(entry: LexiconEntry) {
    this.entries.set(entry.id, entry);
    this.addSurface(entry.lang, entry.canonical, entry, "canonical");
    for (const variant of entry.variants) this.addSurface(entry.lang, variant, entry, "variant");
    for (const asr of entry.asrCorrections) this.addSurface(entry.lang, asr, entry, "asr");
    for (const [lang, text] of Object.entries(entry.translations) as [Lang, string][]) {
      if (lang !== entry.lang) this.addSurface(lang, text, entry, "translation");
    }
  }

  private addSurface(lang: Lang, text: string, entry: LexiconEntry, kind: HitKind) {
    const key = matchKey(text, lang);
    if (key.length < this.options.minSurfaceLength) return;

    let byFirstChar = this.surfaces.get(lang);
    if (!byFirstChar) {
      byFirstChar = new Map();
      this.surfaces.set(lang, byFirstChar);
    }
    const first = key[0]!;
    const list = byFirstChar.get(first) ?? [];
    const existingIndex = list.findIndex((surface) => surface.key === key);
    if (existingIndex === -1) {
      list.push({ key, entry, kind });
    } else if (kind === "canonical" && list[existingIndex]!.kind !== "canonical") {
      // 어떤 용어의 표준 표현이 다른 용어의 변형과 겹치면 표준 표현을 우선한다.
      list[existingIndex] = { key, entry, kind };
    }
    byFirstChar.set(first, list);
  }

  private indexPhrase(phrase: PhraseEntry) {
    for (const [lang, text] of Object.entries(formsOf(phrase.lang, phrase.text, phrase.translations)) as [
      Lang,
      string,
    ][]) {
      let index = this.phrases.get(lang);
      if (!index) {
        index = new Map();
        this.phrases.set(lang, index);
      }
      const key = sentenceKey(text, lang);
      if (key && !index.has(key)) index.set(key, phrase);
    }
  }

  /** 용어 감지 → 자동 보정 → 검증 문장 확인 */
  process(text: string, sourceLang: Lang): DomainResult {
    const hits = this.detect(text, sourceLang);
    const correctedText = applyCorrections(text, hits, this.entries);
    const phrase = this.phrases.get(sourceLang)?.get(sentenceKey(correctedText, sourceLang));
    return {
      sourceLang,
      originalText: text,
      correctedText,
      hits,
      ...(phrase ? { phraseId: phrase.id } : {}),
    };
  }

  /** 가장 왼쪽·가장 긴 일치를 우선하며, 겹치지 않게 용어를 찾는다. */
  detect(text: string, lang: Lang): TermHit[] {
    const index = this.surfaces.get(lang);
    if (!index || !text.trim()) return [];

    const { chars, origin } = prepareText(text, lang);
    const checkBoundaries = usesWordBoundaries(lang);
    const hits: TermHit[] = [];
    let position = 0;

    while (position < chars.length) {
      const candidates = index.get(chars[position]!);
      const found = candidates?.find(
        (surface) =>
          chars.startsWith(surface.key, position) &&
          (!checkBoundaries ||
            (!isWordChar(chars[position - 1]) && !isWordChar(chars[position + surface.key.length]))),
      );
      if (!found) {
        position += 1;
        continue;
      }

      const lastChar = position + found.key.length - 1;
      const start = origin[position]!;
      const end = origin[lastChar]! + 1;
      hits.push({
        entryId: found.entry.id,
        kind: found.kind,
        matched: text.slice(start, end),
        start,
        end,
        corrected: shouldCorrect(found, lang),
      });
      position = lastChar + 1;
    }
    return hits;
  }

  /** 번역기에 전달할 용어·문장 컨텍스트 */
  buildContext(result: DomainResult, targetLang: Lang): TranslationContext {
    const terms: ContextTerm[] = [];
    const seen = new Set<string>();

    for (const hit of result.hits) {
      if (seen.has(hit.entryId) || terms.length >= this.options.maxContextTerms) continue;
      seen.add(hit.entryId);
      const entry = this.entries.get(hit.entryId)!;
      const forms = formsOf(entry.lang, entry.canonical, entry.translations);
      const target = forms[targetLang];
      // 은어는 표준 한국어 뜻을 앞에 붙인다 (대상 언어 번역이 없어도 뜻으로 번역하도록)
      const meaning = [entry.standardKo ? `= ${entry.standardKo}` : undefined, entry.meaning].filter(Boolean).join(". ");
      terms.push({
        // 변형은 보정하지 않으므로 문장에 실제로 있는 표현으로 알려 준다
        source: hit.kind === "variant" ? hit.matched : (forms[result.sourceLang] ?? hit.matched),
        ...(target ? { target } : {}),
        ...(meaning ? { meaning } : {}),
        ...(entry.rule ? { rule: entry.rule } : {}),
      });
    }

    const context: TranslationContext = { terms };
    if (result.phraseId) {
      const phrase = this.dataset.phrases.find((candidate) => candidate.id === result.phraseId)!;
      const forms = formsOf(phrase.lang, phrase.text, phrase.translations);
      const source = forms[result.sourceLang];
      const target = forms[targetLang];
      if (source && target) context.phrase = { source, target };
    }
    return context;
  }

  /**
   * 스트리밍 통역 세션에 미리 넣을 용어집 (언어 쌍 기준, 결정적 순서).
   * 용어: 원문·대상 언어 표현이 모두 있는 항목만. 묶음(glossaryGroup: critical → high+안전 분야 → high+핵심 → high → …) → 원문 표현 코드 포인트 순.
   * 문장: 데이터셋 순서(긴급 문장이 앞) 그대로 원문·대상 표현이 모두 있는 것.
   * 은어: 원문이 ko 일 때, 표준 한국어 뜻(standardKo)이 있고 용어에 이미 들어가지 않은 은어를 용어와 같은 순서로 (2026-10-23).
   */
  streamGlossary(sourceLang: Lang, targetLang: Lang, options: Partial<StreamGlossaryOptions> = {}): StreamGlossary {
    const { maxTerms, maxPhrases, maxSlang, maxEntries } = { ...DEFAULT_STREAM_GLOSSARY_OPTIONS, ...options };
    const key = `${sourceLang}→${targetLang}:${maxTerms}:${maxPhrases}:${maxSlang}:${maxEntries}`;
    const cached = this.streamGlossaries.get(key);
    if (cached) return cached;

    const glossary: StreamGlossary = { terms: [], phrases: [] };
    if (sourceLang !== targetLang) {
      // 같은 원문 표현이 여러 항목에 있으면(예: vi→ko 에서 "giàn giáo" 는 비계·아시바 둘 다) 묶음이 앞서는 것, 같으면 은어(rule 있음)보다 표준 용어를 쓴다
      const bySource = new Map<string, { source: string; target: string; group: number; slang: boolean }>();
      for (const entry of this.dataset.lexicon) {
        const forms = formsOf(entry.lang, entry.canonical, entry.translations);
        const source = forms[sourceLang];
        const target = forms[targetLang];
        if (!source || !target) continue;
        const candidate = { source, target, group: glossaryGroup(entry), slang: Boolean(entry.rule) };
        const existing = bySource.get(source);
        if (!existing || candidate.group < existing.group || (candidate.group === existing.group && existing.slang && !candidate.slang)) bySource.set(source, candidate);
      }
      const candidates = [...bySource.values()].sort((a, b) => a.group - b.group || compareCodePoints(a.source, b.source));
      glossary.terms = candidates.slice(0, maxTerms).map(({ source, target }) => ({ source, target }));

      for (const phrase of this.dataset.phrases) {
        if (glossary.phrases.length >= maxPhrases) break;
        const forms = formsOf(phrase.lang, phrase.text, phrase.translations);
        const source = forms[sourceLang];
        const target = forms[targetLang];
        if (source && target) glossary.phrases.push({ source, target });
      }

      // 한국어 은어 → 표준 한국어: 위 용어집에 이미 들어간(대상 언어 번역이 있는) 은어는 빼고, 같은 우선순위 순서로
      if (sourceLang === "ko") {
        const inTerms = new Set(glossary.terms.map((term) => term.source));
        const slang = this.dataset.lexicon
          .filter((entry) => entry.lang === "ko" && entry.standardKo && !inTerms.has(entry.canonical))
          .map((entry) => ({ source: entry.canonical, standardKo: entry.standardKo!, group: glossaryGroup(entry) }))
          .sort((a, b) => a.group - b.group || compareCodePoints(a.source, b.source));
        const seen = new Set<string>();
        const limit = Math.max(0, Math.min(maxSlang, maxEntries - glossary.terms.length));
        glossary.slang = [];
        for (const { source, standardKo } of slang) {
          if (glossary.slang.length >= limit) break;
          if (seen.has(source)) continue;
          seen.add(source);
          glossary.slang.push({ source, standardKo });
        }
      }
    }
    this.streamGlossaries.set(key, glossary);
    return glossary;
  }

  stats() {
    return {
      name: this.dataset.name,
      version: this.dataset.version,
      lexicon: this.dataset.lexicon.length,
      phrases: this.dataset.phrases.length,
    };
  }
}

/**
 * 받아쓰기 오인식 표현(asr)만 표준 표현으로 바꾼다 (예: "대수라" → "데스라").
 * 변형(variant)은 감지만 한다 — 변형에 표준어·일상어가 섞여 있으면 "해체" 가 "바라시", "가로" 가 "요코" 로 바뀌어
 * 말한 내용이 은어로 번역기에 들어가기 때문 (2026-10-23 사용자 결정 (나), docs/field-terms.md 7-4절). 뜻은 번역 문맥으로 전달된다.
 * 표준 표현으로 시작하는 오인식형(예: "아시바해")은 활용형이므로 바꾸지 않는다.
 */
function shouldCorrect(surface: Surface, lang: Lang): boolean {
  if (surface.kind !== "asr") return false;
  return !surface.key.startsWith(matchKey(surface.entry.canonical, lang));
}

function applyCorrections(text: string, hits: TermHit[], entries: Map<string, LexiconEntry>): string {
  let result = text;
  for (const hit of [...hits].reverse()) {
    if (!hit.corrected) continue;
    const canonical = entries.get(hit.entryId)!.canonical;
    result = result.slice(0, hit.start) + canonical + result.slice(hit.end);
  }
  return result;
}
