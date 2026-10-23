import { beforeAll, describe, expect, it } from "vitest";
import { LegacyWorkplaceAdapter } from "../src/engine/dataset/legacyWorkplaceAdapter";
import type { Dataset } from "../src/engine/dataset/types";
import { DomainProcessor } from "../src/engine/domain/domainProcessor";

// 데이터와 무관한 로직 검증용 가상 데이터셋
const dataset: Dataset = {
  name: "fixture",
  version: "1",
  lexicon: [
    {
      id: "L1",
      lang: "ko",
      canonical: "데스라",
      variants: ["데스리"],
      asrCorrections: ["대수라"],
      translations: { vi: "lan can", ru: "ограждение" },
      meaning: "난간",
      rule: "음차 금지",
    },
    {
      id: "L2",
      lang: "ko",
      canonical: "시마이",
      variants: ["시마이 치다", "마감"],
      asrCorrections: [],
      translations: { vi: "kết thúc công việc" },
    },
    { id: "L3", lang: "ko", canonical: "컨베이어", variants: ["벨트 컨베이어"], asrCorrections: [], translations: {} },
    { id: "L4", lang: "ko", canonical: "마감", variants: [], asrCorrections: [], translations: {} },
    { id: "L5", lang: "ko", canonical: "불", variants: [], asrCorrections: [], translations: {} },
  ],
  phrases: [{ id: "P1", lang: "ko", text: "데스라 먼저 설치하세요.", translations: { vi: "Hãy lắp lan can trước." } }],
};

describe("DomainProcessor", () => {
  const processor = new DomainProcessor(dataset);

  it("STT 오인식 표현을 표준 표현으로 보정한다", () => {
    const result = processor.process("대수라 먼저 설치하세요", "ko");
    expect(result.correctedText).toBe("데스라 먼저 설치하세요");
    expect(result.hits).toMatchObject([{ entryId: "L1", kind: "asr", matched: "대수라", corrected: true }]);
  });

  it("변형 표현은 감지만 하고 글은 바꾸지 않는다 (보정은 받아쓰기 오인식형만, 2026-10-23)", () => {
    const result = processor.process("데스리 쪽으로 가지 마", "ko");
    expect(result.originalText).toBe("데스리 쪽으로 가지 마");
    expect(result.correctedText).toBe("데스리 쪽으로 가지 마");
    expect(result.hits).toMatchObject([{ entryId: "L1", kind: "variant", corrected: false }]);
    // 뜻은 번역 문맥으로 전달된다 (문장에 있는 표현 그대로)
    expect(processor.buildContext(result, "vi").terms[0]).toMatchObject({ source: "데스리", target: "lan can" });
  });

  it("표준 표현으로 시작하는 활용형은 바꾸지 않고 감지만 한다", () => {
    const result = processor.process("이거 정리하고 시마이 치다", "ko");
    expect(result.correctedText).toBe("이거 정리하고 시마이 치다");
    expect(result.hits).toMatchObject([{ entryId: "L2", kind: "variant", corrected: false }]);
  });

  it("한국어는 띄어쓰기가 달라도 감지한다", () => {
    const result = processor.process("벨트컨베이어 멈춰", "ko");
    expect(result.hits).toMatchObject([{ entryId: "L3", matched: "벨트컨베이어" }]);
  });

  it("가장 긴 표현을 우선하고 겹치지 않게 감지한다", () => {
    const result = processor.process("벨트 컨베이어", "ko");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.entryId).toBe("L3");
  });

  it("다른 용어의 변형과 겹치는 표준 표현은 표준 표현을 우선한다", () => {
    const result = processor.process("오늘 마감합니다", "ko");
    expect(result.hits).toMatchObject([{ entryId: "L4", kind: "canonical", corrected: false }]);
  });

  it("너무 짧은 표현(1글자)은 감지하지 않는다", () => {
    expect(processor.process("불 꺼", "ko").hits).toHaveLength(0);
  });

  it("외국어 원문은 번역 값으로 용어를 감지하고 단어 경계를 지킨다", () => {
    expect(processor.process("Đứng gần lan can!", "vi").hits).toMatchObject([{ entryId: "L1", kind: "translation" }]);
    expect(processor.process("planned work", "vi").hits).toHaveLength(0);
    expect(processor.process("Где ОГРАЖДЕНИЕ?", "ru").hits).toMatchObject([{ entryId: "L1" }]);
  });

  it("번역 컨텍스트에 대상 언어 번역·의미·규칙을 담는다", () => {
    const result = processor.process("대수라 먼저", "ko");
    expect(processor.buildContext(result, "vi").terms).toEqual([
      { source: "데스라", target: "lan can", meaning: "난간", rule: "음차 금지" },
    ]);
    // 대상 언어 번역이 없으면 의미만 전달
    expect(processor.buildContext(result, "zh").terms[0]).not.toHaveProperty("target");
  });

  it("외국어 → 한국어 방향은 표준 표현을 번역 대상으로 넣는다", () => {
    const result = processor.process("lan can", "vi");
    expect(processor.buildContext(result, "ko").terms[0]).toMatchObject({ source: "lan can", target: "데스라" });
  });

  it("보정 후 검증 문장과 일치하면 문장 번역을 컨텍스트에 넣는다 (문장부호·공백 무시)", () => {
    const result = processor.process("대수라  먼저 설치하세요!", "ko");
    expect(result.phraseId).toBe("P1");
    expect(processor.buildContext(result, "vi").phrase).toEqual({
      source: "데스라 먼저 설치하세요.",
      target: "Hãy lắp lan can trước.",
    });
    expect(processor.buildContext(result, "uz").phrase).toBeUndefined();
  });

  it("컨텍스트 용어 수를 제한한다", () => {
    const limited = new DomainProcessor(dataset, { maxContextTerms: 1 });
    const result = limited.process("데스라 옆 컨베이어", "ko");
    expect(result.hits).toHaveLength(2);
    expect(limited.buildContext(result, "vi").terms).toHaveLength(1);
  });

  it("빈 문장과 데이터가 없는 언어를 처리한다", () => {
    expect(processor.process("   ", "ko").hits).toEqual([]);
    expect(processor.process("你好", "zh").hits).toEqual([]);
  });
});

