import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLang, type Lang } from "../../shared/languages";
import { riskRank, toRiskLevel, type Dataset, type DatasetAdapter, type LexiconEntry, type PhraseEntry } from "./types";

// 기존 저장소(workplace-translation-mvp) 데이터 형식. 필요한 필드만 선언한다.
type SeedTerm = { id: string; ko: string; plain_ko?: string; aliases?: string[]; risk_level?: string; domain?: string };
type PackTerm = SeedTerm & { manufacturing_context?: string; translations?: Record<string, string> };
type SlangTerm = {
  id: string;
  canonical_ko: string;
  variants_ko?: string[];
  asr_corrections?: string[];
  plain_ko?: string;
  translate_as_ko?: string;
  translation_rule?: string;
  translations?: Record<string, string>;
  risk_level?: string;
  domain?: string;
};
/** 우리가 만든 보충 데이터 (supplement/, docs/field-terms.md 7절) — 원본 저장소 파일은 고치지 않는다 */
type SupplementSlang = SlangTerm & { override?: boolean };
/** 실측에서 틀리게 옮겨진 표준 용어 + vi·zh 번역 (2026-10-24, docs/field-accuracy.md 7절) */
type MeasuredTerm = { id: string; canonical_ko: string; variants_ko?: string[]; translations: Record<string, string>; plain_ko?: string; risk_level?: string };
type SupplementSentence = { id: string; ko: string } & Partial<Record<string, string>>;
type ViTerm = { id: string; ko: string; vi: string; plain_ko?: string; risk_level?: string; priority?: string; domain?: string };
type ViSentence = { id: string; ko: string; vi: string };
type ViSlang = {
  id: string;
  canonical_ko: string;
  vi: string;
  variants_ko?: string[];
  asr_likely_misrecognitions?: string[];
  normalized_translation_rule?: string;
};

const FILES = {
  seed: "workplace_translation_seed.json",
  manufacturing: "manufacturing_translation_pack.json",
  slang: "site_slang_translation_pack.json",
  extendedSlang: "extended_site_slang_translation_pack.json",
  vietnamese: "vi-priority/vietnamese_priority_dataset.json",
  // 보충 (없으면 건너뜀)
  koshaSlang: "supplement/kosha_slang.json",
  moelSigns: "supplement/moel_safety_signs_2025.json",
  measuredTerms: "supplement/measured_terms.json",
} as const;

/** 지원 언어의 번역만 남긴다 (th, id, ne, km 등은 버림). */
function pickSupported(translations: Record<string, string> | undefined): Partial<Record<Lang, string>> {
  const result: Partial<Record<Lang, string>> = {};
  for (const [lang, text] of Object.entries(translations ?? {})) {
    if (isLang(lang) && text.trim()) {
      result[lang] = text.trim();
    }
  }
  return result;
}

/**
 * 같은 표준 표현(canonical)을 가진 항목을 하나로 합친다.
 * 변형·오인식 목록은 합집합, 번역·의미·규칙·분야는 먼저 읽은 값을 유지하고, 위험도는 더 높은 쪽, 핵심 표시는 하나라도 있으면 쓴다.
 */
class LexiconBuilder {
  private readonly byKey = new Map<string, LexiconEntry>();
  /** 대체(override) 항목의 키 — 다른 파일의 같은 기준 표현은 합치지 않고 버린다 */
  private readonly locked = new Set<string>();

  /** 다른 데이터를 대신하는 항목. 다른 add 보다 먼저 불러야 한다 */
  override(entry: LexiconEntry) {
    this.add(entry);
    this.locked.add(`${entry.lang}:${entry.canonical.trim()}`);
  }

  add(entry: LexiconEntry) {
    const canonical = entry.canonical.trim();
    if (!canonical) return;
    const key = `${entry.lang}:${canonical}`;
    if (this.locked.has(key)) return;
    const existing = this.byKey.get(key);
    if (!existing) {
      this.byKey.set(key, { ...entry, canonical, variants: unique(entry.variants), asrCorrections: unique(entry.asrCorrections) });
      return;
    }
    existing.variants = unique([...existing.variants, ...entry.variants]);
    existing.asrCorrections = unique([...existing.asrCorrections, ...entry.asrCorrections]);
    existing.translations = { ...entry.translations, ...existing.translations };
    existing.meaning ??= entry.meaning;
    existing.standardKo ??= entry.standardKo;
    existing.rule ??= entry.rule;
    existing.domain ??= entry.domain;
    if (entry.risk && riskRank(entry.risk) < riskRank(existing.risk)) existing.risk = entry.risk;
    if (entry.core) existing.core = true;
  }

