import { Router } from "express";
import { requireAuth } from "../../auth/middleware";
import type { AppContext } from "../../context";
import { audioRouter, conversationsRouter } from "./conversations";
import { instructionsRouter } from "./instructions";
import { joinRouter } from "./join";
import { meRouter } from "./me";
import { sessionsRouter } from "./sessions";
import { sitesRouter } from "./sites";
import { targetGroupsRouter } from "./targetGroups";

/** /api/v1 — 모든 API는 로그인 필요 (docs/api-specification.md). 음성 다운로드만 서명 URL 로 인증 */
export function v1Router(context: AppContext): Router {
  const router = Router();
  router.use(audioRouter(context));
  router.use(requireAuth(context));
  router.use(meRouter(context));
  router.use(sitesRouter(context));
  router.use(joinRouter(context));
  router.use(conversationsRouter(context));
  router.use(sessionsRouter(context));
  router.use(instructionsRouter(context));
  router.use(targetGroupsRouter(context));
  return router;
}
