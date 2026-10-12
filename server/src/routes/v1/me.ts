import { Router } from "express";
import { z } from "zod";
import { requireProfile } from "../../auth/middleware";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import type { MembershipStatus, MySite, SiteRole, SyncResponse } from "../../shared/api";
import { LANG_CODES, SUPPORTED_LANGUAGES, type Lang } from "../../shared/languages";
import { conversationSummaries, visibleTo } from "../../messaging/conversations";
import { fullMessage, toMessageViews } from "../../messaging/views";
import { toMySite, toProfile } from "../../sites/mappers";

export const langSchema = z.enum(LANG_CODES as [Lang, ...Lang[]]);

const profileInput = z.object({
  displayName: z.string().trim().min(1).max(40),
  preferredLang: langSchema,
  autoPlay: z.boolean().optional(),
  speechRate: z.number().min(0.5).max(1.5).optional(),
});

/** 한 번에 돌려주는 최대 메시지 수. 더 많으면 앱은 대화별 목록 API 로 보충한다. */
const SYNC_MESSAGE_LIMIT = 200;

const syncQuery = z.object({
  since: z.coerce.date().optional(),
  siteId: z.string().uuid().optional(),
});

export function meRouter(context: AppContext): Router {
  const router = Router();
  const { prisma } = context;

  router.get("/languages", (_req, res) => {
    res.json(SUPPORTED_LANGUAGES.map(({ code, name, nativeName }) => ({ code, name, nativeName })));
  });

  router.get("/me", async (req, res) => {
    const profile = await prisma.profile.findUnique({ where: { id: req.auth!.userId } });
    if (!profile || profile.deletedAt) throw new AppError("PROFILE_REQUIRED", "프로필을 먼저 설정해 주세요.");
    res.json(toProfile(profile));
  });

  /** 프로필 생성(회원가입 직후 최초 1회) 또는 수정 */
  router.put("/me", async (req, res) => {
    const input = profileInput.parse(req.body);
    const { userId, email } = req.auth!;
    const profile = await prisma.profile.upsert({
      where: { id: userId },
      create: { id: userId, email, ...input },
      update: { ...input, ...(email ? { email } : {}), deletedAt: null },
    });
    res.json(toProfile(profile));
  });

  /**
   * 재연결 동기화 (docs/api-specification.md 9절). since 이후 바뀐 내 멤버십, 메시지가 오간 대화 요약,
   * 내가 보냈거나 받은 메시지 중 바뀐 것을 돌려준다. 응답의 cursor 를 다음 since 로 쓴다.
   */
  router.get("/sync", requireProfile(context), async (req, res) => {
    const { since, siteId } = syncQuery.parse(req.query);
    const userId = req.auth!.userId;
    const cursor = new Date().toISOString();
    const changed = since ? { updatedAt: { gt: since } } : {};
    const memberships = await prisma.siteMembership.findMany({
      where: { userId, ...changed, ...(siteId ? { siteId } : {}) },
      select: { siteId: true, status: true, role: true },
    });

    // 활성 멤버인 현장의 메시지만 (제외된 현장 데이터는 내보내지 않는다)
    const activeSites = (
      await prisma.siteMembership.findMany({ where: { userId, status: "active", ...(siteId ? { siteId } : {}) }, select: { siteId: true } })
    ).map((m) => m.siteId);
    const messages = await prisma.message.findMany({
      where: {
        siteId: { in: activeSites },
        // 보이는 메시지(OR) 와 변경분(OR) 두 조건을 함께 걸기 위해 AND 로 묶는다.
        AND: [
          visibleTo(userId),
          ...(since ? [{ OR: [{ updatedAt: { gt: since } }, { recipients: { some: { userId, updatedAt: { gt: since } } } }] }] : []),
        ],
      },
      orderBy: { seq: "desc" },
      take: SYNC_MESSAGE_LIMIT,
      include: fullMessage,
    });
    messages.reverse();
    const conversationsBySite = new Map<string, string[]>();
    for (const message of messages) {
      if (!message.conversationId) continue;
      const list = conversationsBySite.get(message.siteId) ?? [];
      if (!list.includes(message.conversationId)) list.push(message.conversationId);
      conversationsBySite.set(message.siteId, list);
    }
    const conversations = (
      await Promise.all(
        [...conversationsBySite].map(([site, ids]) => conversationSummaries(prisma, context.audioUrls, site, userId, ids)),
      )
    ).flat();

    const body: SyncResponse = {
      cursor,
      conversations,
      messages: await toMessageViews(prisma, context.audioUrls, messages, userId),
      memberships: memberships.map((m) => ({ siteId: m.siteId, status: m.status as MembershipStatus, role: m.role as SiteRole })),
    };
    res.json(body);
  });

  router.get("/me/sites", requireProfile(context), async (req, res) => {
    const memberships = await prisma.siteMembership.findMany({
      where: { userId: req.auth!.userId },
      include: { site: true },
      orderBy: { createdAt: "asc" },
    });
    const counts = await prisma.siteMembership.groupBy({
      by: ["siteId"],
      where: { siteId: { in: memberships.map((m) => m.siteId) }, status: "active" },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((c) => [c.siteId, c._count._all]));
    const sites: MySite[] = memberships.map((m) => toMySite(m.site, m, countOf.get(m.siteId) ?? 0));
    res.json(sites);
  });

  return router;
}
