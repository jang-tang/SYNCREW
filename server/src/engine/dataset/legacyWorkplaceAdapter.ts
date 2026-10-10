import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLang, type Lang } from "../../shared/languages";
import type { Dataset, DatasetAdapter, LexiconEntry, PhraseEntry } from "./types";

// 기존 저장소(workplace-translation-mvp) 데이터 형식. 필요한 필드만 선언한다.
type SeedTerm = { id: string; ko: string; plain_ko?: string; aliases?: string[] };
type PackTerm = SeedTerm & { manufacturing_context?: string; translations?: Record<string, string> };
type SlangTerm = {
  id: string;
  canonical_ko: string;
  variants_ko?: string[];
  asr_corrections?: string[];
  plain_ko?: string;
  translation_rule?: string;
  translations?: Record<string, string>;
};
type ViTerm = { id: string; ko: string; vi: string; plain_ko?: string };
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
 * 변형·오인식 목록은 합집합, 번역·의미·규칙은 먼저 읽은 값을 유지한다.
 */
class LexiconBuilder {
  private readonly byKey = new Map<string, LexiconEntry>();

  add(entry: LexiconEntry) {
    const canonical = entry.canonical.trim();
    if (!canonical) return;
    const key = `${entry.lang}:${canonical}`;
    const existing = this.byKey.get(key);
    if (!existing) {
      this.byKey.set(key, { ...entry, canonical, variants: unique(entry.variants), asrCorrections: unique(entry.asrCorrections) });
      return;
    }
    existing.variants = unique([...existing.variants, ...entry.variants]);
    existing.asrCorrections = unique([...existing.asrCorrections, ...entry.asrCorrections]);
    existing.translations = { ...entry.translations, ...existing.translations };
    existing.meaning ??= entry.meaning;
    existing.rule ??= entry.rule;
  }

  build(): LexiconEntry[] {
    return [...this.byKey.values()];
  }
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

  async load(): Promise<Dataset> {
    const [seed, manufacturing, slang, extendedSlang, vietnamese] = await Promise.all([
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
    ]);

    const lexicon = new LexiconBuilder();

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
        rule: term.translation_rule,
      });
    }
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
      });
    }

    const phrases: PhraseEntry[] = [...vietnamese.emergency_sentences, ...vietnamese.common_sentences].map(
      (sentence) => ({ id: sentence.id, lang: "ko", text: sentence.ko, translations: { vi: sentence.vi } }),
    );

    return {
      name: this.name,
      version: `seed-${seed.version}+vi-${vietnamese.version}`,
      lexicon: lexicon.build(),
      phrases,
    };
  }
}
