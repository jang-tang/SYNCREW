import "dotenv/config";
import { createApp } from "./app";
import { createContext } from "./bootstrap";
import { loadEnv } from "./config/env";
import { createLogger } from "./lib/logger";
import { checkDatabase } from "./lib/prisma";
import { createRetentionPolicy, startRetentionScheduler } from "./plugins/retentionPolicy";

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const context = await createContext(env, logger);

  logger.info({ dataset: context.domain.stats() }, "현장 데이터셋 로드 완료");
  if (!(await checkDatabase(context.prisma))) {
    logger.warn("데이터베이스에 연결할 수 없습니다. `npm run db:start` 실행 여부를 확인하세요.");
  }
  if (!env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY가 없습니다. 통역 기능은 비활성화됩니다 (`npm run setup:openai`).");
  }

  const stopRetention = startRetentionScheduler(createRetentionPolicy(env.RETENTION_POLICY), {
    runAt: env.RETENTION_RUN_AT,
    db: context.prisma,
    logger,
  });

  const server = createApp(context).listen(env.PORT, env.HOST, () => {
    logger.info(`SYNCREW 서버 시작: http://${env.HOST}:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "서버 종료 중");
    stopRetention();
    server.close(async () => {
      await context.prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
