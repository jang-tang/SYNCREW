import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import type { LiveSession, MessageView } from "../../src/shared/api";
import type { ServerToClientEvents, StreamOpenResult } from "../../src/shared/realtime";
import { FakeStreamEngine, type FakeStreamOptions } from "../../src/streaming/fakeStream";
import type { StreamHubOptions } from "../../src/streaming/streamHub";
import type { StreamAudioFilter, StreamFilterContext } from "../../src/engine/audio/streamAudioFilter";
import { createRealtimeTestApp, nextEvent, noEvent, type RtClient } from "../helpers/testApp";

// Phase 7 S1: 1:1 통화 스트리밍 통역 — 서버 경로 (가짜 스트리밍 엔진, 실제 Postgres·Socket.IO, 비용 0)
// docs/streaming-plan.md 3·4·8절. "받지 않아야 함" 확인은 같은 상황에서 받는 대조군과 함께 쓴다.

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

const RATE = 16_000;
const FRAME = (RATE / 10) * 2; // 100ms PCM16

/** 100ms 말소리(톤) 조각 */
function speechFrame(): Buffer {
  const buffer = Buffer.alloc(FRAME);
  for (let i = 0; i < FRAME / 2; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000), i * 2);
  return buffer;
}
const silenceFrame = () => Buffer.alloc(FRAME);

/** 조건에 맞는 이벤트가 올 때까지 기다린다 */
function waitFor<E extends keyof ServerToClientEvents>(socket: RtClient, event: E, predicate: (payload: Payload<E>) => boolean = () => true, timeoutMs = 4000) {
  return new Promise<Payload<E>>((resolve, reject) => {
    const handler = (payload: Payload<E>) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event as never, handler as never);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event as never, handler as never);
      reject(new Error(`조건에 맞는 ${event} 를 받지 못함`));
    }, timeoutMs);
    socket.on(event as never, handler as never);
  });
}

/** 한 턴 동안 듣는 사람이 받은 스트림 이벤트를 모은다 (end 까지) */
function collectTurn(socket: RtClient, timeoutMs = 4000) {
  const got = { start: null as Payload<"stream:out:start"> | null, audio: [] as Payload<"stream:out:audio">[], text: [] as Payload<"stream:out:text">[] };
  const onStart = (p: Payload<"stream:out:start">) => (got.start = p);
  const onAudio = (p: Payload<"stream:out:audio">) => got.audio.push(p);
  const onText = (p: Payload<"stream:out:text">) => got.text.push(p);
  socket.on("stream:out:start", onStart);
  socket.on("stream:out:audio", onAudio);
  socket.on("stream:out:text", onText);
  return waitFor(socket, "stream:out:end", () => true, timeoutMs).then((end) => {
    socket.off("stream:out:start", onStart);
    socket.off("stream:out:audio", onAudio);
    socket.off("stream:out:text", onText);
    return { ...got, end };
  });
}

const open = (socket: RtClient, sessionId: string, sampleRate: 16000 | 24000 = RATE) =>
  new Promise<StreamOpenResult>((resolve) =>
    socket.emit("stream:open", { sessionId, format: { encoding: "pcm16", sampleRate, channels: 1 } }, resolve),
  );

/** 말소리 seconds 초 + 무음 0.7초 (엔진 말 끝 판단 500ms 보다 길게) 를 순서대로 보낸다 */
function speak(socket: RtClient, streamId: string, seconds: number, startSeq = 0, trailingSilence = 7): number {
  let seq = startSeq;
  for (let i = 0; i < Math.round(seconds * 10); i++) socket.emit("stream:audio", { streamId, seq: seq++, pcm: speechFrame() as never });
  for (let i = 0; i < trailingSilence; i++) socket.emit("stream:audio", { streamId, seq: seq++, pcm: silenceFrame() as never });
  return seq;
}