  build(): LexiconEntry[] {
    return [...this.byKey.values()].map((entry) => ({ ...entry, variants: cleanVariants(entry) }));
  }
}

/** 문장형 용어 (예: "어디입니까", "천천히 말해 주세요") */
const SENTENCE_LIKE = /(니까|세요|요)$/;

/**
 * 원본 seed 의 변형 목록에서 감지 잡음이 되는 것을 뺀다 (2026-10-23, docs/field-terms.md 7-4절 (가)):
 *   - 은어 항목의 변형 중 그 은어의 표준어 뜻에 든 말 (예: 바라시의 "해체", 요코의 "가로", 오야지의 "반장")
 *   - 문장형 용어의 짧은 꼴 (예: 어디입니까의 "어디", 천천히 말해 주세요의 "천천히")
 * 변형은 보정하지 않고 감지만 하지만(domainProcessor shouldCorrect), 남겨 두면 일상어마다 엉뚱한 용어 설명이 번역 문맥에 붙는다.
 */
function cleanVariants(entry: LexiconEntry): string[] {
  const noSpace = (text: string) => text.replace(/\s+/g, "");
  const standard = entry.standardKo ? noSpace(entry.standardKo) : undefined;
  return entry.variants.filter((variant) => {
    if (variant === entry.canonical || variant.startsWith(entry.canonical)) return true; // 활용형
    if (standard?.includes(noSpace(variant))) return false;
    if (SENTENCE_LIKE.test(entry.canonical) && entry.canonical.includes(variant)) return false;
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** 기존 저장소의 데이터셋 원본 형식을 그대로 읽는 기본 어댑터. */
export class LegacyWorkplaceAdapter implements DatasetAdapter {
  readonly name = "legacy-workplace";

  constructor(private readonly dataDir: string) {}

  private async read<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(path.join(this.dataDir, file), "utf8")) as T;
  }

  /** 보충 파일은 없어도 된다 (다른 데이터 폴더를 쓸 때) */
  private async readOptional<T>(file: string): Promise<T | null> {
    try {
      return await this.read<T>(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async load(): Promise<Dataset> {
    const [seed, manufacturing, slang, extendedSlang, vietnamese, koshaSlang, moelSigns, measured] = await Promise.all([
      this.read<{ version: string; terms: SeedTerm[] }>(FILES.seed),
      this.read<{ version: string; terms: PackTerm[] }>(FILES.manufacturing),
      this.read<{ version: string; terms: SlangTerm[] }>(FILES.slang),
      this.read<{ version: string; terms: SlangTerm[] }>(FILES.extendedSlang),
      this.read<{
        version: string;
        terms: ViTerm[];
        common_sentences: ViSentence[];
        emergency_sentences: ViSentence[];
        slang_variants: ViSlang[];
      }>(FILES.vietnamese),
      this.readOptional<{ version: string; terms: SupplementSlang[] }>(FILES.koshaSlang),
      this.readOptional<{ version: string; sentences: SupplementSentence[] }>(FILES.moelSigns),
      this.readOptional<{ version: string; terms: MeasuredTerm[] }>(FILES.measuredTerms),
    ]);

    const lexicon = new LexiconBuilder();
    const supplementEntry = (term: SupplementSlang): LexiconEntry => ({
      id: term.id,
      lang: "ko",
      canonical: term.canonical_ko,
      variants: term.variants_ko ?? [],
      asrCorrections: term.asr_corrections ?? [],
      translations: pickSupported(term.translations),
      standardKo: term.translate_as_ko,
      risk: toRiskLevel(term.risk_level),
      domain: term.domain,
    });

    // 기존 seed 와 뜻이 달라 공단 사전 기준으로 바꾼 항목 (데스라·아나방, 2026-10-23 사용자 결정)
    for (const term of koshaSlang?.terms ?? []) if (term.override) lexicon.override(supplementEntry(term));
    // 실측 오역 단어: 번역이 다른 데이터보다 우선하도록 가장 먼저 (같은 용어의 변형·오인식은 뒤 데이터와 합쳐진다)
    for (const term of measured?.terms ?? []) {
      lexicon.add({
        id: term.id,
        lang: "ko",
        canonical: term.canonical_ko,
        variants: term.variants_ko ?? [],
        asrCorrections: [],
        translations: pickSupported(term.translations),
        meaning: term.plain_ko,
        risk: toRiskLevel(term.risk_level),
        domain: "measured_mistranslation",
      });
    }

    // 번역 값이 있는 데이터를 먼저 넣어 번역·의미가 우선 채택되게 한다.
    for (const term of [...extendedSlang.terms, ...slang.terms]) {
      lexicon.add({
        id: term.id,
        lang: "ko",
        canonical: term.canonical_ko,
        variants: term.variants_ko ?? [],
        asrCorrections: term.asr_corrections ?? [],
        translations: pickSupported(term.translations),
        meaning: term.plain_ko,
        standardKo: term.translate_as_ko,
        rule: term.translation_rule,
        risk: toRiskLevel(term.risk_level),
        domain: term.domain,
      });
    }
    // 안전보건공단 유의어 사전의 은어: 표준 한국어 뜻만 (기존 항목이 있으면 기존 뜻·번역이 우선, 변형만 합쳐진다)
    for (const term of koshaSlang?.terms ?? []) if (!term.override) lexicon.add(supplementEntry(term));
    for (const term of manufacturing.terms) {
      lexicon.add({
        id: term.id,
        lang: "ko",
        canonical: term.ko,
        variants: term.aliases ?? [],
        asrCorrections: [],
        translations: pickSupported(term.translations),
        meaning: term.plain_ko,
        rule: term.manufacturing_context,
        risk: toRiskLevel(term.risk_level),
        domain: term.domain,
      });
    }
    for (const term of vietnamese.slang_variants) {
      lexicon.add({
        id: term.id,
        lang: "ko",
        canonical: term.canonical_ko,
        variants: term.variants_ko ?? [],
        asrCorrections: term.asr_likely_misrecognitions ?? [],
        translations: { vi: term.vi },
        rule: term.normalized_translation_rule,
      });
    }
    for (const term of vietnamese.terms) {
      lexicon.add({
        id: term.id,
        lang: "ko",
        canonical: term.ko,
        variants: [],
        asrCorrections: [],
        translations: { vi: term.vi },
        meaning: term.plain_ko !== term.ko ? term.plain_ko : undefined,
        risk: toRiskLevel(term.risk_level),
        domain: term.domain,
        ...(term.priority === "core" ? { core: true } : {}),
      });
    }
    // 번역 값은 없지만 용어 감지와 의미 전달에 쓰인다.
    for (const term of seed.terms) {
      lexicon.add({
        id: term.id,
        lang: "ko",
        canonical: term.ko,
        variants: term.aliases ?? [],
        asrCorrections: [],
        translations: {},
        meaning: term.plain_ko,
        risk: toRiskLevel(term.risk_level),
        domain: term.domain,
      });
    }

    // 순서: 베트남어 긴급 문장 → 고용노동부 안전표지(ko·vi·zh·uz) → 베트남어 일반 문장.
    // 스트리밍 용어집은 언어 쌍마다 앞에서부터 12개를 쓰므로 ko↔vi 는 그대로(긴급 160개), ko↔zh·uz 는 안전표지 문장이 들어간다
    const viPhrase = (sentence: ViSentence): PhraseEntry => ({ id: sentence.id, lang: "ko", text: sentence.ko, translations: { vi: sentence.vi } });
    const phrases: PhraseEntry[] = [
      ...vietnamese.emergency_sentences.map(viPhrase),
      ...(moelSigns?.sentences ?? []).map(({ id, ko, ...rest }) => ({ id, lang: "ko" as const, text: ko, translations: pickSupported(rest as Record<string, string>) })),
      ...vietnamese.common_sentences.map(viPhrase),
    ];

    return {
      name: this.name,
      version: `seed-${seed.version}+vi-${vietnamese.version}${koshaSlang ? `+kosha-${koshaSlang.version}` : ""}${moelSigns ? `+moel-${moelSigns.version}` : ""}${measured ? `+measured-${measured.version}` : ""}`,
      lexicon: lexicon.build(),
      phrases,
    };
  }
}
