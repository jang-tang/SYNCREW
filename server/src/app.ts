import express from "express";
import { pinoHttp } from "pino-http";
import type { AppContext } from "./context";
import { errorHandler, notFoundHandler } from "./lib/errors";
import { healthRouter } from "./routes/health";
import { v1Router } from "./routes/v1";

export function createApp(context: AppContext) {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger: context.logger }));
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(context));
  app.use("/api/v1", v1Router(context));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
