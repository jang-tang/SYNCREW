// 실제 서버 경로 지연 측정: 관리자 한국어 음성 메시지 1건 → 서버(STT·번역) → 구성원 실시간 수신까지.
// ENGINE=openai 서버면 실제 비용이 든다 (1회 약 $0.012). 가짜 엔진이면 비용 0.
// 준비: server/.e2e-accounts.json (scripts/e2e-accounts.ts), 두 계정이 같은 현장의 활성 멤버 (npm run e2e:live 한 번 실행)
// 실행: node e2e/latency.mjs [반복 횟수=1]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { io } from "socket.io-client";

const SERVER = process.env.SERVER_URL ?? "http://localhost:4000";
const RUNS = Number(process.argv[2] ?? 1);
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const accounts = JSON.parse(fs.readFileSync("../server/.e2e-accounts.json", "utf8"));
const outDir = path.resolve("e2e/output/latency");
fs.mkdirSync(outDir, { recursive: true });

async function login(account) {
  const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw error;
  const token = data.session.access_token;
  const api = async (method, url, body) => {
    const res = await fetch(`${SERVER}/api/v1${url}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(`${method} ${url} ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  return { token, api };
}

const health = await (await fetch(`${SERVER}/health`)).json();
console.log(`서버 비용 한도 $${health.budget.limitUsd}, 사용 $${health.budget.spentUsd.toFixed(4)}`);

const manager = await login(accounts.manager);
const member = await login(accounts.member);
const sites = await manager.api("GET", "/me/sites");
const memberSites = new Set((await member.api("GET", "/me/sites")).filter((s) => s.membershipStatus === "active").map((s) => s.id));
const site = sites.find((s) => s.role === "manager" && s.membershipStatus === "active" && memberSites.has(s.id));
if (!site) throw new Error("두 계정이 함께 속한 현장이 없습니다. 먼저 npm run e2e:live 를 실행하세요.");
const conversation = await manager.api("POST", `/sites/${site.id}/conversations/direct`, { userId: accounts.member.id });

// 관리자 발화: macOS say → m4a(AAC, 휴대폰 녹음과 같은 형식)
const ffmpeg = createRequire(path.resolve("../server/package.json"))("ffmpeg-static");
const aiff = path.join(outDir, "ko.aiff");
const m4a = path.join(outDir, "ko.m4a");
execFileSync("say", ["-v", "Yuna", "-o", aiff, "안전모를 착용하고 작업을 시작하세요."]);
execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "aac", "-b:a", "64k", "-ar", "44100", "-ac", "1", m4a]);
const audio = fs.readFileSync(m4a);

const socket = io(`${SERVER}/rt`, { transports: ["websocket"], auth: { token: member.token } });
await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });

for (let run = 1; run <= RUNS; run++) {
  const clientMessageId = crypto.randomUUID();
  const form = new FormData();
  form.append("clientMessageId", clientMessageId);
  form.append("audio", new Blob([audio], { type: "audio/mp4" }), "speech.m4a");
  const started = performance.now();
  const arrived = new Promise((resolve) => {
    const handler = ({ message }) => {
      if (message.status === "failed") { socket.off("message:new", handler); resolve({ message, failed: true }); }
      if (message.text) { socket.off("message:new", handler); resolve({ message }); }
    };
    socket.on("message:new", handler);
  });
  const sent = await manager.api("POST", `/conversations/${conversation.id}/messages`, form);
  const uploadMs = performance.now() - started;
  const { message, failed } = await Promise.race([arrived, new Promise((r) => setTimeout(() => r({ timeout: true }), 30000))]).then((v) => v);
  const totalMs = performance.now() - started;
  let audioMs = null;
  if (message?.audioUrl) {
    const t = performance.now();
    const res = await fetch(message.audioUrl.startsWith("http") ? message.audioUrl : `${SERVER}${message.audioUrl}`);
    await res.arrayBuffer();
    audioMs = performance.now() - t;
  }
  console.log(JSON.stringify({
    run,
    messageId: sent.messageId,
    uploadMs: Math.round(uploadMs),
    toRecipientMs: Math.round(totalMs),
    audioDownloadMs: audioMs && Math.round(audioMs),
    text: message?.text,
    original: message?.originalText,
    hasAudio: Boolean(message?.audioUrl),
    failed: Boolean(failed),
  }));
}
socket.disconnect();
const after = await (await fetch(`${SERVER}/health`)).json();
console.log(`사용 $${after.budget.spentUsd.toFixed(4)} (이번 실행 $${(after.budget.spentUsd - health.budget.spentUsd).toFixed(4)})`);
process.exit(0);
