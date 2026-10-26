// 실기기 시험용 "통화 상대" 스크립트 (docs/HANDOFF.md 7절, 시나리오 F·G·H, docs/device-test-log.md).
// e2e 테스트 계정 하나로 로그인해 휴대폰(다른 e2e 계정)과 1:1 통화를 하고, 합성 음성(macOS say)으로 몇 초마다 말한다.
//   - 스트리밍(stream:open)이 되면 100ms PCM 조각을 실시간 속도로 보내고 stream:pause, 안 되면 문장 단위 업로드(utterances)
//   - 휴대폰이 보낸 것: stream:out:* (조각 수·음량·첫 조각까지 시간) 과 message:new 를 출력하고, 받은 음성은 wav 로 저장한다
//     같은 언어 통화(relay)면 휴대폰 마이크 소리가 그대로 오므로 "헤드셋 마이크가 무음인지"·에코를 귀와 숫자(dBFS)로 확인할 수 있다
//   - 휴대폰의 오디오 경로 보고(device:changed: bluetooth/wired/builtin)도 출력한다
// 비용: 서버가 ENGINE=fake 면 0. 실제 OpenAI 서버에서 쓰면 통역 통화 비용이 든다(스트리밍 말한 1분당 약 $0.18) — 실행 전 안내·승인.
//
// 사용 (서버 실행 중, server 폴더에서):
//   npx tsx scripts/call-peer.ts                       # 구성원 계정으로 관리자 계정(휴대폰)에게 전화 → 수락되면 8초마다 말하기
//   npx tsx scripts/call-peer.ts --answer              # 휴대폰이 걸어 오는 전화를 기다렸다가 받기
//   npx tsx scripts/call-peer.ts --as manager          # 이 스크립트가 관리자 계정 (휴대폰은 구성원 계정)
//   npx tsx scripts/call-peer.ts --as member2 --answer # 세 번째 계정(구성원 2)으로 받기만 — 휴대폰 2대(관리자·구성원)와 함께 통화 상대 바꾸기(C1) 시험
//                                                      #   (--peer manager|member: 누구와 함께 속한 현장을 쓸지·누구에게 걸지, 기본 manager)
//   옵션: --server http://localhost:4000  --every 8  --count 0(무한)  --listen(말하지 않고 듣기만)  --utterance(스트리밍 쓰지 않음)  --text "문장"
//         --continuous(말 사이에도 작은 잡음을 계속 보냄 — 휴대폰 앱처럼 마이크가 늘 켜진 상황. 2026-10-23 원문 밀림 재현용)
// 끝내기: Ctrl+C (통화를 끊고 종료). 받은 음성: server/call-peer-output/
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { io, type Socket } from "socket.io-client";
import { decodeToPcm, encodeWav } from "../src/engine/audio/codec";
import type { Lang } from "../src/shared/languages";
import type { LiveSession, Profile } from "../src/shared/api";
import { REALTIME_NAMESPACE, type ClientToServerEvents, type ServerToClientEvents } from "../src/shared/realtime";

const RATE = 16_000;
const FRAME_SAMPLES = RATE / 10; // 100ms
/** 언어별 합성 음성 (uz 는 macOS 음성이 없어 러시아어 음성으로 읽는다) */
const SPEECH: Record<Lang, { voice: string; text: string }> = {
  ko: { voice: "Yuna", text: "안전모를 쓰고 삼 층 비계 작업을 시작하세요." },
  vi: { voice: "Linh", text: "Tôi hiểu rồi. Tôi sẽ bắt đầu ngay." },
  zh: { voice: "Tingting", text: "三楼的模板已经拆完了，下一步做什么？" },
  ru: { voice: "Milena", text: "У меня закончились перчатки, где взять новые?" },
  uz: { voice: "Milena", text: "Tushundim, hozir boshlayman." },
};

// ─── 옵션 ───────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const SERVER = option("server", "http://localhost:4000").replace(/\/$/, "");
type AccountRole = "member" | "manager" | "member2";
const asOption = option("as", "member");
const AS: AccountRole = asOption === "manager" || asOption === "member2" ? asOption : "member";
const PEER: AccountRole = AS === "member2" ? (option("peer", "manager") === "member" ? "member" : "manager") : AS === "member" ? "manager" : "member";
const EVERY_MS = Number(option("every", "8")) * 1000;
const COUNT = Number(option("count", "0"));
const LISTEN_ONLY = flag("listen");
const FORCE_UTTERANCE = flag("utterance");
const ANSWER = flag("answer");
const CONTINUOUS = flag("continuous");
const outDir = path.resolve("call-peer-output");
mkdirSync(outDir, { recursive: true });

