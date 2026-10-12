import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export type { PrismaClient };

export function createPrismaClient(databaseUrl: string): PrismaClient {
  // 세션 시간대를 UTC 로 고정한다. 어댑터는 시각을 시간대 없이 주고받으므로, DB 시간대가
  // Asia/Seoul 이면 저장값이 9시간 어긋나고 DB 의 now() 와 비교가 틀어진다.
  const adapter = new PrismaPg({ connectionString: databaseUrl, options: "-c TimeZone=UTC" });
  return new PrismaClient({ adapter });
}

export async function checkDatabase(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
