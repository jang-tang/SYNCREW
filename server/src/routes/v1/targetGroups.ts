import { Router } from "express";
import { z } from "zod";
import { requireMembership, UUID } from "../../access/membership";
import type { AppContext } from "../../context";
import { Prisma } from "../../generated/prisma/client";
import { AppError } from "../../lib/errors";
import type { TargetGroup } from "../../shared/api";

// 일괄 지시 작업조 (B2, docs/streaming-plan.md 8-1절 ⑥). 관리자만 (구성원 403, 비멤버 404 — requireMembership).
// 지시를 보낼 때는 지금처럼 { userIds } 로 보낸다 (작업조는 앱이 대상을 빨리 고르기 위한 저장 묶음일 뿐).
//   GET    /sites/:siteId/target-groups
//   POST   /sites/:siteId/target-groups            { name, userIds }
//   PATCH  /sites/:siteId/target-groups/:groupId   { name?, userIds? }
//   DELETE /sites/:siteId/target-groups/:groupId

/** 현장당 작업조 수 상한 */
const MAX_GROUPS = 50;

const name = z.string().trim().min(1).max(30);
const userIds = z.array(z.string().regex(UUID)).min(1).max(200);
const createInput = z.object({ name, userIds });
const updateInput = z.object({ name: name.optional(), userIds: userIds.optional() }).refine((v) => v.name !== undefined || v.userIds !== undefined, {
  message: "바꿀 내용이 없습니다.",
});

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function targetGroupsRouter(context: AppContext): Router {
  const router = Router();
  const { prisma } = context;
  const manager = requireMembership(context, "manager");

  /** 다른 현장 사용자·제외된 사람은 넣을 수 없다 */
  async function checkMembers(siteId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const active = await prisma.siteMembership.count({ where: { siteId, status: "active", userId: { in: unique } } });
    if (active !== unique.length) throw new AppError("VALIDATION_ERROR", "현장 구성원이 아닌 사람이 있습니다.");
    return unique;
  }

  async function view(groupId: string): Promise<TargetGroup> {
    const group = await prisma.targetGroup.findUniqueOrThrow({ where: { id: groupId }, include: { members: true } });
    // 제외된 사람은 제외 시점에 지우지만, 혹시 남아 있어도 활성 멤버만 돌려준다
    const active = await prisma.siteMembership.findMany({
      where: { siteId: group.siteId, status: "active", userId: { in: group.members.map((m) => m.userId) } },
      select: { userId: true },
    });
    const keep = new Set(active.map((m) => m.userId));
    return {
      id: group.id,
      name: group.name,
      userIds: group.members.map((m) => m.userId).filter((id) => keep.has(id)),
      createdBy: group.createdBy,
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  /** 이 현장의 작업조가 아니면 404 (다른 현장 작업조 id 로 접근 차단) */
  async function requireGroup(siteId: string, groupId: unknown) {
    const id = String(groupId ?? "");
    const group = UUID.test(id) ? await prisma.targetGroup.findUnique({ where: { id } }) : null;
    if (!group || group.siteId !== siteId) throw new AppError("NOT_FOUND", "작업조를 찾을 수 없습니다.");
    return group;
  }

  router.get("/sites/:siteId/target-groups", manager, async (req, res) => {
    const groups = await prisma.targetGroup.findMany({ where: { siteId: req.membership!.siteId }, orderBy: { name: "asc" }, select: { id: true } });
    res.json(await Promise.all(groups.map((g) => view(g.id))));
  });

  router.post("/sites/:siteId/target-groups", manager, async (req, res) => {
    const input = createInput.parse(req.body);
    const siteId = req.membership!.siteId;
    if ((await prisma.targetGroup.count({ where: { siteId } })) >= MAX_GROUPS) {
      throw new AppError("CONFLICT", `작업조는 현장당 ${MAX_GROUPS}개까지 만들 수 있습니다.`);
    }
    const members = await checkMembers(siteId, input.userIds);
    try {
      const group = await prisma.targetGroup.create({
        data: { siteId, name: input.name, createdBy: req.auth!.userId, members: { create: members.map((userId) => ({ userId })) } },
      });
      res.status(201).json(await view(group.id));
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError("CONFLICT", "같은 이름의 작업조가 있습니다.");
      throw error;
    }
  });

  router.patch("/sites/:siteId/target-groups/:groupId", manager, async (req, res) => {
    const input = updateInput.parse(req.body);
    const siteId = req.membership!.siteId;
    const group = await requireGroup(siteId, req.params["groupId"]);
    const members = input.userIds ? await checkMembers(siteId, input.userIds) : null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.targetGroup.update({ where: { id: group.id }, data: { ...(input.name ? { name: input.name } : {}), updatedAt: new Date() } });
        if (members) {
          await tx.targetGroupMember.deleteMany({ where: { groupId: group.id } });
          await tx.targetGroupMember.createMany({ data: members.map((userId) => ({ groupId: group.id, userId })) });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError("CONFLICT", "같은 이름의 작업조가 있습니다.");
      throw error;
    }
    res.json(await view(group.id));
  });

  router.delete("/sites/:siteId/target-groups/:groupId", manager, async (req, res) => {
    const group = await requireGroup(req.membership!.siteId, req.params["groupId"]);
    await prisma.targetGroup.delete({ where: { id: group.id } });
    res.status(204).end();
  });

  return router;
}
