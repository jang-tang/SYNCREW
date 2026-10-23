import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    // 베트남어 긴급 160 + 고용노동부 안전표지 19 + 베트남어 일반 420
    expect(dataset.phrases).toHaveLength(160 + 19 + 420);

    // 같은 표준 표현은 하나로 합쳐진다
    const canonicals = dataset.lexicon.map((entry) => `${entry.lang}:${entry.canonical}`);
    expect(new Set(canonicals).size).toBe(canonicals.length);

    // 지원 언어 외 번역(th, id, ne, km)은 버린다
    for (const entry of dataset.lexicon) {
      for (const lang of Object.keys(entry.translations)) expect(LANG_CODES).toContain(lang);
    }

    // 은어의 표준 한국어 뜻 (extended pack 의 translate_as_ko)
    const ashiba = dataset.lexicon.find((entry) => entry.canonical === "아시바")!;
    expect(ashiba).toMatchObject({ standardKo: "비계", translations: { vi: "giàn giáo" }, risk: "critical" });
  });

  it("보충: 데스라·아나방은 안전보건공단 사전 기준으로 다른 파일의 같은 항목을 대신한다 (2026-10-23)", async () => {
    const dataset = await new LegacyWorkplaceAdapter("data/legacy-workplace").load();
    const find = (canonical: string) => dataset.lexicon.find((entry) => entry.canonical === canonical)!;
    const desura = find("데스라");
    expect(desura).toMatchObject({ standardKo: "출력 인원", translations: {}, variants: [] });
    expect(desura.asrCorrections).toContain("대수라");
    // 원본 파일들의 "난간" 뜻·번역·변형("데스리 난간" 등)은 합쳐지지 않는다
    expect(desura.meaning).toBeUndefined();
    expect(find("데스리")).toMatchObject({ standardKo: "난간", risk: "high" });
    expect(find("아나방")).toMatchObject({ standardKo: "유공강판(PSP)", translations: {} });
  });

  it("보충: 공단 사전 은어는 표준 한국어 뜻으로 들어가고, 기존 항목은 기존 뜻을 지키며 철자 변형만 더한다", async () => {
    const dataset = await new LegacyWorkplaceAdapter("data/legacy-workplace").load();
    const find = (canonical: string) => dataset.lexicon.find((entry) => entry.canonical === canonical)!;
    expect(find("호리가다")).toMatchObject({ standardKo: "터파기", translations: {}, domain: "construction_slang" });
    const mekkura = find("메꾸라");
    expect(mekkura.standardKo).toBe("마개 또는 막음");
    expect(mekkura.translations.vi).toBe("nút bịt hoặc bịt kín");
    expect(mekkura.variants).toEqual(expect.arrayContaining(["메꾸라시", "매꾸라이"]));
    // 표준어는 변형에 넣지 않는다 (변형은 은어로 "보정"되므로)
    expect(find("호리가다").variants).not.toContain("터파기");
  });

  it("보충: 고용노동부 안전표지 문장은 ko·vi·zh·uz 검증 문장으로 들어간다", async () => {
    const dataset = await new LegacyWorkplaceAdapter("data/legacy-workplace").load();
    const helmet = dataset.phrases.find((phrase) => phrase.id === "MOEL06a")!;
    expect(helmet).toMatchObject({
      lang: "ko",
      text: "안전모 착용 필수",
      translations: { vi: "Phải đội mũ bảo hộ.", zh: "必须佩戴安全帽", uz: "Xavfsizlik kaskasini taqish majburiy" },
    });
    expect(Object.keys(helmet.translations)).not.toContain("category");
  });

  it("보충 파일이 없는 데이터 폴더도 읽는다", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "syncrew-legacy-"));
    try {
      cpSync("data/legacy-workplace", dir, { recursive: true, filter: (source) => !source.includes("supplement") });
      const dataset = await new LegacyWorkplaceAdapter(dir).load();
      expect(dataset.phrases).toHaveLength(160 + 420);
      expect(dataset.lexicon.find((entry) => entry.canonical === "데스라")!.translations.vi).toBe("lan can hoặc thanh chắn an toàn");
      expect(dataset.version).not.toContain("kosha");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
