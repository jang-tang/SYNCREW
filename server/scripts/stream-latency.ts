// 스트리밍 통역 네트워크·서버 경로 측정 도구 (비용 0, OpenAI 없음 — docs/perf-network-2026-10-20.md)
//
// 서버 프로세스(이 스크립트) 안에 임시 Postgres + 서버(가짜 스트리밍 엔진) 를 띄우고, 자식 프로세스가 "휴대폰" 역할로
// 통화 쌍(말하는 사람·듣는 사람) N개를 만들어 100ms PCM 조각을 실시간 속도로 보낸다. 재는 것:
//   (a) 서버 안: stream:audio 수신(socket 미들웨어) → 엔진 append 까지 (필터·표본률 변환·메아리 판단 경로)
//   (b) 서버 → 듣는 사람: 엔진이 조각을 낸 시각 → 앱이 stream:out:audio 를 받은 시각, 조각 도착 간격 흔들림(지터)
//   (c) 서버 CPU: process.cpuUsage 로 측정 구간의 CPU 시간, 입력 조각 1개당 µs
//   (d) 말 끝(마지막 말소리 조각 보낸 시각) → 듣는 사람의 stream:out:start (엔진 무음 판단 500ms 포함)
// 서버·자식이 같은 PC 에 있어 시계가 같다 (performance.timeOrigin + performance.now()).
//
// 사용 (server 폴더에서):
//   npx tsx scripts/stream-latency.ts                       # 통화 4쌍, 30초, 100ms 조각
//   npx tsx scripts/stream-latency.ts --pairs 4 --seconds 30 --frame-ms 60 --json out.json
//   node --cpu-prof --cpu-prof-dir=/tmp/prof --import tsx scripts/stream-latency.ts   # 서버 CPU 프로파일
//   옵션: --db postgresql://… (임시 Postgres 대신 기존 DB), --log-level info, --filter passthrough|sidecar
//         --port 4100 (서버 포트 고정) --via http://127.0.0.1:8080 (자식이 접속할 주소 — 리버스 프록시(Caddy) 경유 측정)
//         --drop-test: 통화 1쌍을 열고 자식을 SIGSTOP 으로 얼려(무선 끊김처럼 ping 에 응답 못함) 서버가 연결 끊김을
//                      알아채기까지 걸린 시간을 잰다 (Socket.IO pingInterval + pingTimeout)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../src/app";
import { createJwtVerifier } from "../src/auth/verifier";
import { createContext } from "../src/bootstrap";
import { loadEnv } from "../src/config/env";
import { FakeStt, FakeTranslator } from "../src/engine/fake";
import { createLogger } from "../src/lib/logger";
import { attachRealtime } from "../src/realtime/gateway";
import type { LiveSession } from "../src/shared/api";
import { REALTIME_NAMESPACE, type ClientToServerEvents, type ServerToClientEvents } from "../src/shared/realtime";
import type { StreamConnection, StreamEngine, StreamOpenOptions } from "../src/streaming/engine";
import { FakeStreamEngine } from "../src/streaming/fakeStream";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const now = () => performance.timeOrigin + performance.now();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RATE = 16_000;
const SPEECH_MS = 2_000;
const SILENCE_MS = 1_000;
/** 가짜 엔진 말 끝 무음 판단 (서버 기본 STREAM_VAD_SILENCE_MS 와 같게) */
const VAD_SILENCE_MS = 500;

type Pair = { sessionId: string; speakerToken: string; listenerToken: string };
type ClientConfig = { url: string; api: string; pairs: Pair[]; seconds: number; frameMs: number };
type SentFrame = { seq: number; t: number; speech: boolean };
type ClientTurn = { turnId: string; startAt: number; audio: number[]; endAt: number | null };
type ClientPairResult = {
  sent: SentFrame[];
  /** 말 한 토막의 마지막 말소리 조각을 보낸 시각 */
  speechEnds: number[];
  turns: ClientTurn[];
  gaps: number;
};
type ClientResult = { pairs: ClientPairResult[]; cpuMs: number; elapsedMs: number };

