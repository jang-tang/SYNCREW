import type { Env } from "./config/env";
import type { AppContext } from "./context";
import { BudgetGuard } from "./engine/budget/budgetGuard";
import { buildPricingTable } from "./engine/budget/pricing";
import { PrismaUsageStore } from "./engine/budget/prismaUsageStore";
import { DomainProcessor } from "./engine/domain/domainProcessor";
import type { Logger } from "./lib/logger";
import { createPrismaClient } from "./lib/prisma";
import { createAudioPreprocessor } from "./plugins/audioPreprocessor";
import { createDatasetAdapter } from "./plugins/datasetAdapter";

/** 환경 변수로부터 서버 의존성을 만든다. 설정 오류는 시작 시점에 바로 실패시킨다. */
export async function createContext(env: Env, logger: Logger): Promise<AppContext> {
  const pricing = buildPricingTable(env.OPENAI_PRICING_JSON);
  for (const model of [env.STT_MODEL, env.TRANSLATION_MODEL]) {
    if (!pricing[model]) {
      throw new Error(`모델 단가가 없습니다: ${model}. OPENAI_PRICING_JSON에 추가하세요.`);
    }
  }

  const adapter = createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH);
  const domain = new DomainProcessor(await adapter.load());

  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), pricing, {
    limitUsd: env.OPENAI_BUDGET_USD,
    period: env.OPENAI_BUDGET_PERIOD,
  });

  return {
    env,
    logger,
    prisma,
    budget,
    domain,
    audioPreprocessor: createAudioPreprocessor(env.AUDIO_PREPROCESSOR),
  };
}