const root = path.resolve(import.meta.dirname, "..", "..");
const accounts = JSON.parse(readFileSync(path.join(root, "server/.e2e-accounts.json"), "utf8")) as Record<
  AccountRole,
  { email: string; password: string; id: string }
>;
if (!accounts[AS]) throw new Error(`${AS} 계정이 없습니다 — npx tsx scripts/e2e-accounts.ts 먼저`);
const appEnv = parseEnv(readFileSync(path.join(root, "frontend/.env"), "utf8"));
const SUPABASE_URL = appEnv["EXPO_PUBLIC_SUPABASE_URL"];
const PUBLISHABLE_KEY = appEnv["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("frontend/.env 에 Supabase URL·publishable key 가 필요합니다.");

const t0 = Date.now();
const log = (...parts: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...parts);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── 로그인·API ─────────────────────────────────────
async function signIn(account: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!res.ok) throw new Error(`로그인 실패 ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const token = await signIn(accounts[AS]);
async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SERVER}/api/v1${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body instanceof FormData || !body ? {} : { "Content-Type": "application/json" }) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

const me = await api<Profile>("GET", "/me");
const sync = await api<{ memberships: { siteId: string; status: string }[] }>("GET", "/sync");
const peerId = accounts[PEER].id;
let siteId: string | null = null;
for (const m of sync.memberships.filter((x) => x.status === "active")) {
  const members = await api<{ userId: string; status: string }[]>("GET", `/sites/${m.siteId}/members`);
  if (members.some((x) => x.userId === peerId && x.status === "active")) {
    siteId = m.siteId;
    break;
  }
}
if (!siteId) throw new Error(`${AS}·${PEER} 계정이 함께 속한 현장이 없습니다.`);
log(`나: ${me.displayName} (${AS}, ${me.preferredLang}) · 상대(휴대폰): ${accounts[PEER].email} · 현장 ${siteId} · 서버 ${SERVER}`);

// 말할 음성은 통화 전에 미리 만든다 (say 가 처음엔 수 초 걸린다)
const speech = SPEECH[me.preferredLang];
const text = option("text", speech.text);
const aiff = path.join(outDir, `say-${me.preferredLang}.aiff`);
execFileSync("say", ["-v", speech.voice, "-o", aiff, text]);
const decoded = await decodeToPcm(aiff, RATE);
const voice = decoded.data;
const wavFile = path.join(outDir, `say-${me.preferredLang}.wav`);
writeFileSync(wavFile, encodeWav(voice, RATE));

// ─── 실시간 연결 ─────────────────────────────────────
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(`${SERVER}${REALTIME_NAMESPACE}`, {
  transports: ["websocket"],
  auth: { token },
});
await new Promise<void>((resolve, reject) => {
  socket.once("connect", () => resolve());
  socket.once("connect_error", (error) => reject(error));
});
await socket.emitWithAck("site:subscribe", { siteId });
log("실시간 연결됨");

let session: LiveSession | null = null;
let streamId: string | null = null;
let ended = false;

socket.on("session:updated", ({ session: s }) => {
  if (session && s.id !== session.id) return;
  session = s;
  const peer = s.participants.find((p) => p.userId === peerId);
  log(`통화 상태: ${s.status}${s.endReason ? ` (${s.endReason})` : ""} · 휴대폰 연결 ${peer?.online ? "O" : "X"}`);
  if (s.status === "ended") ended = true;
});
socket.on("device:changed", ({ userId, device }) => {
  if (userId !== peerId) return;
  log(`휴대폰 오디오 경로: ${device ? `${device.audioRoute}${device.inputName ? ` (${device.inputName})` : ""} · 마이크 권한 ${device.micPermission}` : "없음(연결 끊김)"}`);
});

// 휴대폰 → 나: 스트리밍 턴
type Turn = { started: number; rate: number; chunks: Buffer[]; firstChunkMs: number | null; original: string | null; translation: string };
const turns = new Map<string, Turn>();
function levelDb(pcm: Int16Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (const v of pcm) {
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const db = (x: number) => (x > 0 ? Math.max(-120, 20 * Math.log10(x / 32768)) : -120);
  return { rms: db(Math.sqrt(sum / Math.max(1, pcm.length))), peak: db(peak) };
}
socket.on("stream:out:start", (p) => {
  turns.set(p.turnId, { started: Date.now(), rate: p.sampleRate, chunks: [], firstChunkMs: null, original: null, translation: "" });
  log(`◀ 휴대폰 말 시작 (턴 ${p.turnId.slice(0, 8)}, ${p.lang}, ${p.sampleRate}Hz)`);
});
socket.on("stream:out:audio", (p) => {
  const turn = turns.get(p.turnId);
  if (!turn) return;
  if (turn.firstChunkMs === null) turn.firstChunkMs = Date.now() - turn.started;
  turn.chunks.push(Buffer.from(p.pcm));
});
socket.on("stream:out:text", (p) => {
  const turn = turns.get(p.turnId);
  if (!turn) return;
  if (p.kind === "original") turn.original = p.text;
  else turn.translation += p.text;
});
socket.on("stream:out:end", (p) => {
  const turn = turns.get(p.turnId);
  turns.delete(p.turnId);
  if (!turn) return;
  const all = Buffer.concat(turn.chunks);
  const pcm = new Int16Array(all.buffer, all.byteOffset, all.byteLength >> 1);
  const seconds = pcm.length / turn.rate;
  const { rms, peak } = levelDb(pcm);
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${p.turnId.slice(0, 8)}.wav`);
  if (pcm.length > 0) writeFileSync(file, encodeWav(pcm, turn.rate));
  log(
    `◀ 휴대폰 말 끝 (${p.status}) · 조각 ${turn.chunks.length}개 ${seconds.toFixed(1)}초 · 첫 조각 ${turn.firstChunkMs ?? "-"}ms · 음량 평균 ${rms.toFixed(0)}dB 최대 ${peak.toFixed(0)}dB${pcm.length > 0 && peak < -50 ? " ⚠ 거의 무음" : ""}`,
  );
  if (turn.original) log(`   원문: ${turn.original}`);
  if (turn.translation) log(`   통역: ${turn.translation}`);
  if (pcm.length > 0) log(`   저장: ${path.relative(process.cwd(), file)}`);
});
socket.on("message:new", ({ message }) => {
  if (!session || message.sessionId !== session.id || message.senderId === me.id) return;
  log(`◀ 기록 도착 (${message.sourceLang}→${me.preferredLang}): ${message.text ?? message.originalText ?? "(처리 중)"}${message.audioUrl ? " [음성]" : ""}`);
});
socket.on("message:status", (p) => log(`▶ 내 문장 상태: ${p.status}`));
socket.on("stream:fallback", (p) => {
  if (p.streamId !== streamId) return;
  log(`스트리밍 중단 (${p.reason}) → 문장 단위로 보냅니다`);
  streamId = null;
});
socket.on("disconnect", (reason) => log(`실시간 연결 끊김: ${reason}`));