describe("DomainProcessor + 기존 저장소 데이터셋", () => {
  let processor: DomainProcessor;

  beforeAll(async () => {
    processor = new DomainProcessor(await new LegacyWorkplaceAdapter("data/legacy-workplace").load());
  });

  it("은어 STT 오인식을 보정한다 (아씨봐 → 아시바)", () => {
    const result = processor.process("아씨봐 위로 올라가세요", "ko");
    expect(result.correctedText).toBe("아시바 위로 올라가세요");
    expect(processor.buildContext(result, "vi").terms[0]).toMatchObject({ source: "아시바", target: "giàn giáo" });
  });

  it("은어는 대상 언어 번역이 없어도 표준 한국어 뜻을 전달한다 (2026-10-23)", () => {
    // 데스라 = 출력 인원 (안전보건공단 사전 기준, 2026-10-24 실측 뒤 "오늘 출근한 작업 인원"으로 풀어 씀), STT 오인식 "대수라" 보정은 그대로
    const desura = processor.process("대수라 몇 명이야", "ko");
    expect(desura.correctedText).toBe("데스라 몇 명이야");
    expect(processor.buildContext(desura, "vi").terms[0]).toEqual({ source: "데스라", meaning: "= 오늘 출근한 작업 인원(출력 인원)" });
    // 기존 은어: 번역이 있는 언어는 번역 + 뜻, 없는 언어(zh)는 뜻만
    const ashiba = processor.buildContext(processor.process("아시바 위로 올라가", "ko"), "zh").terms[0]!;
    expect(ashiba).not.toHaveProperty("target");
    expect(ashiba.meaning).toMatch(/^= 비계\. /);
    // 공단 사전에서 새로 들어온 은어
    expect(processor.buildContext(processor.process("호리가다 먼저 해", "ko"), "ru").terms).toEqual([{ source: "호리가다", meaning: "= 터파기" }]);
  });

  it("일상 문장은 은어로 바뀌지 않는다 — 보정은 오인식형만 (나), 표준어·문장형 짧은 꼴 변형은 데이터에서 뺌 (가) (2026-10-23)", () => {
    // 예전: "우리 오야지님 어디입니까 계세요" / "요코로 놓으세요" / "바라시하고 단도리 하세요"
    for (const text of ["우리 반장님 어디 계세요", "가로로 놓으세요", "해체하고 준비 하세요", "점심은 현장 식당에서 먹어요", "천천히 하세요"]) {
      expect(processor.process(text, "ko").correctedText).toBe(text);
    }
    const ids = (text: string) => processor.process(text, "ko").hits.map((hit) => hit.matched);
    expect(ids("가로로 놓으세요")).toEqual([]);
    expect(ids("해체하고 준비 하세요")).toEqual([]);
    expect(ids("어디가 아파요")).toEqual([]);
    // 은어 철자 변형은 그대로 감지된다
    expect(processor.process("노가대 몇 명 왔어", "ko").hits).toMatchObject([{ matched: "노가대", kind: "variant", corrected: false }]);
  });

  it("고용노동부 안전표지 문장과 일치하면 중국어·우즈베크어 검증 번역을 쓴다", () => {
    const result = processor.process("안전모 착용 필수!", "ko");
    expect(processor.buildContext(result, "zh").phrase).toEqual({ source: "안전모 착용 필수", target: "必须佩戴安全帽" });
    expect(processor.buildContext(result, "uz").phrase?.target).toBe("Xavfsizlik kaskasini taqish majburiy");
  });

  it("검증 문장(긴급 문장)과 일치하면 베트남어 문장 번역을 찾는다", () => {
    const result = processor.process("멈춰!", "ko");
    expect(processor.buildContext(result, "vi").phrase?.target).toBe("Dừng lại ngay!");
  });
});
