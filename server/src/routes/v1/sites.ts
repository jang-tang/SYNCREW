import { Router } from "express";
import { z } from "zod";
import { requireMembership } from "../../access/membership";
import { requireProfile } from "../../auth/middleware";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import type { SiteRole } from "../../shared/api";
import { issueJoinCode, isUsable } from "../../sites/joinCodes";
import { toJoinCode, toMember, toMySite } from "../../sites/mappers";
import { langSchema } from "./me";

const siteInput = z.object({
  name: z.string().trim().min(1).max(60),
  address: z.string().trim().max(120).optional(),
});

const sitePatch = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    address: z.string().trim().max(120).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "변경할 항목이 없습니다.");

const codeInput = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
});

const memberPatch = z.union([
  z.object({ action: z.enum(["approve", "reject", "remove"]) }).strict(),
  z.object({ langOverride: langSchema.nullable() }).strict(),
  z.object({ role: z.enum(["manager", "member"]) }).strict(),
]);

const memberQuery = z.object({ status: z.enum(["pending", "active"]).optional() });

/** 새 현장의 첫 가입 코드 유효 기간 */
const FIRST_CODE_HOURS = 24 * 7;

export function sitesRouter(context: AppContext): Router {
  const router = Router();
  const { prisma } = context;
  const member = requireMembership(context);
  const manager = requireMembership(context, "manager");

  /** 현장 생성: 현장 + 관리자 멤버십 + 기본 그룹 대화 + 첫 가입 코드를 한 트랜잭션으로 */
  router.post("/sites", requireProfile(context), async (req, res) => {
    const input = siteInput.parse(req.body);
    const userId = req.auth!.userId;
    const site = await prisma.$transaction(async (tx) => {
      const created = await tx.site.create({
        data: { name: input.name, address: input.address || null, createdBy: userId },
      });
      await tx.siteMembership.create({
        data: { siteId: created.id, userId, role: "manager", status: "active", decidedBy: userId, decidedAt: new Date() },
      });
      await tx.conversation.create({
        data: { siteId: created.id, type: "group", participants: { create: { userId } } },
      });
      await issueJoinCode(tx, { siteId: created.id, createdBy: userId, expiresInHours: FIRST_CODE_HOURS });
      return created;
    });
    res.status(201).json(toMySite(site, { role: "manager", status: "active" }, 1));
  });

  router.get("/sites/:siteId", member, async (req, res) => {
    const site = await prisma.site.findUniqueOrThrow({ where: { id: req.membership!.siteId } });
    const count = await prisma.siteMembership.count({ where: { siteId: site.id, status: "active" } });
    res.json(toMySite(site, { role: req.membership!.role, status: "active" }, count));
  });

  router.patch("/sites/:siteId", manager, async (req, res) => {
    const input = sitePatch.parse(req.body);
    const site = await prisma.site.update({ where: { id: req.membership!.siteId }, data: input });
    const count = await prisma.siteMembership.count({ where: { siteId: site.id, status: "active" } });
    res.json(toMySite(site, { role: "manager", status: "active" }, count));
  });

  // ─── 가입 코드 ───────────────────────────────────

  router.get("/sites/:siteId/join-codes", manager, async (req, res) => {
    const codes = await prisma.siteJoinCode.findMany({
      where: { siteId: req.membership!.siteId, revokedAt: null },
      orderBy: { createdAt: "asc" },
    });
    res.json(codes.filter((code) => isUsable(code)).map(toJoinCode));
  });

  router.post("/sites/:siteId/join-codes", manager, async (req, res) => {
    const input = codeInput.parse(req.body ?? {});
    const code = await issueJoinCode(prisma, { siteId: req.membership!.siteId, createdBy: req.auth!.userId, ...input });
    res.status(201).json(toJoinCode(code));
  });

  router.delete("/sites/:siteId/join-codes/:codeId", manager, async (req, res) => {
    const { count } = await prisma.siteJoinCode.updateMany({
      where: { id: String(req.params["codeId"]), siteId: req.membership!.siteId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new AppError("NOT_FOUND", "가입 코드를 찾을 수 없습니다.");
    res.status(204).end();
  });

  // ─── 멤버 ───────────────────────────────────────

  /** 관리자: 가입 요청 + 멤버 / 구성원: 활성 멤버만 */
  router.get("/sites/:siteId/members", member, async (req, res) => {
    const { status } = memberQuery.parse(req.query);
    const isManager = req.membership!.role === "manager";
    const visible = isManager ? (status ? [status] : ["pending", "active"]) : ["active"];
    const rows = await prisma.siteMembership.findMany({
      where: { siteId: req.membership!.siteId, status: { in: visible } },
      include: { user: true },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });
    res.json(rows.map((row) => toMember(row, context.presence.isOnline(row.userId), context.devices.get(row.userId))));
  });

  router.patch("/sites/:siteId/members/:userId", manager, async (req, res) => {
    const input = memberPatch.parse(req.body);
    const siteId = req.membership!.siteId;
    const targetId = String(req.params["userId"]);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId: targetId } } });
      if (!target || target.status === "rejected" || target.status === "removed") {
        throw new AppError("NOT_FOUND", "멤버를 찾을 수 없습니다.");
      }
      const group = await tx.conversation.findFirst({ where: { siteId, type: "group" } });

      if ("role" in input) {
        if (target.status !== "active") throw new AppError("CONFLICT", "활성 멤버만 역할을 바꿀 수 있습니다.");
        if (target.role === input.role) return null; // 이미 그 역할 (멱등)
        if (target.role === "manager") {
          const managers = await tx.siteMembership.count({ where: { siteId, role: "manager", status: "active" } });
          if (managers <= 1) throw new AppError("CONFLICT", "현장의 마지막 관리자는 해제할 수 없습니다.");
        }
        await tx.siteMembership.update({ where: { id: target.id }, data: { role: input.role, decidedBy: req.auth!.userId, decidedAt: now } });
        return { role: input.role as SiteRole, status: "active" } as const;
      }

      if ("langOverride" in input) {
        if (target.status !== "active") throw new AppError("CONFLICT", "활성 멤버만 언어를 바꿀 수 있습니다.");
        await tx.siteMembership.update({ where: { id: target.id }, data: { langOverride: input.langOverride } });
        return null;
      }

      if (input.action === "approve" || input.action === "reject") {
        if (target.status !== "pending") throw new AppError("CONFLICT", "가입 요청 상태가 아닙니다.");
        const status = input.action === "approve" ? "active" : "rejected";
        await tx.siteMembership.update({ where: { id: target.id }, data: { status, decidedBy: req.auth!.userId, decidedAt: now } });
        if (status === "active" && group) {
          await tx.conversationParticipant.upsert({
            where: { conversationId_userId: { conversationId: group.id, userId: targetId } },
            create: { conversationId: group.id, userId: targetId },
            update: { leftAt: null, joinedAt: now },
          });
        }
        return { role: target.role as SiteRole, status } as const;
      }

      // remove
      if (target.status !== "active") throw new AppError("CONFLICT", "활성 멤버만 제외할 수 있습니다.");
      if (targetId === req.auth!.userId) throw new AppError("FORBIDDEN", "자기 자신은 제외할 수 없습니다.");
      if (target.role === "manager") {
        const managers = await tx.siteMembership.count({ where: { siteId, role: "manager", status: "active" } });
        if (managers <= 1) throw new AppError("CONFLICT", "현장의 마지막 관리자는 제외할 수 없습니다.");
      }
      await tx.siteMembership.update({ where: { id: target.id }, data: { status: "removed", decidedBy: req.auth!.userId, decidedAt: now } });
      // 제외되면 모든 대화에서 나간다 (이후 메시지 수신 차단)
      await tx.conversationParticipant.updateMany({
        where: { userId: targetId, leftAt: null, conversation: { siteId } },
        data: { leftAt: now },
      });
      // 이 현장의 작업조에서도 뺀다 (B2)
      await tx.targetGroupMember.deleteMany({ where: { userId: targetId, group: { siteId } } });
      return { role: target.role as SiteRole, status: "removed" } as const;
    });

    // 커밋 후 실시간 알림 (Phase 3에서 Socket.IO로 전달)
    if (result) context.events.membershipChanged({ siteId, userId: targetId, role: result.role, status: result.status });
    // 제외되면 진행 중인 통화·일괄 지시에서도 즉시 뺀다.
    if (result?.status === "removed") await context.sessions.memberRemoved(siteId, targetId);
    res.status(204).end();
  });

  return router;
}
