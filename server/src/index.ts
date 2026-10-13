import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app";
import { createContext } from "./bootstrap";
import { loadEnv } from "./config/env";
import { createLogger } from "./lib/logger";
import { checkDatabase } from "./lib/prisma";
import { createRetentionPolicy, startRetentionScheduler } from "./plugins/retentionPolicy";
import { attachRealtime } from "./realtime/gateway";
import { recoverOnStartup } from "./startup";

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const context = await createContext(env, logger);

  logger.info({ dataset: context.domain.stats() }, "현장 데이터셋 로드 완료");
  if (!(await checkDatabase(context.prisma))) {
    logger.warn("데이터베이스에 연결할 수 없습니다. `npm run db:start` 실행 여부를 확인하세요.");
  }
  if (env.ENGINE === "fake") {
    logger.warn("ENGINE=fake: 가짜 통역 엔진으로 실행합니다 (\"[vi] 원문\" 형식, OpenAI 호출 없음).");
  } else if (!env.OPENAI_API_KEY) {
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
    // 이전 실행에서 남은 통역 세션 닫기 + 멈춘 메시지 다시 처리 (src/startup.ts, 자동 테스트 test/integration/startup.test.ts)
    void recoverOnStartup(context)
      .then((result) => (result.closedSessions > 0 || result.requeuedMessages > 0) && logger.info(result, "시작 시 정리"))
      .catch((err) => logger.error({ err }, "시작 시 정리 실패"));
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "서버 종료 중");
    stopRetention();
    context.sessions.dispose();
    // io.close() 는 HTTP 서버도 함께 닫는다.
    void realtime.close().then(async () => {
      // 진행 중인 통역은 최대 5초 기다린다. 끝나지 않은 것은 다음 시작 때 복구된다.
      await Promise.race([context.pipeline.idle(), new Promise((resolve) => setTimeout(resolve, 5000))]);
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
