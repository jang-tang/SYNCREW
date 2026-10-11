import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireProfile } from "../../auth/middleware";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import type { JoinResult } from "../../shared/api";
import type { Lang } from "../../shared/languages";
import { isUsable, normalizeCode } from "../../sites/joinCodes";

const joinInput = z.object({ code: z.string().min(1).max(32) });

export function joinRouter(context: AppContext): Router {
  const router = Router();
  const { prisma } = context;

  // 가입 코드 무차별 대입 방지: 사용자당 1분 N회
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: context.limits.joinPerMinute,
    keyGenerator: (req) => req.auth!.userId,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.")),
  });

  router.post("/join", requireProfile(context), limiter, async (req, res) => {
    const code = normalizeCode(joinInput.parse(req.body).code);
    const userId = req.auth!.userId;

    const outcome = await prisma.$transaction(async (tx) => {
      const entry = await tx.siteJoinCode.findUnique({ where: { code }, include: { site: true } });
      if (!entry || !isUsable(entry) || entry.site.status !== "active") {
        throw new AppError("INVALID_JOIN_CODE", "코드가 맞지 않거나 만료되었습니다.");
      }
      const existing = await tx.siteMembership.findUnique({ where: { siteId_userId: { siteId: entry.siteId, userId } } });
      if (existing?.status === "active") throw new AppError("ALREADY_MEMBER", "이미 참여한 현장입니다.");
      if (existing?.status === "pending") return { site: entry.site, created: false };

      // 사용 횟수는 조건부로 올려 동시 요청에서도 최대 횟수를 넘지 않게 한다.
      const { count } = await tx.siteJoinCode.updateMany({
        where: { id: entry.id, ...(entry.maxUses !== null ? { useCount: { lt: entry.maxUses } } : {}) },
        data: { useCount: { increment: 1 } },
      });
      if (count === 0) throw new AppError("INVALID_JOIN_CODE", "코드가 맞지 않거나 만료되었습니다.");

      if (existing) {
        // 거절·제외된 사용자의 재가입 요청
        await tx.siteMembership.update({
          where: { id: existing.id },
          data: { status: "pending", role: "member", decidedBy: null, decidedAt: null },
        });
      } else {
        await tx.siteMembership.create({ data: { siteId: entry.siteId, userId, role: "member", status: "pending" } });
      }
      return { site: entry.site, created: true };
    });

    if (outcome.created) {
      const profile = req.profile!;
      context.events.joinRequested({ siteId: outcome.site.id, userId, displayName: profile.displayName, lang: profile.preferredLang as Lang });
    }
    const body: JoinResult = { siteId: outcome.site.id, siteName: outcome.site.name, status: "pending" };
    res.status(outcome.created ? 201 : 200).json(body);
  });

  return router;
}
