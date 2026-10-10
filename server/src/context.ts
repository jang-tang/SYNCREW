import type { Env } from "./config/env";
import type { AudioPreprocessor } from "./engine/audio/audioPreprocessor";
import type { BudgetGuard } from "./engine/budget/budgetGuard";
import type { DomainProcessor } from "./engine/domain/domainProcessor";
import type { Logger } from "./lib/logger";
import type { PrismaClient } from "./lib/prisma";

/** 서버 전역 의존성. 테스트에서는 일부를 가짜로 바꿔 넣는다. */
export type AppContext = {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  budget: BudgetGuard;
  domain: DomainProcessor;
  audioPreprocessor: AudioPreprocessor;
};