// ─── 통화 연결 ───────────────────────────────────────
if (ANSWER) {
  log("휴대폰에서 이 계정으로 전화를 걸어 주세요…");
  const invite = await new Promise<LiveSession>((resolve) => {
    socket.on("session:invite", ({ session: s }) => {
      if (s.mode === "call") resolve(s);
    });
  });
  session = await api<LiveSession>("POST", `/sessions/${invite.id}/accept`);
  log(`전화 받음 (${invite.startedByName})`);
} else {
  session = await api<LiveSession>("POST", `/sites/${siteId}/calls`, { userId: peerId });
  log("전화 거는 중… 휴대폰에서 받아 주세요");
  while (session.status === "ringing" && !ended) await wait(200);
  if (session.status !== "active") {
    log(`통화가 연결되지 않았습니다 (${session.status} ${session.endReason ?? ""})`);
    process.exit(1);
  }
}
const sessionId = session.id;
log(`통화 연결됨 (세션 ${sessionId})`);

let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  if (streamId) socket.emit("stream:close", { streamId }, () => undefined);
  if (!ended) await api("POST", `/sessions/${sessionId}/end`).catch(() => undefined);
  log("통화를 끊었습니다");
  await wait(300);
  socket.close();
  process.exit(0);
}
process.on("SIGINT", () => void quit());
// 스크립트가 오류로 멈춰도 통화가 휴대폰에 남지 않게 끊고 나간다
process.on("uncaughtException", (error) => {
  log(`오류: ${error.message}`);
  void quit();
});
process.on("unhandledRejection", (error) => {
  log(`오류: ${(error as Error).message}`);
  void quit();
});

