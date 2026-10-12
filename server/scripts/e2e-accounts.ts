// live 모드 확인용 Supabase 테스트 계정(관리자 1, 구성원 1)을 준비한다. (2026-10-12 사용자 허락)
// 관리자 API로 만들어 이메일 확인을 건너뛴다 (메일 발송 없음). 이미 있으면 비밀번호만 새로 정한다.
// 결과(이메일·비밀번호)는 .e2e-accounts.json 에 저장한다 (gitignore). 앱 e2e(frontend/e2e/live.mjs)가 읽는다.
// 사용: npx tsx scripts/e2e-accounts.ts          계정 준비
//       npx tsx scripts/e2e-accounts.ts --delete 계정 삭제 (Supabase 에서만. 로컬 DB 기록은 남는다)
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const FILE = ".e2e-accounts.json";
const ACCOUNTS = [
  { role: "manager", email: "syncrew-e2e-manager@example.com" },
  { role: "member", email: "syncrew-e2e-member@example.com" },
] as const;

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY 가 없습니다 (.env 확인).");

async function admin<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${url}/auth/v1/admin${path}`, {
    ...init,
    headers: { apikey: secret!, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase admin ${init.method ?? "GET"} ${path} ${response.status}: ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : undefined) as T;
}

async function findUser(email: string): Promise<{ id: string } | undefined> {
  const { users } = await admin<{ users: { id: string; email?: string }[] }>("/users?per_page=1000");
  return users.find((user) => user.email === email);
}

async function main() {
  if (process.argv.includes("--delete")) {
    for (const account of ACCOUNTS) {
      const user = await findUser(account.email);
      if (user) await admin(`/users/${user.id}`, { method: "DELETE" });
      console.log(user ? `삭제: ${account.email}` : `없음: ${account.email}`);
    }
    if (existsSync(FILE)) rmSync(FILE);
    return;
  }

  const saved = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Record<string, { password: string }>) : {};
  const result: Record<string, { email: string; password: string; id: string }> = {};
  for (const account of ACCOUNTS) {
    const password = saved[account.role]?.password ?? `e2e-${randomBytes(12).toString("base64url")}`;
    const existing = await findUser(account.email);
    const user = existing
      ? await admin<{ id: string }>(`/users/${existing.id}`, { method: "PUT", body: JSON.stringify({ password, email_confirm: true }) })
      : await admin<{ id: string }>("/users", { method: "POST", body: JSON.stringify({ email: account.email, password, email_confirm: true }) });
    result[account.role] = { email: account.email, password, id: user.id };
    console.log(`${existing ? "갱신" : "생성"}: ${account.role} ${account.email} (${user.id})`);
  }
  writeFileSync(FILE, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(`${FILE} 에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
