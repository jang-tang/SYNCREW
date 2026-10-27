import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import type { LiveSession, MessageView } from "../../src/shared/api";
import type { ServerToClientEvents, StreamOpenResult } from "../../src/shared/realtime";
import { FakeStreamEngine } from "../../src/streaming/fakeStream";
import { createRealtimeTestApp, noEvent, type RtClient } from "../helpers/testApp";

// 현장 전체 연결 (2026-10-27): 세션(들어오기·나가기·1:1 과의 관계) + 스트리밍(언어별 레인·대표 레인 기록·방 전체 반이중).
// 가짜 스트리밍 엔진, 실제 Postgres·Socket.IO, 비용 0. "받지 않아야 함" 확인은 같은 상황에서 받는 대조군과 함께 쓴다.

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

const RATE = 16_000;
const FRAME = (RATE / 10) * 2;

function speechFrame(): Buffer {
  const buffer = Buffer.alloc(FRAME);
  for (let i = 0; i < FRAME / 2; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000), i * 2);
  return buffer;
}

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

const open = (socket: RtClient, sessionId: string) =>
  new Promise<StreamOpenResult>((resolve) => socket.emit("stream:open", { sessionId, format: { encoding: "pcm16", sampleRate: RATE, channels: 1 } }, resolve));

function speak(socket: RtClient, streamId: string, seconds: number, startSeq = 0): number {
  let seq = startSeq;
  for (let i = 0; i < Math.round(seconds * 10); i++) socket.emit("stream:audio", { streamId, seq: seq++, pcm: speechFrame() as never });
  for (let i = 0; i < 7; i++) socket.emit("stream:audio", { streamId, seq: seq++, pcm: Buffer.alloc(FRAME) as never });
  return seq;
}

const streamIdOf = (result: StreamOpenResult) => {
  if (!result.ok) throw new Error(`스트림 열기 실패: ${result.code}`);
  return result.streamId;
};

async function createApp() {
  const engine = new FakeStreamEngine({ firstChunkDelayMs: 20 });
  const app = await createRealtimeTestApp({
    stt: new FakeStt(),
    translator: new FakeTranslator(),
    streamEngine: engine,
    stream: { maxStreams: 100 },
    sessions: { ringTimeoutMs: 5000, disconnectGraceMs: 300 },
  });
  return { app, engine };
}

/** 관리자(ko) + 구성원들 (모두 실시간 연결) */
async function setupSite(t: RtApp, workerLangs: string[]) {
  const manager = await (await t.user("김반장", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "전체 연결 현장" })).body.id as string;
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
  for (const socket of [managerSocket, ...workerSockets]) {
    await new Promise((resolve) => socket.emit("site:subscribe", { siteId }, resolve));
  }
  return { manager, siteId, workers, managerSocket, workerSockets };
}

const inside = (session: LiveSession) => session.participants.filter((p) => !p.leftAt).map((p) => p.userId).sort();