// ─── 말하기 ──────────────────────────────────────────
if (!FORCE_UTTERANCE) {
  const opened = await socket
    .timeout(15_000)
    .emitWithAck("stream:open", { sessionId, format: { encoding: "pcm16", sampleRate: RATE, channels: 1 } })
    .catch(() => ({ ok: false as const, code: "TIMEOUT" }));
  if (opened.ok) {
    streamId = opened.streamId;
    log(`스트리밍 연결 (${opened.mode === "relay" ? "같은 언어: 소리 그대로 전달" : "통역"})`);
  } else log(`스트리밍을 열 수 없음 (${opened.code}) → 문장 단위로 보냅니다`);
}



async function speakStream(id: string) {
  // 말 + 뒤 무음 0.8초를 100ms 조각으로 실시간 속도로 보낸다 (앱처럼 seq 는 스트림 안에서 계속 증가).
  // 무음은 서버 VAD(무음 500ms)가 턴을 끝낼 만큼 길어야 한다 — stream:pause 는 "보내기 중단" 뜻일 뿐 턴을 확정하지 않는다
  // (수동 commit 은 OpenAI 세션의 VAD 를 멈춰 뒤의 말이 모두 사라졌다, 2026-10-19 실측)
  const padded = new Int16Array(voice.length + RATE * 0.8);
  padded.set(voice);
  speaking = true;
  const start = Date.now();
  for (let i = 0; i * FRAME_SAMPLES < padded.length; i += 1) {
    if (streamId !== id || ended) return;
    const frame = padded.slice(i * FRAME_SAMPLES, (i + 1) * FRAME_SAMPLES);
    socket.emit("stream:audio", { streamId: id, seq: seq++, pcm: frame.buffer });
    const next = start + (i + 1) * 100;
    await wait(Math.max(0, next - Date.now()));
  }
  speaking = false;
  if (!CONTINUOUS) socket.emit("stream:pause", { streamId: id });
}
let seq = 0;
let speaking = false;

/** --continuous: 말하지 않는 동안에도 100ms 마다 마이크 잡음 수준(약 -66dBFS)의 조각을 보낸다 */
function noiseFrame(): ArrayBuffer {
  const frame = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i += 1) frame[i] = Math.round((Math.random() * 2 - 1) * 16);
  return frame.buffer;
}
if (CONTINUOUS && streamId) {
  const id = streamId;
  log("말 사이에도 잡음을 계속 보냅니다 (--continuous)");
  const timer = setInterval(() => {
    if (streamId !== id || ended) return clearInterval(timer);
    if (!speaking) socket.emit("stream:audio", { streamId: id, seq: seq++, pcm: noiseFrame() });
  }, 100);
}

async function speakUtterance() {
  const form = new FormData();
  form.append("clientMessageId", `peer-${Date.now()}`);
  form.append("audio", new Blob([readFileSync(wavFile)], { type: "audio/wav" }), "utterance.wav");
  await api("POST", `/sessions/${sessionId}/utterances`, form);
}

if (LISTEN_ONLY) log("듣기만 합니다 (Ctrl+C 로 끊기)");
for (let n = 1; !LISTEN_ONLY && !ended && (COUNT === 0 || n <= COUNT); n += 1) {
  await wait(n === 1 ? 2000 : EVERY_MS);
  if (ended) break;
  log(`▶ 말하기 ${n}: "${text}" (${(voice.length / RATE).toFixed(1)}초, ${streamId ? "스트리밍" : "문장 단위"})`);
  try {
    if (streamId) await speakStream(streamId);
    else await speakUtterance();
  } catch (error) {
    log(`보내기 실패: ${(error as Error).message}`);
  }
}
while (!ended) await wait(500);
log("통화가 끝났습니다");
await quit();