async function createApp(engineOptions: FakeStreamOptions = {}, stream: Partial<StreamHubOptions> = {}, streamAudioFilter?: StreamAudioFilter) {
  const engine = new FakeStreamEngine({ firstChunkDelayMs: 20, ...engineOptions });
  const app = await createRealtimeTestApp({
    stt: new FakeStt(),
    translator: new FakeTranslator(),
    streamEngine: engine,
    stream,
    sessions: { ringTimeoutMs: 5000, disconnectGraceMs: 500 },
    ...(streamAudioFilter ? { streamAudioFilter } : {}),
  });
  return { app, engine };
}

/** 관리자(ko) + 구성원들, 모두 실시간 연결 */
async function setupSite(t: RtApp, workerLangs: string[]) {
  const manager = await (await t.user("김반장", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "스트리밍 현장" })).body.id as string;
  const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
  const workers = [];
  for (const [index, lang] of workerLangs.entries()) {
    const worker = await (await t.user(`작업자${index + 1}`, lang)).withProfile();
    await worker.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
    workers.push(worker);
  }
  const managerSocket = await t.connected(manager.token);
  const workerSockets = await Promise.all(workers.map((w) => t.connected(w.token)));
  return { manager, siteId, workers, managerSocket, workerSockets };
}

/** 관리자 → 첫 구성원 통화 걸고 받기 */
async function connectCall(env: Awaited<ReturnType<typeof setupSite>>, accept = true): Promise<LiveSession> {
  const { manager, siteId, workers, workerSockets, managerSocket } = env;
  const invited = nextEvent(workerSockets[0]!, "session:invite");
  const session = (await manager.as("post", `/sites/${siteId}/calls`).send({ userId: workers[0]!.id })).body as LiveSession;
  await invited;
  if (!accept) return session;
  const active = waitFor(managerSocket, "session:updated", ({ session: s }) => s.id === session.id && s.status === "active");
  await workers[0]!.as("post", `/sessions/${session.id}/accept`);
  await active;
  return session;
}

const streamIdOf = (result: StreamOpenResult) => {
  if (!result.ok) throw new Error(`스트림 열기 실패: ${result.code}`);
  return result.streamId;
};

