import { Router } from "express";
import type { AppContext } from "../context";
import { checkDatabase } from "../lib/prisma";
import type { HealthResponse } from "../shared/api";

export function healthRouter(context: AppContext): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const dbOk = await checkDatabase(context.prisma);
    const body: HealthResponse = {
      status: dbOk ? "ok" : "degraded",
      db: dbOk ? "ok" : "error",
      openai: context.env.OPENAI_API_KEY ? "configured" : "not_configured",
      dataset: context.domain.stats(),
    };

    // 비용 정보는 인증이 생기기 전까지 개발 환경에서만 노출한다.
    if (dbOk && context.env.NODE_ENV !== "production") {
      const budget = await context.budget.status();
      body.budget = {
        limitUsd: budget.limitUsd,
        spentUsd: budget.spentUsd,
        remainingUsd: budget.remainingUsd,
        period: budget.period,
      };
    }

    res.status(dbOk ? 200 : 503).json(body);
  });

  return router;
}
