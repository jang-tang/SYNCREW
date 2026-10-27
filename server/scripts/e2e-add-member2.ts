// 세 번째 시험 계정(구성원 2)을 관리자·구성원 시험 계정이 함께 속한 현장에 가입시킨다 (통화 상대 바꾸기 C1 실기기 시험, 2026-10-26 사용자 허락).
// 프로필(이름·언어)을 만들고 → 관리자가 가입 코드를 만들고 → 구성원 2가 참여 요청 → 관리자가 승인. 이미 멤버면 아무것도 안 한다.
// 사용 (서버 실행 중, server 폴더에서): npx tsx scripts/e2e-accounts.ts && npx tsx scripts/e2e-add-member2.ts [--server http://localhost:4000] [--lang zh]
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const SERVER = option("server", "http://localhost:4000").replace(/\/$/, "");
const LANG = option("lang", "zh");

const root = path.resolve(import.meta.dirname, "..", "..");
const accounts = JSON.parse(readFileSync(path.join(root, "server/.e2e-accounts.json"), "utf8")) as Record<
  "manager" | "member" | "member2",
  { email: string; password: string; id: string }
>;
if (!accounts.member2) throw new Error("member2 계정이 없습니다 — npx tsx scripts/e2e-accounts.ts 먼저");
const appEnv = parseEnv(readFileSync(path.join(root, "frontend/.env"), "utf8"));
const SUPABASE_URL = appEnv["EXPO_PUBLIC_SUPABASE_URL"]!;
const KEY = appEnv["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]!;

async function signIn(account: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!res.ok) throw new Error(`로그인 실패 ${account.email} ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const client = (token: string) => async <T>(method: string, route: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${SERVER}/api/v1${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
};

const manager = client(await signIn(accounts.manager));
const member2 = client(await signIn(accounts.member2));

await member2("PUT", "/me", { displayName: "Li E2E", preferredLang: LANG });

// 관리자 계정이 관리자이고 구성원 계정도 활성 멤버인 현장 (call-peer.ts 가 쓰는 현장)
const sync = await manager<{ memberships: { siteId: string; status: string; role: string }[] }>("GET", "/sync");
let siteId: string | null = null;
for (const m of sync.memberships.filter((x) => x.status === "active" && x.role === "manager")) {
  const members = await manager<{ userId: string; status: string }[]>("GET", `/sites/${m.siteId}/members`);
  if (members.some((x) => x.userId === accounts.member.id && x.status === "active")) {
    if (members.some((x) => x.userId === accounts.member2.id && x.status === "active")) {
      console.log(`이미 멤버: 현장 ${m.siteId}`);
      process.exit(0);
    }
    siteId = m.siteId;
    break;
  }
}
if (!siteId) throw new Error("관리자·구성원 시험 계정이 함께 속한 현장이 없습니다.");

const code = await manager<{ code: string }>("POST", `/sites/${siteId}/join-codes`, { maxUses: 1, expiresInHours: 1 });
await member2("POST", "/join", { code: code.code }).catch((error: Error) => {
  if (!String(error.message).includes("ALREADY_MEMBER")) throw error;
});
await manager("PATCH", `/sites/${siteId}/members/${accounts.member2.id}`, { action: "approve" });
console.log(`가입·승인 완료: ${accounts.member2.email} (Li E2E, ${LANG}) → 현장 ${siteId}`);
