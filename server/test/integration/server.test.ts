import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createApp } from "../../src/app";
import { createContext } from "../../src/bootstrap";
import type { AppContext } from "../../src/context";
import { loadEnv } from "../../src/config/env";
import { PrismaUsageStore } from "../../src/engine/budget/prismaUsageStore";
import { createLogger } from "../../src/lib/logger";

describe("서버 + 실제 Postgres", () => {
  let context: AppContext;

  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: inject("databaseUrl"), LOG_LEVEL: "silent" });
    context = await createContext(env, createLogger(env.LOG_LEVEL));
  });

  afterAll(async () => {
    await context.prisma.$disconnect();
  });

  it("GET /health: DB 연결·데이터셋·비용 한도를 보고한다", async () => {
    const response = await request(createApp(context)).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      db: "ok",
      openai: "not_configured",
      dataset: { name: "legacy-workplace" },
      budget: { limitUsd: 5, period: "month" },
    });
    expect(response.body.dataset.lexicon).toBeGreaterThan(0);
  });

  it("없는 경로는 공통 오류 형식으로 404", async () => {
    const response = await request(createApp(context)).get("/nope");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: expect.any(String) } });
  });

  it("사용량이 DB에 저장되고 비용 한도에 반영된다", async () => {
    const store = new PrismaUsageStore(context.prisma);
    const before = await store.sumCostSince(null);
    const reservation = await context.budget.reserve(0.01);
    await context.budget.commit(reservation, { kind: "translate", model: "gpt-realtime-2", outputAudioTokens: 1_000 });
    expect(await store.sumCostSince(null)).toBeCloseTo(before + 0.064, 6);
  });

  it("DB 제약조건: 알 수 없는 kind와 음수 비용을 거부한다", async () => {
    await expect(
      context.prisma.openAiUsage.create({ data: { kind: "tts", model: "x", costUsd: 0 } }),
    ).rejects.toThrow();
    await expect(
      context.prisma.openAiUsage.create({ data: { kind: "stt", model: "x", costUsd: -1 } }),
    ).rejects.toThrow();
  });
});
