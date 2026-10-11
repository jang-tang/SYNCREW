import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import request from "supertest";
import { inject } from "vitest";
import { createApp } from "../../src/app";
import { createJwtVerifier } from "../../src/auth/verifier";
import { createContext } from "../../src/bootstrap";
import { loadEnv } from "../../src/config/env";
import type { AppContext, Limits } from "../../src/context";
import type { DomainEvents } from "../../src/events/domainEvents";
import { createLogger } from "../../src/lib/logger";

export const ISSUER = "https://test-project.supabase.co/auth/v1";

/** Supabase와 같은 형식(ES256, iss, aud=authenticated)의 토큰을 만드는 테스트용 발급자 */
export async function createTokenIssuer() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
  const verifier = createJwtVerifier({ keys: createLocalJWKSet({ keys: [jwk] }), issuer: ISSUER });
  const sign = (claims: { sub: string; email?: string }, options: { issuer?: string; expiresIn?: string | number } = {}) =>
    new SignJWT({ email: claims.email ?? `${claims.sub.slice(0, 8)}@test.dev`, role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(claims.sub)
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "1h")
      .sign(privateKey);
  return { verifier, sign, privateKey };
}

/** 도메인 이벤트 기록기 (실시간 알림이 호출됐는지 확인용) */
export function recordEvents() {
  const log: { type: string; payload: Record<string, unknown> }[] = [];
  const events: DomainEvents = {
    membershipChanged: (payload) => log.push({ type: "membershipChanged", payload }),
    joinRequested: (payload) => log.push({ type: "joinRequested", payload }),
  };
  return { events, log };
}

export async function createTestApp(options: { limits?: Limits } = {}) {
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: inject("databaseUrl"), LOG_LEVEL: "silent" });
  const issuer = await createTokenIssuer();
  const recorder = recordEvents();
  const context: AppContext = await createContext(env, createLogger("silent"), {
    verifier: issuer.verifier,
    events: recorder.events,
    limits: options.limits ?? { joinPerMinute: 100 },
  });
  const app = createApp(context);

  /** 테스트 사용자: 고유 id로 만들어 다른 테스트 파일과 데이터가 섞이지 않는다 */
  const user = async (name = "사용자", lang = "ko") => {
    const id = randomUUID();
    const token = await issuer.sign({ sub: id });
    const as = (method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
      request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
    const withProfile = async () => {
      const res = await as("put", "/me").send({ displayName: name, preferredLang: lang });
      if (res.status !== 200) throw new Error(`profile setup failed: ${res.status} ${JSON.stringify(res.body)}`);
      return api;
    };
    const api = { id, token, as, withProfile };
    return api;
  };

  return { app, context, issuer, events: recorder.log, user, close: () => context.prisma.$disconnect() };
}
