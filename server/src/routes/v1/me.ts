import { Router } from "express";
import { z } from "zod";
import { requireProfile } from "../../auth/middleware";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import type { MySite } from "../../shared/api";
import { LANG_CODES, SUPPORTED_LANGUAGES, type Lang } from "../../shared/languages";
import { toMySite, toProfile } from "../../sites/mappers";

export const langSchema = z.enum(LANG_CODES as [Lang, ...Lang[]]);

const profileInput = z.object({
  displayName: z.string().trim().min(1).max(40),
  preferredLang: langSchema,
  autoPlay: z.boolean().optional(),
  speechRate: z.number().min(0.5).max(1.5).optional(),
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
