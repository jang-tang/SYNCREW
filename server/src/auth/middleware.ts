import type { RequestHandler } from "express";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import "../http/requestTypes";

/** Authorization: Bearer <Supabase access token> 검증 */
export function requireAuth(context: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) throw new AppError("UNAUTHORIZED", "로그인이 필요합니다.");
    try {
      req.auth = await context.verifier.verify(token);
    } catch {
      throw new AppError("UNAUTHORIZED", "로그인이 만료되었거나 유효하지 않습니다.");
    }
    next();
  };
}

/** 프로필이 있어야 하는 API. 없으면 404 PROFILE_REQUIRED (앱이 프로필 설정 화면으로 보낸다) */
export function requireProfile(context: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const profile = await context.prisma.profile.findUnique({ where: { id: req.auth!.userId } });
    if (!profile || profile.deletedAt) throw new AppError("PROFILE_REQUIRED", "프로필을 먼저 설정해 주세요.");
    req.profile = profile;
    next();
  };
}
