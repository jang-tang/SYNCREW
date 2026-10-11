import type { AuthIdentity } from "../auth/verifier";

/** 인증·권한 미들웨어가 요청에 붙이는 정보 */
export type RequestProfile = {
  id: string;
  email: string;
  displayName: string;
  preferredLang: string;
  autoPlay: boolean;
  speechRate: number;
};

export type RequestMembership = {
  siteId: string;
  userId: string;
  role: "manager" | "member";
  langOverride: string | null;
};

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthIdentity;
    profile?: RequestProfile;
    membership?: RequestMembership;
  }
}
