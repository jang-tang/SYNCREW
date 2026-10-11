import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app";
import { createContext } from "./bootstrap";
import { loadEnv } from "./config/env";
import { createLogger } from "./lib/logger";
import { checkDatabase } from "./lib/prisma";
import { createRetentionPolicy, startRetentionScheduler } from "./plugins/retentionPolicy";
import { attachRealtime } from "./realtime/gateway";

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

  const server = createServer(createApp(context));
  // REST 와 같은 포트에 Socket.IO(/rt)를 붙이고, 도메인 이벤트를 실시간 알림으로 연결한다.
  const realtime = attachRealtime(server, context);
  context.events = realtime.events;
  server.listen(env.PORT, env.HOST, () => {
    logger.info(`SYNCREW 서버 시작: http://${env.HOST}:${env.PORT} (실시간: /rt)`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "서버 종료 중");
    stopRetention();
    // io.close() 는 HTTP 서버도 함께 닫는다.
    void realtime.close().then(async () => {
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