// ─── 통계 ─────────────────────────────────────────
function stats(values: number[]) {
  if (values.length === 0) return { n: 0, p50: NaN, p95: NaN, max: NaN, mean: NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return { n: sorted.length, p50: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1]!, mean: values.reduce((a, b) => a + b, 0) / values.length };
}
const fmt = (s: ReturnType<typeof stats>, unit = "ms", digits = 2) =>
  s.n === 0 ? "(없음)" : `n=${s.n} P50 ${s.p50.toFixed(digits)} P95 ${s.p95.toFixed(digits)} 최대 ${s.max.toFixed(digits)} ${unit}`;

// ═══════════════════════════════════════════════════
// 자식 프로세스: 휴대폰 역할 (통화 쌍마다 말하는 사람·듣는 사람 소켓)
// ═══════════════════════════════════════════════════
async function runClient(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const config = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ClientConfig;
  const frameSamples = Math.round((RATE * config.frameMs) / 1000);
  const speechFrame = (phase: number) => {
    const buffer = new ArrayBuffer(frameSamples * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < frameSamples; i++) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * (phase + i)) / RATE) * 8000), true);
    return buffer;
  };
  const silenceFrame = () => new ArrayBuffer(frameSamples * 2);

  type Rt = Socket<ServerToClientEvents, ClientToServerEvents>;
  const connect = (token: string) =>
    new Promise<Rt>((resolve, reject) => {
      const socket: Rt = io(config.url, { transports: ["websocket"], auth: { token }, reconnection: false, forceNew: true });
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });

  const cpu0 = process.cpuUsage();
  const t0 = now();
  const results: ClientPairResult[] = [];
  const sockets: Rt[] = [];
  const senders: Promise<void>[] = [];

  for (const pair of config.pairs) {
    const speaker = await connect(pair.speakerToken);
    const listener = await connect(pair.listenerToken);
    sockets.push(speaker, listener);
    const result: ClientPairResult = { sent: [], speechEnds: [], turns: [], gaps: 0 };
    results.push(result);
    const turns = new Map<string, ClientTurn>();
    listener.on("stream:out:start", (p) => {
      const turn = { turnId: p.turnId, startAt: now(), audio: [], endAt: null };
      turns.set(p.turnId, turn);
      result.turns.push(turn);
    });
    listener.on("stream:out:audio", (p) => turns.get(p.turnId)?.audio.push(now()));
    listener.on("stream:out:end", (p) => {
      const turn = turns.get(p.turnId);
      if (turn) turn.endAt = now();
    });
    const opened = await speaker.timeout(15_000).emitWithAck("stream:open", { sessionId: pair.sessionId, format: { encoding: "pcm16", sampleRate: 16000, channels: 1 } });
    if (!opened.ok) throw new Error(`stream:open 실패: ${opened.code}`);
    const streamId = opened.streamId;

    // 말 2초 + 무음 1초 반복, 조각을 실시간 속도로 (절대 시각 기준, 앱의 캡처 주기처럼)
    senders.push(
      (async () => {
        const start = now() + 200;
        const total = Math.floor((config.seconds * 1000) / config.frameMs);
        const period = SPEECH_MS + SILENCE_MS;
        let phase = 0;
        for (let i = 0; i < total; i++) {
          const due = start + i * config.frameMs;
          const delay = due - now();
          if (delay > 0) await wait(delay);
          const inPeriod = (i * config.frameMs) % period;
          const speech = inPeriod < SPEECH_MS;
          const pcm = speech ? speechFrame(phase) : silenceFrame();
          phase += frameSamples;
          const t = now();
          speaker.emit("stream:audio", { streamId, seq: i, pcm });
          result.sent.push({ seq: i, t, speech });
          const nextSpeech = ((i + 1) * config.frameMs) % period < SPEECH_MS;
          if (speech && (!nextSpeech || i === total - 1)) result.speechEnds.push(t);
        }
        speaker.emit("stream:pause", { streamId });
      })(),
    );
  }
  await Promise.all(senders);
  // 마지막 턴(무음 판단 + 번역 음성 2초) 이 끝날 때까지
  await wait(VAD_SILENCE_MS + SPEECH_MS + 1_000);
  const elapsedMs = now() - t0;
  const cpu = process.cpuUsage(cpu0);
  sockets.forEach((socket) => socket.disconnect());
  const output: ClientResult = { pairs: results, cpuMs: (cpu.user + cpu.system) / 1000, elapsedMs };
  process.stdout.write(JSON.stringify(output));
}

// ═══════════════════════════════════════════════════
// 서버 프로세스
// ═══════════════════════════════════════════════════