describe("현장 전체 연결 — 세션", () => {
  let t: RtApp;
  beforeAll(async () => {
    ({ app: t } = await createApp());
  });
  afterAll(async () => {
    await t.close();
  });

  it("누구나 열고(구성원도), 각자 눌러서 들어온다. 참여하지 않은 사람도 group:updated 로 연결 중임을 알고, 마지막 사람이 나가면 끝난다", async () => {
    const env = await setupSite(t, ["vi", "zh"]);
    const [vi, zh] = env.workers;
    expect((await env.manager.as("get", `/sites/${env.siteId}/group-call`)).body).toBeNull();

    // 구성원이 연다 → 참여하지 않은 관리자에게도 현장 알림
    const seen = waitFor(env.managerSocket, "group:updated", (p) => p.siteId === env.siteId && p.session !== null);
    const opened = (await vi!.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    expect(opened.mode).toBe("group");
    expect(opened.status).toBe("active");
    expect(inside(opened)).toEqual([vi!.id]);
    expect((await seen).session!.id).toBe(opened.id);
    // 대조군: 들어가지 않은 사람에게 session:invite 는 가지 않는다 (각자 눌러서 들어온다)
    await noEvent(env.workerSockets[1]!, "session:invite", 200);

    // 두 번째 사람은 같은 연결에 들어간다
    const joined = (await zh!.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    expect(joined.id).toBe(opened.id);
    expect(inside(joined)).toEqual([vi!.id, zh!.id].sort());
    expect(((await env.manager.as("get", `/sites/${env.siteId}/group-call`)).body as LiveSession).id).toBe(opened.id);

    // 한 사람이 나가면 그 사람만 빠진다
    const left = (await vi!.as("post", `/sessions/${opened.id}/end`)).body as LiveSession;
    expect(left.status).toBe("active");
    expect(inside(left)).toEqual([zh!.id]);
    // 다시 들어올 수 있다
    expect(inside((await vi!.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession)).toEqual([vi!.id, zh!.id].sort());
    await vi!.as("post", `/sessions/${opened.id}/end`);

    // 마지막 사람이 나가면 끝나고, 현장에 null 을 알린다
    const closed = waitFor(env.managerSocket, "group:updated", (p) => p.siteId === env.siteId && p.session === null);
    const ended = (await zh!.as("post", `/sessions/${opened.id}/end`)).body as LiveSession;
    expect(ended.status).toBe("ended");
    await closed;
    expect((await env.manager.as("get", `/sites/${env.siteId}/group-call`)).body).toBeNull();
    // 끝난 뒤 다시 누르면 새 연결이 열린다
    const again = (await zh!.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    expect(again.id).not.toBe(opened.id);
    await zh!.as("post", `/sessions/${again.id}/end`);
  });

  it("두 사람이 동시에 열어도 열린 연결은 하나다", async () => {
    const env = await setupSite(t, ["vi"]);
    const [a, b] = await Promise.all([
      env.manager.as("post", `/sites/${env.siteId}/group-call`),
      env.workers[0]!.as("post", `/sites/${env.siteId}/group-call`),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    const final = (await env.manager.as("get", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    expect(inside(final)).toEqual([env.manager.id, env.workers[0]!.id].sort());
  });

  it("1:1 과의 관계: 들어오면 내 1:1 은 끝난다 / 참여 중인 사람에게는 1:1 을 걸 수 없다(BUSY) / 참여 중에 1:1 을 걸면 전체 연결에서 나간다", async () => {
    const env = await setupSite(t, ["vi", "zh"]);
    const [vi, zh] = env.workers;
    // 관리자 ↔ vi 1:1 연결 중에 vi 가 전체 연결에 들어가면 1:1 은 끝난다
    const call = (await env.manager.as("post", `/sites/${env.siteId}/calls`).send({ userId: vi!.id, connect: true })).body as LiveSession;
    expect(call.status).toBe("active");
    const group = (await vi!.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    expect(((await env.manager.as("get", `/sessions/${call.id}`)).body as LiveSession).status).toBe("ended");

    // 참여 중인 vi 에게 1:1 을 걸면 BUSY. 대조군: 참여하지 않은 zh 에게는 걸린다
    const busy = await env.manager.as("post", `/sites/${env.siteId}/calls`).send({ userId: vi!.id, connect: true });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("BUSY");
    const toZh = (await env.manager.as("post", `/sites/${env.siteId}/calls`).send({ userId: zh!.id, connect: true })).body as LiveSession;
    expect(toZh.status).toBe("active");
    await env.manager.as("post", `/sessions/${toZh.id}/end`);

    // 참여 중인 vi 가 1:1 을 걸면 전체 연결에서 나간다 (연결은 한 번에 하나) → 혼자였으므로 전체 연결은 끝난다
    const fromVi = (await vi!.as("post", `/sites/${env.siteId}/calls`).send({ userId: zh!.id, connect: true })).body as LiveSession;
    expect(fromVi.status).toBe("active");
    expect(((await vi!.as("get", `/sessions/${group.id}`)).body as LiveSession).status).toBe("ended");
    await vi!.as("post", `/sessions/${fromVi.id}/end`);
  });

  it("실시간 연결이 끊기면 유예 뒤 그 사람만 나간다 (다른 사람은 계속)", async () => {
    const env = await setupSite(t, ["vi", "zh"]);
    const [vi, zh] = env.workers;
    const group = (await vi!.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    await zh!.as("post", `/sites/${env.siteId}/group-call`);
    const left = waitFor(env.workerSockets[1]!, "session:updated", (p) => p.session.id === group.id && inside(p.session).length === 1);
    env.workerSockets[0]!.disconnect();
    const after = await left;
    expect(after.session.status).toBe("active");
    expect(inside(after.session)).toEqual([zh!.id]);
    await zh!.as("post", `/sessions/${group.id}/end`);
  });
});

describe("현장 전체 연결 — 스트리밍", () => {
  let t: RtApp;
  let engine: FakeStreamEngine;
  beforeAll(async () => {
    ({ app: t, engine } = await createApp());
  });
  afterAll(async () => {
    await t.close();
  });

  it("한 사람이 말하면 다른 언어마다 레인 1개 — 각자 자기 언어로 받고, 같은 언어는 그대로 전달. 말한 사람 자막·기록은 한 번만", async () => {
    const env = await setupSite(t, ["vi", "zh", "ko"]);
    const [vi, zh, ko] = env.workers;
    const group = (await env.manager.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    for (const worker of [vi!, zh!, ko!]) await worker.as("post", `/sites/${env.siteId}/group-call`);

    const before = engine.connections.length;
    const result = await open(env.managerSocket, group.id);
    expect(result).toMatchObject({ ok: true, mode: "interpret" });
    // 엔진 연결은 다른 언어(vi, zh) 2개, 같은 언어(ko)는 엔진 없이 직접 전달
    expect(engine.connections.slice(before).map((c) => c.targetLang).sort()).toEqual(["vi", "zh"]);

    const viStart = waitFor(env.workerSockets[0]!, "stream:out:start", (p) => p.sessionId === group.id);
    const zhStart = waitFor(env.workerSockets[1]!, "stream:out:start", (p) => p.sessionId === group.id);
    const koStart = waitFor(env.workerSockets[2]!, "stream:out:start", (p) => p.sessionId === group.id);
    const viText = waitFor(env.workerSockets[0]!, "stream:out:text", (p) => p.kind === "translation");
    const zhText = waitFor(env.workerSockets[1]!, "stream:out:text", (p) => p.kind === "translation");
    const mineEnds: Payload<"stream:mine:end">[] = [];
    env.managerSocket.on("stream:mine:end", (p) => mineEnds.push(p));
    const viEnd = waitFor(env.workerSockets[0]!, "stream:out:end", (p) => p.status === "done");
    const zhEnd = waitFor(env.workerSockets[1]!, "stream:out:end", (p) => p.status === "done");

    speak(env.managerSocket, streamIdOf(result), 1.2);
    expect((await viStart).lang).toBe("vi");
    expect((await zhStart).lang).toBe("zh");
    expect((await koStart).lang).toBe("ko"); // 같은 언어: 말한 음성 그대로
    expect((await viText).text).toContain("[vi]");
    expect((await zhText).text).toContain("[zh]");
    await Promise.all([viEnd, zhEnd]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 말한 사람의 턴 끝은 대표 레인 1개만 (언어 수만큼 겹치지 않게)
    expect(mineEnds.filter((p) => p.sessionId === group.id)).toHaveLength(1);

    // 기록: 현장 그룹 대화에 언어별로 저장 — 받는 사람은 자기 언어, 말한 사람에게는 1건만 보인다
    const conversationId = group.conversationId!;
    const listFor = async (user: typeof vi) =>
      ((await user!.as("get", `/conversations/${conversationId}/messages`)).body as { messages?: MessageView[] } | MessageView[]);
    const asList = (body: { messages?: MessageView[] } | MessageView[]) => (Array.isArray(body) ? body : body.messages ?? []);
    const viMessages = asList(await listFor(vi)).filter((m) => m.sessionId === group.id);
    const zhMessages = asList(await listFor(zh)).filter((m) => m.sessionId === group.id);
    const managerMessages = asList(await listFor(env.manager)).filter((m) => m.sessionId === group.id);
    expect(viMessages).toHaveLength(1);
    expect(viMessages[0]!.text).toContain("[vi]");
    expect(zhMessages).toHaveLength(1);
    expect(zhMessages[0]!.text).toContain("[zh]");
    expect(managerMessages).toHaveLength(1);
    // 대조군: 같은 언어(ko) 직접 전달은 기록을 만들지 않는다
    expect(asList(await listFor(ko)).filter((m) => m.sessionId === group.id)).toHaveLength(0);

    await env.manager.as("post", `/sessions/${group.id}/end`);
  });

  it("나중에 들어온 사람의 언어로 레인이 생기고, 나간 사람의 언어 레인은 닫힌다", async () => {
    const env = await setupSite(t, ["vi", "zh"]);
    const [vi, zh] = env.workers;
    const group = (await env.manager.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    await vi!.as("post", `/sites/${env.siteId}/group-call`);
    const before = engine.connections.length;
    const streamId = streamIdOf(await open(env.managerSocket, group.id));
    expect(engine.connections.slice(before).map((c) => c.targetLang)).toEqual(["vi"]);

    // zh 가 들어오면 관리자 스트림에 zh 레인이 생겨, 다음 말부터 zh 도 받는다
    await zh!.as("post", `/sites/${env.siteId}/group-call`);
    expect(engine.connections.slice(before).map((c) => c.targetLang).sort()).toEqual(["vi", "zh"]);
    const zhStart = waitFor(env.workerSockets[1]!, "stream:out:start", (p) => p.sessionId === group.id);
    speak(env.managerSocket, streamId, 1.0);
    expect((await zhStart).lang).toBe("zh");
    await waitFor(env.workerSockets[1]!, "stream:out:end");

    // vi 가 나가면 vi 레인(엔진 연결)은 닫히고, zh 레인은 그대로
    await vi!.as("post", `/sessions/${group.id}/end`);
    const lanes = engine.connections.slice(before);
    expect(lanes.find((c) => c.targetLang === "vi")!.closed).toBe(true);
    expect(lanes.find((c) => c.targetLang === "zh")!.closed).toBe(false);
    await env.manager.as("post", `/sessions/${group.id}/end`);
    expect(lanes.every((c) => c.closed)).toBe(true);
  });

  it("방 전체 반이중: 누군가에게 통역이 재생되는 동안 다른 참여자의 조각은 버린다 (폰이 가까우면 옆 폰 소리가 들어감). 대조군: 재생이 끝난 뒤에는 통역된다", async () => {
    const env = await setupSite(t, ["vi", "zh"]);
    const [vi, zh] = env.workers;
    const group = (await env.manager.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    for (const worker of [vi!, zh!]) await worker.as("post", `/sites/${env.siteId}/group-call`);
    const managerStream = streamIdOf(await open(env.managerSocket, group.id));
    const zhStream = streamIdOf(await open(env.workerSockets[1]!, group.id));

    // 관리자 말 → vi 에게 재생 중(서버 추정: start ~ end). 그사이 zh 가 보낸 조각은 메아리로 버린다
    const viStart = waitFor(env.workerSockets[0]!, "stream:out:start", (p) => p.fromUserId === env.manager.id);
    // 끝 알림은 미리 기다린다 (먼저 끝난 쪽을 놓치지 않게)
    const viEnd = waitFor(env.workerSockets[0]!, "stream:out:end", () => true, 6000);
    const zhEnd = waitFor(env.workerSockets[1]!, "stream:out:end", () => true, 6000);
    speak(env.managerSocket, managerStream, 1.5);
    await viStart;
    const seq = speak(env.workerSockets[1]!, zhStream, 0.5);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(t.context.streams!.stats(zhStream)!.echoDropped).toBeGreaterThan(0);

    // 재생이 모두 끝나고 꼬리(300ms)가 지나면 zh 의 말은 관리자에게 통역된다
    await Promise.all([viEnd, zhEnd]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const dropped = t.context.streams!.stats(zhStream)!.echoDropped;
    const managerHears = waitFor(env.managerSocket, "stream:out:start", (p) => p.fromUserId === zh!.id, 5000);
    speak(env.workerSockets[1]!, zhStream, 1.0, seq);
    expect((await managerHears).lang).toBe("ko");
    expect(t.context.streams!.stats(zhStream)!.echoDropped).toBe(dropped);
    await env.manager.as("post", `/sessions/${group.id}/end`);
  });

  it("나간 사람의 스트림은 닫히고(이후 음성 무시), 남은 사람끼리 계속된다", async () => {
    const env = await setupSite(t, ["vi"]);
    const [vi] = env.workers;
    const group = (await env.manager.as("post", `/sites/${env.siteId}/group-call`)).body as LiveSession;
    await vi!.as("post", `/sites/${env.siteId}/group-call`);
    const viStream = streamIdOf(await open(env.workerSockets[0]!, group.id));
    expect(t.context.streams!.stats(viStream)).not.toBeNull();
    await vi!.as("post", `/sessions/${group.id}/end`);
    expect(t.context.streams!.stats(viStream)).toBeNull();
    // 나간 사람은 다시 열 수 없다 (CONFLICT). 대조군: 남은 관리자는 열 수 있다
    expect(await open(env.workerSockets[0]!, group.id)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await open(env.managerSocket, group.id)).toMatchObject({ ok: true });
    await env.manager.as("post", `/sessions/${group.id}/end`);
  });
});
