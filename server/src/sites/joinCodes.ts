import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";

/** 혼동하기 쉬운 0·O·1·I·L 을 뺀 문자 (현장에서 불러 주기 쉽게) */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export function generateCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** 사용자가 입력한 코드 정리: 공백·하이픈 제거, 대문자 */
export const normalizeCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

type Db = PrismaClient | Prisma.TransactionClient;

/** 겹치지 않는 코드로 발급 (충돌 시 재시도) */
export async function issueJoinCode(
  db: Db,
  input: { siteId: string; createdBy: string; expiresInHours?: number; maxUses?: number },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const exists = await db.siteJoinCode.findUnique({ where: { code } });
    if (exists) continue;
    return db.siteJoinCode.create({
      data: {
        siteId: input.siteId,
        code,
        createdBy: input.createdBy,
        expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600_000) : null,
        maxUses: input.maxUses ?? null,
      },
    });
  }
  throw new Error("가입 코드를 발급하지 못했습니다 (충돌 반복).");
}

/** 지금 사용할 수 있는 코드인지 (폐기·만료·횟수 소진 아님) */
export function isUsable(code: { revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; useCount: number }, now = new Date()) {
  return !code.revokedAt && (!code.expiresAt || code.expiresAt > now) && (code.maxUses === null || code.useCount < code.maxUses);
}
