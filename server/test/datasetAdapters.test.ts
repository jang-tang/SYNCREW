import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LegacyWorkplaceAdapter } from "../src/engine/dataset/legacyWorkplaceAdapter";
import { NormalizedJsonAdapter } from "../src/engine/dataset/normalizedJsonAdapter";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";
import { LANG_CODES } from "../src/shared/languages";

describe("LegacyWorkplaceAdapter", () => {
  it("기존 저장소 데이터를 원본 형식 그대로 읽는다", async () => {
    const dataset = await new LegacyWorkplaceAdapter("data/legacy-workplace").load();
    expect(dataset.lexicon.length).toBeGreaterThan(500);
    expect(dataset.phrases).toHaveLength(160 + 420);

    // 같은 표준 표현은 하나로 합쳐진다
    const canonicals = dataset.lexicon.map((entry) => `${entry.lang}:${entry.canonical}`);
    expect(new Set(canonicals).size).toBe(canonicals.length);

    // 지원 언어 외 번역(th, id, ne, km)은 버린다
    for (const entry of dataset.lexicon) {
      for (const lang of Object.keys(entry.translations)) expect(LANG_CODES).toContain(lang);
    }

    const desura = dataset.lexicon.find((entry) => entry.canonical === "데스라")!;
    expect(desura.asrCorrections).toContain("대수라");
    expect(desura.translations.vi).toBe("lan can hoặc thanh chắn an toàn");
  });
});

describe("NormalizedJsonAdapter", () => {
  const writeJson = (value: unknown) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "syncrew-ds-")), "dataset.json");
    writeFileSync(file, JSON.stringify(value));
    return file;
  };

  it("정규화 형식을 읽고 기본값을 채운다", async () => {
    const file = writeJson({
      name: "new-dataset",
      version: "2026.10",
      lexicon: [{ id: "A", lang: "ko", canonical: "아시바", translations: { zh: "脚手架", uz: "iskala" } }],
    });
    const dataset = await new NormalizedJsonAdapter(file).load();
    expect(dataset.lexicon[0]).toMatchObject({ variants: [], asrCorrections: [], translations: { zh: "脚手架" } });
    expect(dataset.phrases).toEqual([]);
  });

  it("지원하지 않는 언어나 필수 필드 누락은 거부한다", async () => {
    const file = writeJson({ name: "x", version: "1", lexicon: [{ id: "A", lang: "th", canonical: "x" }] });
    await expect(new NormalizedJsonAdapter(file).load()).rejects.toThrow();
  });
});

describe("createDatasetAdapter", () => {
  it("알 수 없는 어댑터 이름은 시작 시 실패한다", () => {
    expect(() => createDatasetAdapter("unknown", ".")).toThrow(/DATASET_ADAPTER/);
  });
});
