import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type AuthIdentity = {
  userId: string;
  email: string;
  /** 토큰 만료 시각 (epoch 초). 실시간 연결에서 만료 알림에 쓴다. */
  expiresAt?: number;
};

/** 로그인 토큰 검증기. 운영은 Supabase JWKS, 테스트는 로컬 키를 쓴다. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthIdentity>;
}

export class InvalidTokenError extends Error {
  constructor(message = "유효하지 않은 로그인 토큰입니다.") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/**
 * Supabase Auth 토큰(ES256) 검증: 서명(JWKS), 만료, 발급자(iss), 대상(aud=authenticated).
 * 서버는 공개키만 쓰므로 비밀 키가 필요 없다.
 */
export function createJwtVerifier(options: { keys: JWTVerifyGetKey; issuer: string; audience?: string }): TokenVerifier {
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, options.keys, {
          issuer: options.issuer,
          audience: options.audience ?? "authenticated",
          algorithms: ["ES256", "RS256"],
        });
        if (typeof payload.sub !== "string" || !payload.sub) throw new InvalidTokenError("토큰에 사용자 정보가 없습니다.");
        return {
          userId: payload.sub,
          email: typeof payload.email === "string" ? payload.email : "",
          ...(typeof payload.exp === "number" ? { expiresAt: payload.exp } : {}),
        };
      } catch (error) {
        if (error instanceof InvalidTokenError) throw error;
        throw new InvalidTokenError();
      }
    },
  };
}

export function createSupabaseVerifier(supabaseUrl: string, jwksUrl?: string): TokenVerifier {
  const base = supabaseUrl.replace(/\/+$/, "");
  return createJwtVerifier({
    keys: createRemoteJWKSet(new URL(jwksUrl ?? `${base}/auth/v1/.well-known/jwks.json`)),
    issuer: `${base}/auth/v1`,
  });
}