/** 가짜 엔진을 감싸 append 시각과 출력 조각 시각을 기록한다 */
type Recorded = { socketId: string | null; appends: number[]; audio: { turnId: string; t: number }[] };
function instrument(inner: StreamEngine, nextSocket: () => string | null): { engine: StreamEngine; connections: Recorded[] } {
  const connections: Recorded[] = [];
  const engine: StreamEngine = {
    name: inner.name,
    sampleRate: inner.sampleRate,
    async open(options: StreamOpenOptions): Promise<StreamConnection> {
      const record: Recorded = { socketId: nextSocket(), appends: [], audio: [] };
      connections.push(record);
      const events = { ...options.events, audio: (turnId: string, pcm: Buffer) => (record.audio.push({ turnId, t: now() }), options.events.audio(turnId, pcm)) };
      const connection = await inner.open({ ...options, events });
      // 클래스 인스턴스는 전개하면 메서드가 빠지므로 하나씩 감싼다
      return {
        append: (pcm) => (record.appends.push(now()), connection.append(pcm)),
        commit: () => connection.commit(),
        setContext: (lines) => connection.setContext(lines),
        close: () => connection.close(),
      };
    },
  };
  return { engine, connections };
}

async function runServer(): Promise<void> {
  const pairs = Number(option("pairs", "4"));
  const seconds = Number(option("seconds", "30"));
  const frameMs = Number(option("frame-ms", "100"));
  const jsonOut = option("json", "");

  // ── 임시 Postgres ──
  let databaseUrl = option("db", "");
  let pg: { stop(): Promise<void> } | null = null;
  let databaseDir: string | null = null;
  if (!databaseUrl) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    databaseDir = mkdtempSync(path.join(tmpdir(), "syncrew-perf-pg-"));
    const instance = new EmbeddedPostgres({ databaseDir, user: "syncrew", password: "syncrew", port: 54332, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => undefined });
    await instance.initialise();
    await instance.start();
    await instance.createDatabase("syncrew_perf");
    databaseUrl = "postgresql://syncrew:syncrew@localhost:54332/syncrew_perf";
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "ignore" });
    pg = instance;
    console.error("임시 Postgres 준비 (54332)");
  }

  // ── 토큰 발급기 (test/helpers/testApp.ts 와 같은 형식) ──
  const ISSUER = "https://perf.supabase.co/auth/v1";
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "perf-key", alg: "ES256", use: "sig" };
  const verifier = createJwtVerifier({ keys: createLocalJWKSet({ keys: [jwk] }), issuer: ISSUER });
  const sign = (sub: string) =>
    new SignJWT({ email: `${sub.slice(0, 8)}@perf.dev`, role: "authenticated" }).setProtectedHeader({ alg: "ES256", kid: "perf-key" }).setSubject(sub).setIssuer(ISSUER).setAudience("authenticated").setIssuedAt().setExpirationTime("1h").sign(privateKey);

  // ── 서버 ──
  const storageDir = mkdtempSync(path.join(tmpdir(), "syncrew-perf-storage-"));
  const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl, LOG_LEVEL: option("log-level", "silent"), STORAGE_DIR: storageDir, ENGINE: "fake", STREAM_AUDIO_FILTER: option("filter", "passthrough"), DENOISE_URL: process.env.DENOISE_URL });
  let pendingSocket: string | null = null;
  const { engine, connections } = instrument(new FakeStreamEngine({ silenceMs: VAD_SILENCE_MS, firstChunkDelayMs: 50, chunkIntervalMs: 100 }), () => pendingSocket);
  const context = await createContext(env, createLogger(env.LOG_LEVEL), { verifier, stt: new FakeStt(), translator: new FakeTranslator(), streamEngine: engine, limits: { joinPerMinute: 1000, messagesPerMinute: 1000 } });
  const server = createServer(createApp(context));
  const gateway = attachRealtime(server, context, { stream: { maxStreams: 64 } });
  context.events = gateway.events;
  // stream:audio 수신 시각 (이벤트 핸들러보다 먼저 도는 소켓 미들웨어)
  const received = new Map<string, number[]>();
  const disconnects: { socketId: string; t: number; reason: string }[] = [];
  gateway.io.of(REALTIME_NAMESPACE).on("connection", (socket) => {
    socket.use((packet, next) => {
      if (packet[0] === "stream:audio") received.get(socket.id)?.push(now()) ?? received.set(socket.id, [now()]);
      else if (packet[0] === "stream:open") pendingSocket = socket.id;
      next();
    });
    socket.on("disconnect", (reason) => disconnects.push({ socketId: socket.id, t: now(), reason }));
  });
  await new Promise<void>((resolve) => server.listen(Number(option("port", "0")), "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}/api/v1`;
  const via = option("via", `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const url = `${via}${REALTIME_NAMESPACE}`;

  // ── 통화 쌍 만들기 (REST) ──
  const call = async (token: string, method: string, route: string, body?: unknown) => {
    const res = await fetch(`${api}${route}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const pairConfigs: Pair[] = [];
  const presenceSockets: Socket[] = [];
  for (let i = 0; i < pairs; i++) {
    const managerId = randomUUID();
    const workerId = randomUUID();
    const manager = await sign(managerId);
    const worker = await sign(workerId);
    await call(manager, "PUT", "/me", { displayName: `관리자${i + 1}`, preferredLang: "ko" });
    await call(worker, "PUT", "/me", { displayName: `작업자${i + 1}`, preferredLang: "vi" });
    const site = await call(manager, "POST", "/sites", { name: `측정 현장 ${i + 1}` });
    const codes = await call(manager, "GET", `/sites/${site.id}/join-codes`);
    await call(worker, "POST", "/join", { code: codes[0].code });
    await call(manager, "PATCH", `/sites/${site.id}/members/${workerId}`, { action: "approve" });
    // 통화를 걸려면 상대가 접속 중이어야 한다 → 잠깐 접속해 둔다 (자식의 소켓은 나중에 연결)
    const online = io(url, { transports: ["websocket"], auth: { token: worker }, reconnection: false, forceNew: true });
    await new Promise<void>((resolve, reject) => (online.once("connect", () => resolve()), online.once("connect_error", reject)));
    presenceSockets.push(online);
    const session = (await call(manager, "POST", `/sites/${site.id}/calls`, { userId: workerId })) as LiveSession;
    await call(worker, "POST", `/sessions/${session.id}/accept`);
    pairConfigs.push({ sessionId: session.id, speakerToken: manager, listenerToken: worker });
  }
  console.error(`통화 ${pairs}쌍 준비, ${seconds}초 동안 ${frameMs}ms 조각 전송${via.includes(String(port)) ? "" : ` (경유: ${via})`}`);

  const cleanup = async () => {
    presenceSockets.forEach((socket) => socket.disconnect());
    context.sessions.dispose();
    await gateway.close();
    await context.prisma.$disconnect();
    await pg?.stop();
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
    rmSync(storageDir, { recursive: true, force: true });
  };

  // ── 자식(휴대폰 역할) 실행 ──
  const cpu0 = process.cpuUsage();
  const wall0 = now();
  const dropTest = flag("drop-test");
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve(import.meta.dirname, "stream-latency.ts"), "--client"], { stdio: ["pipe", "pipe", "inherit"], cwd: path.resolve(import.meta.dirname, "..") });
  child.stdin.end(JSON.stringify({ url, api, pairs: pairConfigs, seconds: dropTest ? 300 : seconds, frameMs } satisfies ClientConfig));

  if (dropTest) {
    // 조각이 들어오기 시작하면 자식을 얼린다 → TCP 는 살아 있지만 ping 에 답하지 못한다 (LTE 끊김·터널과 같은 상황)
    const engineOpts = (gateway.io.engine as unknown as { opts: { pingInterval: number; pingTimeout: number } }).opts;
    while ([...received.values()].reduce((a, r) => a + r.length, 0) < 10) await wait(50);
    const frozenAt = now();
    child.kill("SIGSTOP");
    const expected = 2 * pairs;
    while (disconnects.length < expected) await wait(50);
    const detectMs = Math.max(...disconnects.map((d) => d.t)) - frozenAt;
    console.log(`\n# drop-test: pingInterval ${engineOpts.pingInterval}ms + pingTimeout ${engineOpts.pingTimeout}ms`);
    console.log(`자식을 얼린 뒤 서버가 연결 ${expected}개 끊김을 알아채기까지: ${(detectMs / 1000).toFixed(1)}초 (이유: ${[...new Set(disconnects.map((d) => d.reason))].join(", ")})`);
    child.kill("SIGKILL");
    await cleanup();
    process.exit(0);
  }
  const out: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
  const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
  const cpu = process.cpuUsage(cpu0);
  const wallMs = now() - wall0;
  if (code !== 0) throw new Error(`자식 프로세스 종료 코드 ${code}`);
  const client = JSON.parse(Buffer.concat(out).toString("utf8")) as ClientResult;

  // ── 집계 ──
  const recvToAppend: number[] = [];
  const delivery: number[] = [];
  const jitter: number[] = [];
  const speechToStart: number[] = [];
  let inputFrames = 0;
  let outputChunks = 0;
  for (const record of connections) {
    const recv = record.socketId ? (received.get(record.socketId) ?? []) : [];
    const n = Math.min(recv.length, record.appends.length);
    for (let i = 0; i < n; i++) recvToAppend.push(record.appends[i]! - recv[i]!);
    inputFrames += record.appends.length;
  }
  for (const [index, pair] of client.pairs.entries()) {
    const record = connections[index];
    for (const turn of pair.turns) {
      const emitted = record?.audio.filter((a) => a.turnId === turn.turnId) ?? [];
      const n = Math.min(emitted.length, turn.audio.length);
      for (let i = 0; i < n; i++) delivery.push(turn.audio[i]! - emitted[i]!.t);
      for (let i = 1; i < turn.audio.length; i++) jitter.push(Math.abs(turn.audio[i]! - turn.audio[i - 1]! - 100));
      outputChunks += turn.audio.length;
    }
    // 말 끝 → 그 다음에 시작된 턴
    for (const end of pair.speechEnds) {
      const next = pair.turns.find((t) => t.startAt > end && t.startAt - end < 3000);
      if (next) speechToStart.push(next.startAt - end);
    }
  }
  const cpuMs = (cpu.user + cpu.system) / 1000;
  const summary = {
    pairs,
    seconds,
    frameMs,
    filter: env.STREAM_AUDIO_FILTER,
    inputFrames,
    outputChunks,
    recvToAppend: stats(recvToAppend),
    delivery: stats(delivery),
    jitter: stats(jitter),
    speechToStart: stats(speechToStart),
    server: { cpuMs, wallMs, cpuPercent: (cpuMs / wallMs) * 100, usPerInputFrame: (cpuMs * 1000) / Math.max(1, inputFrames), usPerFrameAll: (cpuMs * 1000) / Math.max(1, inputFrames + outputChunks) },
    client: { cpuMs: client.cpuMs, cpuPercent: (client.cpuMs / client.elapsedMs) * 100 },
    turns: client.pairs.reduce((a, p) => a + p.turns.length, 0),
  };
  console.log(`\n# stream-latency: 통화 ${pairs}쌍 · ${seconds}초 · ${frameMs}ms 조각 · 필터 ${summary.filter}`);
  console.log(`입력 조각 ${inputFrames}개 (엔진 append), 출력 조각 ${outputChunks}개, 턴 ${summary.turns}개`);
  console.log(`(a) 수신 → 엔진 append      : ${fmt(summary.recvToAppend, "ms", 3)}`);
  console.log(`(b) 엔진 출력 → 앱 수신      : ${fmt(summary.delivery, "ms", 3)}`);
  console.log(`    앱 조각 도착 간격 흔들림  : ${fmt(summary.jitter, "ms", 2)} (|간격 − 100ms|)`);
  console.log(`(d) 말 끝 → stream:out:start : ${fmt(summary.speechToStart, "ms", 0)} (무음 판단 ${VAD_SILENCE_MS}ms 포함)`);
  console.log(`(c) 서버 CPU ${cpuMs.toFixed(0)}ms / ${wallMs.toFixed(0)}ms = 코어 1개의 ${summary.server.cpuPercent.toFixed(1)}% · 입력 조각당 ${summary.server.usPerInputFrame.toFixed(0)}µs · 입출력 조각당 ${summary.server.usPerFrameAll.toFixed(0)}µs`);
  console.log(`    자식(앱 역할) CPU ${client.cpuMs.toFixed(0)}ms (${summary.client.cpuPercent.toFixed(1)}%)`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(summary, null, 2));

  await cleanup();
  process.exit(0);
}

if (flag("client")) {
  runClient().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  runServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
