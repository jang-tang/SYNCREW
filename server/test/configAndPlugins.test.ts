import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";
import { createRetentionPolicy, nextRunAt, NoopRetentionPolicy } from "../src/plugins/retentionPolicy";

describe("환경 변수", () => {
  const base = { DATABASE_URL: "postgresql://u:p@localhost:5433/db" };

  it("기본값을 채운다 (비용 한도 $5, 월 단위, gpt-realtime-2.1)", () => {
    const env = loadEnv({ ...base, OPENAI_API_KEY: "  " });
    expect(env).toMatchObject({
      PORT: 4000,
      OPENAI_BUDGET_USD: 5,
      OPENAI_BUDGET_PERIOD: "month",
      TRANSLATION_MODEL: "gpt-realtime-2.1",
      AUDIO_PREPROCESSOR: "passthrough",
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("잘못된 값은 어떤 변수가 문제인지 알려 준다", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...base, OPENAI_BUDGET_USD: "-1" })).toThrow(/OPENAI_BUDGET_USD/);
    expect(() => loadEnv({ ...base, RETENTION_RUN_AT: "25:00" })).toThrow(/RETENTION_RUN_AT/);
  });
});

describe("데이터 보존 정책 훅", () => {
  it("기본 noop 정책은 아무것도 삭제하지 않는다", async () => {
    const policy = createRetentionPolicy("noop");
    expect(policy).toBeInstanceOf(NoopRetentionPolicy);
    expect(await policy.run({} as never)).toEqual({ deleted: {} });
    expect(() => createRetentionPolicy("unknown")).toThrow(/RETENTION_POLICY/);
  });

  it("다음 실행 시각을 계산한다", () => {
    const before = new Date(2026, 9, 10, 2, 0);
    expect(nextRunAt(before, "03:00")).toEqual(new Date(2026, 9, 10, 3, 0));
    const after = new Date(2026, 9, 10, 3, 0);
    expect(nextRunAt(after, "03:00")).toEqual(new Date(2026, 9, 11, 3, 0));
  });
});
