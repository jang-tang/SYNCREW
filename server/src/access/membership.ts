import type { RequestHandler } from "express";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import "../http/requestTypes";

/**
 * /sites/:siteId/** 접근 권한: 활성 멤버만.
 * 멤버가 아니면 현장이 있는지조차 알려 주지 않도록 404, 역할이 부족하면 403.
 */
export function requireMembership(context: AppContext, role?: "manager"): RequestHandler {
  return async (req, _res, next) => {
    const siteId = String(req.params["siteId"] ?? "");
    const membership = UUID.test(siteId)
      ? await context.prisma.siteMembership.findUnique({
          where: { siteId_userId: { siteId, userId: req.auth!.userId } },
        })
      : null;
    if (!membership || membership.status !== "active") throw new AppError("NOT_FOUND", "현장을 찾을 수 없습니다.");
    if (role && membership.role !== role) throw new AppError("FORBIDDEN", "관리자만 할 수 있습니다.");
    req.membership = {
      siteId,
      userId: membership.userId,
      role: membership.role as "manager" | "member",
      langOverride: membership.langOverride,
    };
    next();
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