describe("스트리밍 통역 — 기본 흐름", () => {
  let t: RtApp;
  let engine: FakeStreamEngine;
  beforeAll(async () => {
    ({ app: t, engine } = await createApp({}, { maxStreams: 100 }));
  });
  afterAll(async () => {
    await t.close();
  });

  it("말하는 동안 보낸 조각 → 상대에게 시작·음성·자막·끝 + 기록 저장, 반대 방향도 (말한 사람은 자기 통역을 받지 않음)", async () => {
    const env = await setupSite(t, ["vi"]);
    const session = await connectCall(env);
    const [worker] = env.workers;
    const [workerSocket] = env.workerSockets;

    const opened = await open(env.managerSocket, session.id);
    expect(opened).toMatchObject({ ok: true, outputSampleRate: 24_000 });
    const streamId = streamIdOf(opened);

    const turn = collectTurn(workerSocket!);
    const newMessage = waitFor(workerSocket!, "message:new", ({ message }) => message.sessionId === session.id);
    const status = waitFor(env.managerSocket, "message:status", (p) => p.status === "done");
    const speakerQuiet = noEvent(env.managerSocket, "stream:out:start", 600); // 대조군: 듣는 사람은 받음
    speak(env.managerSocket, streamId, 1.0);
    const got = await turn;
    await speakerQuiet;

    expect(got.start).toMatchObject({ sessionId: session.id, fromUserId: env.manager.id, lang: "vi", sampleRate: 24_000 });
    expect(got.audio.length).toBeGreaterThan(5);
    expect(got.audio.map((a) => a.seq)).toEqual(got.audio.map((_, i) => i));
    expect(got.audio.every((a) => a.turnId === got.start!.turnId && Buffer.from(a.pcm as never).length > 0)).toBe(true);
    const translation = got.text.filter((x) => x.kind === "translation").map((x) => x.text).join("");
    expect(translation).toBe("[vi] [음성 ko] 1.0s");
    expect(got.text.find((x) => x.kind === "original")?.text).toBe("[음성 ko] 1.0s");
    expect(got.end).toMatchObject({ turnId: got.start!.turnId, status: "done" });
    expect(got.end.messageId).toBeTruthy();

    // 기록: 발화 단위 방식과 같은 형식 (받는 사람 message:new, 말한 사람 message:status)
    const message = (await newMessage).message as MessageView;
    expect(message).toMatchObject({ id: got.end.messageId, kind: "direct", text: "[vi] [음성 ko] 1.0s", originalText: "[음성 ko] 1.0s", sessionId: session.id });
    expect(message.audioUrl).toBeTruthy();
    expect((await status).messageId).toBe(got.end.messageId);
    const history = await worker!.as("get", `/sessions/${session.id}/messages`);
    expect(history.body.map((m: MessageView) => m.id)).toContain(got.end.messageId);
    const row = await t.context.prisma.message.findUniqueOrThrow({ where: { id: got.end.messageId! }, include: { translations: true, recipients: true } });
    expect(row).toMatchObject({ status: "done", inputType: "audio", sourceLang: "ko" });
    expect(row.inputAudioPath).toBeTruthy();
    expect(row.translations[0]).toMatchObject({ targetLang: "vi", status: "done", model: "fake-stream" });
    expect(row.recipients[0]).toMatchObject({ userId: worker!.id, status: "sent" });

    // 반대 방향: 구성원(vi) → 관리자(ko)
    const back = streamIdOf(await open(workerSocket!, session.id));
    const reverse = collectTurn(env.managerSocket);
    speak(workerSocket!, back, 0.5);
    const r = await reverse;
    expect(r.start).toMatchObject({ fromUserId: worker!.id, lang: "ko" });
    expect(r.end.status).toBe("done");
    expect(engine.connections.slice(-2).map((c) => `${c.sourceLang}→${c.targetLang}`)).toEqual(["ko→vi", "vi→ko"]);
  });

  it("듣는 사람은 stream:out:end(messageId) 를 같은 문장의 message:new 보다 먼저 받는다 (앱의 중복 재생 방지 전제)", async () => {
    const env = await setupSite(t, ["vi"]);
    const session = await connectCall(env);
    const streamId = streamIdOf(await open(env.managerSocket, session.id));
    const order: string[] = [];
    const socket = env.workerSockets[0]!;
    const onEnd = (p: Payload<"stream:out:end">) => order.push(`end:${p.messageId}`);
    const onNew = (p: Payload<"message:new">) => order.push(`new:${p.message.id}`);
    socket.on("stream:out:end", onEnd);
    socket.on("message:new", onNew);
    const received = waitFor(socket, "message:new", ({ message }) => message.sessionId === session.id);
    speak(env.managerSocket, streamId, 0.4);
    const { message } = await received;
    socket.off("stream:out:end", onEnd);
    socket.off("message:new", onNew);
    expect(order).toEqual([`end:${message.id}`, `new:${message.id}`]);
  });

  it("직전 1–2턴을 텍스트 문맥으로 엔진에 넘긴다 (P3)", async () => {
    const env = await setupSite(t, ["zh"]);
    const session = await connectCall(env);
    const streamId = streamIdOf(await open(env.managerSocket, session.id));
    const record = engine.connections.at(-1)!;
    let seq = 0;
    for (const seconds of [0.3, 0.4, 0.5]) {
      const turn = collectTurn(env.workerSockets[0]!);
      seq = speak(env.managerSocket, streamId, seconds, seq);
      await turn;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(record.contexts.map((c) => c.length)).toEqual([1, 2, 2]);
    expect(record.contexts.at(-1)!.map((c) => c.original)).toEqual(["[음성 ko] 0.4s", "[음성 ko] 0.5s"]);
    expect(record.contexts.at(-1)![1]!.translation).toBe("[zh] [음성 ko] 0.5s");
  });

  it("단말이 말 끝을 알리면(stream:pause) 엔진 무음 판단을 기다리지 않고 턴을 확정한다", async () => {
    const env = await setupSite(t, ["ru"]);
    const session = await connectCall(env);
    const streamId = streamIdOf(await open(env.managerSocket, session.id));
    const turn = collectTurn(env.workerSockets[0]!);
    speak(env.managerSocket, streamId, 0.6, 0, 0);
    env.managerSocket.emit("stream:pause", { streamId });
    expect((await turn).end.status).toBe("done");
    expect(engine.connections.at(-1)!.commits).toBe(1);
  });

  it("권한: 비참여자 NOT_FOUND, 울리는 중 CONFLICT, 일괄 지시 UNSUPPORTED, 형식 오류 VALIDATION_ERROR", async () => {
    const env = await setupSite(t, ["vi", "ko"]);
    const ringing = await connectCall(env, false);
    expect(await open(env.managerSocket, ringing.id)).toEqual({ ok: false, code: "CONFLICT" });
    await env.manager.as("post", `/sessions/${ringing.id}/end`);

    const session = await connectCall(env);
    const outsider = await (await t.user("외부인", "vi")).withProfile();
    const outsiderSocket = await t.connected(outsider.token);
    expect(await open(outsiderSocket, session.id)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await open(env.workerSockets[1]!, session.id)).toEqual({ ok: false, code: "NOT_FOUND" }); // 같은 현장, 통화 비참여자
    expect(await open(env.managerSocket, session.id)).toMatchObject({ ok: true, mode: "interpret" }); // 대조군: 참여자는 열림

    const invalid = await new Promise<StreamOpenResult>((resolve) =>
      env.managerSocket.emit("stream:open", { sessionId: session.id, format: { encoding: "pcm16", sampleRate: 44100 as never, channels: 1 } }, resolve),
    );
    expect(invalid).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    await env.manager.as("post", `/sessions/${session.id}/end`);

    // 일괄 지시는 발화 단위 방식 유지
    const broadcast = (await env.manager.as("post", `/sites/${env.siteId}/broadcasts`).send({ target: "all" })).body as LiveSession;
    expect(await open(env.managerSocket, broadcast.id)).toEqual({ ok: false, code: "UNSUPPORTED" });
    await env.manager.as("post", `/sessions/${broadcast.id}/end`);
  });

  it("같은 언어(ko ↔ ko) 통화: OpenAI 없이 받은 음성 그대로 상대에게 전달, 자막·기록 없음, pause 로 턴 끝", async () => {
    const env = await setupSite(t, ["ko"]);
    const session = await connectCall(env);
    const before = engine.connections.length;
    const opened = await open(env.managerSocket, session.id);
    expect(opened).toMatchObject({ ok: true, mode: "relay", outputSampleRate: 16_000 });
    const streamId = streamIdOf(opened);
    expect(engine.connections.length).toBe(before); // 엔진(OpenAI) 연결을 만들지 않는다

    const turn = collectTurn(env.workerSockets[0]!);
    const noRecord = noEvent(env.workerSockets[0]!, "message:new", 600);
    const frames = [speechFrame(), speechFrame(), speechFrame()];
    frames.forEach((pcm, seq) => env.managerSocket.emit("stream:audio", { streamId, seq, pcm: pcm as never }));
    env.managerSocket.emit("stream:pause", { streamId });
    const got = await turn;
    await noRecord;
    expect(got.start).toMatchObject({ fromUserId: env.manager.id, lang: "ko", sampleRate: 16_000 });
    expect(got.audio.map((a) => a.seq)).toEqual([0, 1, 2]);
    expect(Buffer.from(got.audio[0]!.pcm as never).equals(frames[0]!)).toBe(true); // 받은 그대로
    expect(got.text).toEqual([]);
    expect(got.end).toMatchObject({ turnId: got.start!.turnId, status: "done", messageId: null });

    // pause 없이 조각이 끊기면(1초) 턴 끝
    const idle = collectTurn(env.workerSockets[0]!, 3000);
    env.managerSocket.emit("stream:audio", { streamId, seq: 3, pcm: speechFrame() as never });
    expect((await idle).end.status).toBe("done");
  });

  it("다른 사람의 스트림에 보낸 음성·이미 받은 순번은 무시하고, 빠진 순번은 기록에 남긴다", async () => {
    const env = await setupSite(t, ["vi"]);
    const session = await connectCall(env);
    const streamId = streamIdOf(await open(env.managerSocket, session.id));
    const record = engine.connections.at(-1)!;

    env.workerSockets[0]!.emit("stream:audio", { streamId, seq: 0, pcm: speechFrame() as never });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(record.appendedBytes).toBe(0);
    env.managerSocket.emit("stream:audio", { streamId, seq: 0, pcm: speechFrame() as never }); // 대조군
    env.managerSocket.emit("stream:audio", { streamId, seq: 0, pcm: speechFrame() as never }); // 중복
    await new Promise((resolve) => setTimeout(resolve, 150));
    // 16k → 24k: 첫 조각은 2399표본 (경계 표본은 다음 조각과 이어서 보간)
    expect(record.appendedBytes).toBe(2399 * 2);

    const turn = collectTurn(env.workerSockets[0]!);
    speak(env.managerSocket, streamId, 0.5, 4); // 1–3 빠짐
    const { end } = await turn;
    const row = await t.context.prisma.message.findUniqueOrThrow({ where: { id: end.messageId! } });
    expect((row.timings as Record<string, number>)["inputGaps"]).toBe(3);
  });

  it("통화가 끝나면 스트림이 닫히고(엔진 연결 종료) 이후 음성은 무시된다", async () => {
    const env = await setupSite(t, ["vi"]);
    const session = await connectCall(env);
    const streamId = streamIdOf(await open(env.managerSocket, session.id));
    const record = engine.connections.at(-1)!;
    const before = collectTurn(env.workerSockets[0]!);
    let seq = speak(env.managerSocket, streamId, 0.3);
    expect((await before).end.status).toBe("done"); // 대조군

    await env.manager.as("post", `/sessions/${session.id}/end`);
    expect(record.closed).toBe(true);
    const quiet = noEvent(env.workerSockets[0]!, "stream:out:start", 500);
    seq = speak(env.managerSocket, streamId, 0.3, seq);
    await quiet;
    expect(t.context.streams!.close(env.manager.id, streamId)).toBe(false); // 이미 닫힘
  });

  it("실시간 연결이 끊기면 그 연결의 스트림을 닫고, 다시 연결해 새로 열 수 있다", async () => {
    const env = await setupSite(t, ["vi"]);
    const session = await connectCall(env);
    streamIdOf(await open(env.managerSocket, session.id));
    const record = engine.connections.at(-1)!;
    env.managerSocket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(record.closed).toBe(true);

    const again = await t.connected(env.manager.token);
    const streamId = streamIdOf(await open(again, session.id));
    const turn = collectTurn(env.workerSockets[0]!);
    speak(again, streamId, 0.3);
    expect((await turn).end.status).toBe("done");
  });

  it("같은 사람이 같은 통화에서 다시 열면 이전 스트림을 닫는다", async () => {
    const env = await setupSite(t, ["vi"]);
    const session = await connectCall(env);
    const first = streamIdOf(await open(env.managerSocket, session.id));
    const firstRecord = engine.connections.at(-1)!;
    const second = streamIdOf(await open(env.managerSocket, session.id));
    expect(second).not.toBe(first);
    expect(firstRecord.closed).toBe(true);
    expect(engine.connections.at(-1)!.closed).toBe(false);
  });
});

describe("스트리밍 통역 — 엔진 장애·비용 한도·상한 (P6)", () => {
  it("엔진이 응답 도중 끊기면 그 턴은 실패, 다시 연결해 다음 턴은 성공한다", async () => {
    const { app: t, engine } = await createApp({ dropOnTurn: (turn, connection) => turn === 1 && connection === 1 });
    try {
      const env = await setupSite(t, ["vi"]);
      const session = await connectCall(env);
      const streamId = streamIdOf(await open(env.managerSocket, session.id));
      const failed = collectTurn(env.workerSockets[0]!);
      let seq = speak(env.managerSocket, streamId, 0.4);
      expect((await failed).end).toMatchObject({ status: "failed", messageId: null });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(engine.connections).toHaveLength(2);

      const ok = collectTurn(env.workerSockets[0]!);
      const noFallback = noEvent(env.managerSocket, "stream:fallback", 600);
      seq = speak(env.managerSocket, streamId, 0.4, seq);
      expect((await ok).end.status).toBe("done");
      await noFallback;
    } finally {
      await t.close();
    }
  });

  it("짧은 시간에 두 번 끊기면 말한 사람에게 stream:fallback(ENGINE_FAILED) → 발화 단위 방식", async () => {
    const { app: t } = await createApp({ dropOnTurn: (turn) => turn === 1 });
    try {
      const env = await setupSite(t, ["vi"]);
      const session = await connectCall(env);
      const streamId = streamIdOf(await open(env.managerSocket, session.id));
      let seq = speak(env.managerSocket, streamId, 0.3);
      await waitFor(env.workerSockets[0]!, "stream:out:end");
      await new Promise((resolve) => setTimeout(resolve, 100));
      const fallback = waitFor(env.managerSocket, "stream:fallback");
      seq = speak(env.managerSocket, streamId, 0.3, seq);
      expect(await fallback).toMatchObject({ sessionId: session.id, streamId, reason: "ENGINE_FAILED" });
      expect(t.context.streams!.size).toBe(0);
      // 폴백 뒤에도 통화는 계속되고 발화 단위 방식 발화는 된다 (세션 active)
      const view = await env.manager.as("get", `/sessions/${session.id}`);
      expect(view.body.status).toBe("active");
    } finally {
      await t.close();
    }
  });

  it("비용 한도에 닿으면 그 턴 실패 + stream:fallback(BUDGET_EXCEEDED)", async () => {
    const { app: t } = await createApp({ budgetOnTurn: (turn) => turn === 1 });
    try {
      const env = await setupSite(t, ["vi"]);
      const session = await connectCall(env);
      const streamId = streamIdOf(await open(env.managerSocket, session.id));
      const fallback = waitFor(env.managerSocket, "stream:fallback");
      const end = waitFor(env.workerSockets[0]!, "stream:out:end");
      speak(env.managerSocket, streamId, 0.3);
      expect(await fallback).toMatchObject({ reason: "BUDGET_EXCEEDED" });
      expect(await end).toMatchObject({ status: "failed" });
    } finally {
      await t.close();
    }
  });

  it("엔진을 열 수 없으면 ENGINE_UNAVAILABLE, 동시 상한을 넘으면 BUSY", async () => {
    const { app: t } = await createApp({ failOpen: (attempt) => attempt === 1 }, { maxStreams: 1 });
    try {
      const env = await setupSite(t, ["vi", "zh"]);
      const session = await connectCall(env);
      expect(await open(env.managerSocket, session.id)).toEqual({ ok: false, code: "ENGINE_UNAVAILABLE" });
      expect(await open(env.managerSocket, session.id)).toMatchObject({ ok: true }); // 두 번째 열기는 성공
      expect(await open(env.workerSockets[0]!, session.id)).toEqual({ ok: false, code: "BUSY" }); // 상한 1
    } finally {
      await t.close();
    }
  });

  it("스트리밍 엔진이 없으면(키 없음) 통역 통화는 ENGINE_UNAVAILABLE, 같은 언어 직접 전달은 된다", async () => {
    const t = await createRealtimeTestApp({ stt: new FakeStt(), translator: new FakeTranslator(), streamEngine: null });
    try {
      const env = await setupSite(t, ["vi", "ko"]);
      const session = await connectCall(env);
      expect(await open(env.managerSocket, session.id)).toEqual({ ok: false, code: "ENGINE_UNAVAILABLE" });
      await env.manager.as("post", `/sessions/${session.id}/end`);
      const same = (await env.manager.as("post", `/sites/${env.siteId}/calls`).send({ userId: env.workers[1]!.id })).body as LiveSession;
      await env.workers[1]!.as("post", `/sessions/${same.id}/accept`);
      expect(await open(env.managerSocket, same.id)).toMatchObject({ ok: true, mode: "relay" });
    } finally {
      await t.close();
    }
  });
});

describe("스트리밍 통역 — 서버 노이즈 필터 (조각 단위, 2026-10-14)", () => {
  /** 시험용 필터: 받은 조각 수·정보를 기록하고 mode 에 따라 동작 */
  function testFilter(mode: "invert" | "mute" | "throw" | "slow") {
    const record = { calls: 0, contexts: [] as StreamFilterContext[], lengths: [] as number[], closed: 0 };
    const filter: StreamAudioFilter = {
      name: `test-${mode}`,
      open(context) {
        record.contexts.push(context);
        return {
          process(frame) {
            record.calls += 1;
            record.lengths.push(frame.length);
            if (mode === "throw") throw new Error("filter failure");
            if (mode === "mute") return new Int16Array(frame.length);
            if (mode === "slow") return new Promise((resolve) => setTimeout(() => resolve(frame), 200));
            return frame.map((v) => -v);
          },
          close: () => void (record.closed += 1),
        };
      },
    };
    return { filter, record };
  }

  it("모든 조각이 필터를 거친다 (언어·16kHz 정보 전달, 같은 길이), 통화가 끝나면 필터를 닫는다", async () => {
    const { filter, record } = testFilter("invert");
    const { app: t } = await createApp({}, {}, filter);
    try {
      const env = await setupSite(t, ["vi"]);
      const session = await connectCall(env);
      const streamId = streamIdOf(await open(env.managerSocket, session.id));
      const turn = collectTurn(env.workerSockets[0]!);
      const sent = speak(env.managerSocket, streamId, 0.5);
      expect((await turn).end.status).toBe("done");
      expect(record.contexts).toEqual([expect.objectContaining({ lang: "ko", sampleRate: 16_000, siteId: env.siteId, userId: env.manager.id })]);
      expect(record.calls).toBeGreaterThanOrEqual(sent - 2);
      expect(new Set(record.lengths)).toEqual(new Set([FRAME / 2]));
      await env.manager.as("post", `/sessions/${session.id}/end`);
      expect(record.closed).toBe(1);
    } finally {
      await t.close();
    }
  });

  it("필터 결과가 실제로 쓰인다: 소리를 지우는 필터면 말이 감지되지 않는다 (대조군: 위 반전 필터는 턴 생성)", async () => {
    const { filter } = testFilter("mute");
    const { app: t, engine } = await createApp({}, {}, filter);
    try {
      const env = await setupSite(t, ["vi"]);
      const session = await connectCall(env);
      const streamId = streamIdOf(await open(env.managerSocket, session.id));
      const quiet = noEvent(env.workerSockets[0]!, "stream:out:start", 1200);
      speak(env.managerSocket, streamId, 0.5);
      await quiet;
      expect(engine.connections.at(-1)!.appendedBytes).toBeGreaterThan(0); // 조각은 엔진까지 갔다 (무음으로)
    } finally {
      await t.close();
    }
  });

  it("필터가 오류를 내면 원본 조각으로 통역을 계속하고, 연속 5번 실패하면 그 통화에서 필터를 끈다", async () => {
    const { filter, record } = testFilter("throw");
    const { app: t } = await createApp({}, {}, filter);
    try {
      const env = await setupSite(t, ["vi"]);
      const session = await connectCall(env);
      const streamId = streamIdOf(await open(env.managerSocket, session.id));
      const turn = collectTurn(env.workerSockets[0]!);
      speak(env.managerSocket, streamId, 0.5);
      expect((await turn).end.status).toBe("done");
      expect(record.calls).toBe(5);
      expect(record.closed).toBe(1);
    } finally {
      await t.close();
    }
  });

  it("필터가 조각당 시간 제한(50ms)을 넘기면 원본 조각을 쓴다 (통역은 계속)", async () => {
    const { filter, record } = testFilter("slow");
    const { app: t } = await createApp({}, {}, filter);
    try {
      const env = await setupSite(t, ["vi"]);
      const session = await connectCall(env);
      const streamId = streamIdOf(await open(env.managerSocket, session.id));
      const turn = collectTurn(env.workerSockets[0]!, 6000);
      speak(env.managerSocket, streamId, 0.3);
      expect((await turn).end.status).toBe("done");
      expect(record.calls).toBe(5); // 5번 연속 시간 초과 → 끔
    } finally {
      await t.close();
    }
  });
});

