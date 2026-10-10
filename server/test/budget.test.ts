import { describe, expect, it } from "vitest";
import { BudgetExceededError, BudgetGuard, InMemoryUsageStore } from "../src/engine/budget/budgetGuard";
import { buildPricingTable, DEFAULT_PRICING, estimateCostUsd, UnknownModelPriceError } from "../src/engine/budget/pricing";

const pricing = buildPricingTable(undefined);

describe("단가 계산", () => {
  it("gpt-realtime-2 토큰 사용량으로 비용을 계산한다", () => {
    // 텍스트 입력 1,000 × $4/1M + 음성 출력 2,000 × $64/1M = 0.004 + 0.128
    expect(estimateCostUsd(pricing, "gpt-realtime-2", { inputTextTokens: 1000, outputAudioTokens: 2000 })).toBeCloseTo(0.132, 6);
  });

  it("단가가 없는 모델은 거부한다", () => {
    expect(() => estimateCostUsd(pricing, "unknown-model", {})).toThrow(UnknownModelPriceError);
  });

  it("OPENAI_PRICING_JSON으로 단가를 덮어쓴다", () => {
    const custom = buildPricingTable(
      JSON.stringify({ "gpt-realtime-2": { ...DEFAULT_PRICING["gpt-realtime-2"], outputAudio: 10 } }),
    );
    expect(custom["gpt-realtime-2"]!.outputAudio).toBe(10);
    expect(custom["gpt-4o-mini-transcribe"]).toBeDefined();
    expect(() => buildPricingTable(JSON.stringify({ x: { inputText: -1 } }))).toThrow(/OPENAI_PRICING_JSON/);
  });
});

describe("BudgetGuard ($5 한도)", () => {
  const createGuard = (now = () => new Date("2026-10-15T00:00:00Z")) => {
    const store = new InMemoryUsageStore(now);
    const guard = new BudgetGuard(store, pricing, { limitUsd: 5, period: "month", now });
    return { store, guard };
  };

  it("한도 안에서는 예약·기록하고 남은 금액을 계산한다", async () => {
    const { guard, store } = createGuard();
    const reservation = await guard.reserve(0.5);
    expect((await guard.status()).remainingUsd).toBeCloseTo(4.5);

    const cost = await guard.commit(reservation, { kind: "translate", model: "gpt-realtime-2", outputAudioTokens: 1_000 });
    expect(cost).toBeCloseTo(0.064);
    expect(store.records).toHaveLength(1);
    expect(await guard.status()).toMatchObject({ reservedUsd: 0 });
    expect((await guard.status()).spentUsd).toBeCloseTo(0.064);
  });

  it("한도를 넘는 호출은 거부한다", async () => {
    const { guard, store } = createGuard();
    await store.insert({ kind: "stt", model: "gpt-4o-mini-transcribe", costUsd: 4.9 });
    await expect(guard.reserve(0.2)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(guard.reserve(0.1)).resolves.toBeDefined();
  });

  it("동시에 들어온 예약을 합산해 한도를 넘지 않는다", async () => {
    const { guard } = createGuard();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => guard.reserve(1)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
  });

  it("실패한 호출의 예약은 풀린다", async () => {
    const { guard } = createGuard();
    const reservation = await guard.reserve(5);
    await expect(guard.reserve(0.01)).rejects.toBeInstanceOf(BudgetExceededError);
    guard.release(reservation);
    await expect(guard.reserve(0.01)).resolves.toBeDefined();
  });

  it("month 기간은 매월 1일(UTC)에 초기화된다", async () => {
    let now = new Date("2026-10-31T23:00:00Z");
    const store = new InMemoryUsageStore(() => now);
    const guard = new BudgetGuard(store, pricing, { limitUsd: 5, period: "month", now: () => now });
    await store.insert({ kind: "translate", model: "gpt-realtime-2", costUsd: 5 });
    await expect(guard.reserve(0.01)).rejects.toBeInstanceOf(BudgetExceededError);

    now = new Date("2026-11-01T00:00:01Z");
    await expect(guard.reserve(0.01)).resolves.toBeDefined();
  });

  it("total 기간은 초기화되지 않는다", async () => {
    let now = new Date("2026-10-31T23:00:00Z");
    const store = new InMemoryUsageStore(() => now);
    const guard = new BudgetGuard(store, pricing, { limitUsd: 5, period: "total", now: () => now });
    await store.insert({ kind: "translate", model: "gpt-realtime-2", costUsd: 5 });
    now = new Date("2027-01-01T00:00:00Z");
    await expect(guard.reserve(0.01)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
