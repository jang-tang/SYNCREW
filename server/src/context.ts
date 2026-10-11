import type { TokenVerifier } from "./auth/verifier";
import type { Env } from "./config/env";
import type { AudioPreprocessor } from "./engine/audio/audioPreprocessor";
import type { BudgetGuard } from "./engine/budget/budgetGuard";
import type { DomainProcessor } from "./engine/domain/domainProcessor";
import type { DomainEvents } from "./events/domainEvents";
import type { Logger } from "./lib/logger";
import type { PrismaClient } from "./lib/prisma";

export type Limits = {
  /** 가입 코드 입력: 사용자당 1분 횟수 */
  joinPerMinute: number;
};

/** 서버 전역 의존성. 테스트에서는 일부를 가짜로 바꿔 넣는다. */
export type AppContext = {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  budget: BudgetGuard;
  domain: DomainProcessor;
  audioPreprocessor: AudioPreprocessor;
  verifier: TokenVerifier;
  events: DomainEvents;
  limits: Limits;
};
