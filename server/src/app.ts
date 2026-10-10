import express from "express";
import { pinoHttp } from "pino-http";
import type { AppContext } from "./context";
import { errorHandler, notFoundHandler } from "./lib/errors";
import { healthRouter } from "./routes/health";

export function createApp(context: AppContext) {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger: context.logger }));
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(context));
  // /api/v1 라우터는 Phase 2부터 추가한다.

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
