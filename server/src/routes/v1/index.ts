import { Router } from "express";
import { requireAuth } from "../../auth/middleware";
import type { AppContext } from "../../context";
import { joinRouter } from "./join";
import { meRouter } from "./me";
import { sitesRouter } from "./sites";

/** /api/v1 — 모든 API는 로그인 필요 (docs/api-specification.md) */
export function v1Router(context: AppContext): Router {
  const router = Router();
  router.use(requireAuth(context));
  router.use(meRouter(context));
  router.use(sitesRouter(context));
  router.use(joinRouter(context));
  return router;
}
