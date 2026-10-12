import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 번역 음성 URL 서명.
 * 앱의 오디오 플레이어는 Authorization 헤더를 붙일 수 없으므로(특히 웹), 서버가 조회자별로
 * 만료 시각이 있는 서명 URL 을 만든다. 서명은 (메시지, 언어, 조회자, 만료)에 묶이며,
 * 다운로드 시점에도 조회자의 권한(발신자·수신자, 활성 멤버)을 다시 확인한다.
 * URL 은 서버 기준 상대 경로이고, 앱이 API 주소를 앞에 붙인다.
 */
export class AudioUrlSigner {
  private readonly key: Buffer;

  constructor(
    secret: string | undefined,
    private readonly ttlSeconds = 24 * 60 * 60,
  ) {
    this.key = secret ? Buffer.from(secret) : randomBytes(32);
  }

  private sign(messageId: string, lang: string, userId: string, exp: number): string {
    return createHmac("sha256", this.key).update(`${messageId}|${lang}|${userId}|${exp}`).digest("base64url");
  }

  url(messageId: string, lang: string, userId: string, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + this.ttlSeconds;
    const params = new URLSearchParams({ lang, u: userId, exp: String(exp), sig: this.sign(messageId, lang, userId, exp) });
    return `/api/v1/messages/${messageId}/audio?${params}`;
  }

  /** 서명이 맞고 만료 전이면 true */
  verify(messageId: string, query: { lang: string; u: string; exp: string; sig: string }, now = Date.now()): boolean {
    const exp = Number(query.exp);
    if (!Number.isInteger(exp) || exp * 1000 < now) return false;
    const expected = Buffer.from(this.sign(messageId, query.lang, query.u, exp));
    const actual = Buffer.from(query.sig);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
