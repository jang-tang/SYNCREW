import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import type { LiveSession, MessageView } from "../../src/shared/api";
import type { ServerToClientEvents } from "../../src/shared/realtime";
import { makeM4a } from "../helpers/audio";
import { createRealtimeTestApp, nextEvent, noEvent, type RtClient } from "../helpers/testApp";

// Phase 5: 실시간 통역 세션 — 1:1 통역 통화와 관리자 일괄 지시 (Fake 엔진, 실제 Postgres·Socket.IO)
// 시나리오 A–G: docs/live-interpretation.md 5절

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
type User = Awaited<ReturnType<Awaited<ReturnType<RtApp["user"]>>["withProfile"]>>;

const stt = new FakeStt({ text: (lang) => ({ ko: "자재를 옮기세요", vi: "Tôi hiểu rồi", zh: "我明白了", ru: "Понял", uz: "Tushundim" })[lang] });
const translator = new FakeTranslator();
let t: RtApp;
let m4a: Buffer;

beforeAll(async () => {
  // 테스트에서 기다리지 않도록 울림·연결 끊김 유예를 짧게
  t = await createRealtimeTestApp({ stt, translator, sessions: { ringTimeoutMs: 600, disconnectGraceMs: 500 } });
  m4a = makeM4a();
});
afterAll(async () => {
  await t.close();
});

/** 조건에 맞는 이벤트가 올 때까지 기다린다 (같은 이벤트가 여러 번 올 수 있을 때) */
function waitFor<E extends keyof ServerToClientEvents>(
  socket: RtClient,
  event: E,
  predicate: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean,
  timeoutMs = 3000,
) {
  return new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve, reject) => {
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
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

const sessionEnded = (socket: RtClient, id: string) => waitFor(socket, "session:updated", ({ session }) => session.id === id && session.status === "ended");

/** 관리자(ko) + 승인된 구성원들, 모두 실시간 연결 */
async function setupSite(workerLangs: string[]) {
  const manager = await (await t.user("김반장", "ko")).withProfile();
  const site = await manager.as("post", "/sites").send({ name: "실시간 현장" });
  const siteId = site.body.id as string;
  const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
  const workers: User[] = [];
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

const utter = (from: User, sessionId: string, clientMessageId = randomUUID()) =>
  from
    .as("post", `/sessions/${sessionId}/utterances`)
    .field("clientMessageId", clientMessageId)
    .attach("audio", m4a, { filename: "speech.m4a", contentType: "audio/mp4" });

/** 통화 걸고 받기까지 */
async function connectCall(env: Awaited<ReturnType<typeof setupSite>>) {
  const { manager, siteId, workers, workerSockets, managerSocket } = env;
  const invited = nextEvent(workerSockets[0]!, "session:invite");
  const started = await manager.as("post", `/sites/${siteId}/calls`).send({ userId: workers[0]!.id });
  expect(started.status).toBe(201);
  const session = started.body as LiveSession;
  expect((await invited).session.id).toBe(session.id);
  const activeForCaller = waitFor(managerSocket, "session:updated", ({ session: s }) => s.id === session.id && s.status === "active");
  const accepted = await workers[0]!.as("post", `/sessions/${session.id}/accept`);
  expect(accepted.status).toBe(200);
  await activeForCaller;
  return session;
}

describe("시나리오 A: 1:1 통역 통화", () => {
  it("통화를 걸면 상대는 울림을 받고, 수락하면 양쪽이 서로의 발화를 자기 언어로 자동 수신한다", async () => {
    const env = await setupSite(["vi"]);
    const { manager, workers, managerSocket, workerSockets, siteId } = env;
    const worker = workers[0]!;

    const invited = nextEvent(workerSockets[0]!, "session:invite");
    const started = await manager.as("post", `/sites/${siteId}/calls`).send({ userId: worker.id });
    expect(started.status).toBe(201);
    const ringing = started.body as LiveSession;
    expect(ringing).toMatchObject({ mode: "call", status: "ringing", startedBy: manager.id, startedByName: "김반장" });
    expect(ringing.participants.map((p) => [p.role, p.lang, p.online])).toEqual([["caller", "ko", true], ["callee", "vi", true]]);
    expect((await invited).session).toMatchObject({ id: ringing.id, status: "ringing" });

    const active = waitFor(managerSocket, "session:updated", ({ session }) => session.status === "active");
    await worker.as("post", `/sessions/${ringing.id}/accept`);
    expect((await active).session.answeredAt).not.toBeNull();

    // 관리자가 말함 → 작업자 이어폰(자동 재생)으로 베트남어 통역
    const toWorker = nextEvent(workerSockets[0]!, "message:new");
    expect((await utter(manager, ringing.id)).status).toBe(202);
    const heard = (await toWorker).message;
    expect(heard).toMatchObject({ sessionId: ringing.id, kind: "direct", conversationId: ringing.conversationId, text: "[vi] 자재를 옮기세요", originalText: "자재를 옮기세요" });
    expect(heard.audioUrl).toMatch(/\/audio\?/);

    // 작업자가 말함 → 관리자에게 한국어
    const toManager = nextEvent(managerSocket, "message:new");
    expect((await utter(worker, ringing.id)).status).toBe(202);
    expect((await toManager).message).toMatchObject({ sessionId: ringing.id, senderId: worker.id, text: "[ko] Tôi hiểu rồi" });

    // 끊기 → 양쪽 종료
    const endedForWorker = sessionEnded(workerSockets[0]!, ringing.id);
    const ended = await manager.as("post", `/sessions/${ringing.id}/end`);
    expect(ended.body).toMatchObject({ status: "ended", endReason: "hangup" });
    expect((await endedForWorker).session.endReason).toBe("hangup");

    // 끝난 통화에는 말할 수 없다
    expect((await utter(manager, ringing.id)).status).toBe(409);
  });

  it("거절·취소·부재중이 구분된다", async () => {
    const env = await setupSite(["vi"]);
    const { manager, workers, siteId, managerSocket } = env;
    const call = () => manager.as("post", `/sites/${siteId}/calls`).send({ userId: workers[0]!.id });

    const declined = (await call()).body as LiveSession;
    const declinedEvent = sessionEnded(managerSocket, declined.id);
    await workers[0]!.as("post", `/sessions/${declined.id}/decline`);
    expect((await declinedEvent).session.endReason).toBe("declined");

    const cancelled = (await call()).body as LiveSession;
    expect((await manager.as("post", `/sessions/${cancelled.id}/end`)).body.endReason).toBe("cancelled");

    const missed = (await call()).body as LiveSession;
    expect((await sessionEnded(managerSocket, missed.id)).session.endReason).toBe("missed"); // 울림 제한 600ms
    expect((await workers[0]!.as("post", `/sessions/${missed.id}/accept`)).status).toBe(409);
  });

  it("통화 중인 사람에게는 BUSY, 접속하지 않은 사람에게는 걸 수 없다", async () => {
    const env = await setupSite(["vi", "zh"]);
    const { manager, workers, siteId } = env;
    await connectCall(env);
    const busy = await workers[1]!.as("post", `/sites/${siteId}/calls`).send({ userId: workers[0]!.id });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("BUSY");

    const offline = await (await t.user("미접속", "ru")).withProfile();
    const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code;
    await offline.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${offline.id}`).send({ action: "approve" });
    const notConnected = await workers[1]!.as("post", `/sites/${siteId}/calls`).send({ userId: offline.id });
    expect(notConnected.status).toBe(409);
    expect(notConnected.body.error.code).toBe("CONFLICT");
  });

  it("통화에 참여하지 않은 사람은 세션 조회·발화·종료를 할 수 없다 (404)", async () => {
    const env = await setupSite(["vi", "zh"]);
    const session = await connectCall(env);
    const outsider = env.workers[1]!;
    expect((await outsider.as("get", `/sessions/${session.id}`)).status).toBe(404);
    expect((await utter(outsider, session.id)).status).toBe(404);
    expect((await outsider.as("post", `/sessions/${session.id}/end`)).status).toBe(404);
  });
});

describe("시나리오 E: 연결 끊김과 복구", () => {
  it("통화 상대의 연결이 끊기면 오프라인으로 표시되고, 유예 시간 안에 돌아오지 않으면 연결 끊김으로 종료된다", async () => {
    const env = await setupSite(["vi"]);
    const session = await connectCall(env);
    const offline = waitFor(env.managerSocket, "session:updated", ({ session: s }) => s.participants.some((p) => p.role === "callee" && !p.online));
    env.workerSockets[0]!.disconnect();
    expect((await offline).session.status).toBe("active");
    const ended = await sessionEnded(env.managerSocket, session.id);
    expect(ended.session.endReason).toBe("connection_lost");
  });

  it("유예 시간 안에 다시 연결되면 통화가 유지된다 (대조군)", async () => {
    const env = await setupSite(["vi"]);
    const session = await connectCall(env);
    const backOnline = waitFor(env.managerSocket, "session:updated", ({ session: s }) => s.participants.every((p) => p.online) && s.status === "active");
    env.workerSockets[0]!.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    await t.connected(env.workers[0]!.token);
    await backOnline;
    await new Promise((r) => setTimeout(r, 700)); // 유예(500ms)가 지나도
    expect((await env.manager.as("get", `/sessions/${session.id}`)).body.status).toBe("active");
  });

  it("헤드셋 상태를 알리면 관리자 멤버 목록·세션 참여자 정보에 표시되고, 연결이 끊기면 지워진다", async () => {
    const env = await setupSite(["vi"]);
    const { manager, siteId, managerSocket, workerSockets, workers } = env;
    await managerSocket.timeout(3000).emitWithAck("site:subscribe", { siteId });
    const changed = nextEvent(managerSocket, "device:changed");
    const device = { audioRoute: "bluetooth" as const, inputName: "Helmet BT", micPermission: "granted" as const };
    expect(await workerSockets[0]!.timeout(3000).emitWithAck("device:status", device)).toEqual({ ok: true });
    expect(await changed).toMatchObject({ siteId, userId: workers[0]!.id, device });
    expect(await workerSockets[0]!.timeout(3000).emitWithAck("device:status", { audioRoute: "radio" } as never)).toEqual({ ok: false, code: "VALIDATION_ERROR" });

    const members = async () => (await manager.as("get", `/sites/${siteId}/members`)).body as { userId: string; device: unknown }[];
    expect((await members()).find((m) => m.userId === workers[0]!.id)!.device).toEqual(device);

    const session = await connectCall(env);
    expect((await manager.as("get", `/sessions/${session.id}`)).body.participants.find((p: { role: string }) => p.role === "callee").device).toEqual(device);

    workerSockets[0]!.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    expect((await members()).find((m) => m.userId === workers[0]!.id)!.device).toBeNull();
  });
});

describe("시나리오 B·C·D: 관리자 일괄 지시", () => {
  it("전체 대상: 연결된 구성원 모두가 각자 언어로 지시를 자동 수신한다 (언어별 1회 번역)", async () => {
    const env = await setupSite(["vi", "zh", "ru", "vi"]);
    const { manager, siteId, workerSockets, managerSocket } = env;
    const invites = workerSockets.map((s) => nextEvent(s, "session:invite"));
    const started = await manager.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" });
    expect(started.status).toBe(201);
    const session = started.body as LiveSession;
    expect(session).toMatchObject({ mode: "broadcast", status: "active" });
    expect(session.participants.filter((p) => p.role === "listener")).toHaveLength(4);
    for (const invite of invites) expect((await invite).session.id).toBe(session.id);

    const heard = workerSockets.map((s) => nextEvent(s, "message:new"));
    const callsBefore = translator.calls.length;
    expect((await utter(manager, session.id)).status).toBe(202);
    const messages = await Promise.all(heard.map(async (p) => (await p).message));
    expect(messages.map((m) => m.text)).toEqual(["[vi] 자재를 옮기세요", "[zh] 자재를 옮기세요", "[ru] 자재를 옮기세요", "[vi] 자재를 옮기세요"]);
    for (const m of messages) expect(m).toMatchObject({ kind: "instruction", sessionId: session.id, conversationId: null, requiresAck: false });
    await t.context.pipeline.idle();
    expect(translator.calls.slice(callsBefore).map((c) => c.targetLang).sort()).toEqual(["ru", "vi", "zh"]);

    // 관리자는 전달 상태(수신자 집계)를 받는다
    const done = await waitFor(managerSocket, "message:status", (p) => p.status === "done");
    expect(done.recipients).toMatchObject({ sent: 4 });

    const ended = sessionEnded(workerSockets[0]!, session.id);
    await manager.as("post", `/sessions/${session.id}/end`);
    expect((await ended).session.endReason).toBe("hangup");
  });

  it("선택 대상: 선택한 구성원만 받는다 (선택하지 않은 사람은 받지 않음, 대조군 포함)", async () => {
    const env = await setupSite(["vi", "zh"]);
    const { manager, siteId, workers, workerSockets } = env;
    const notInvited = noEvent(workerSockets[1]!, "session:invite", 600);
    const session = (await manager.as("post", `/sites/${siteId}/broadcasts`).send({ target: { userIds: [workers[0]!.id] } })).body as LiveSession;
    await notInvited;
    const selected = nextEvent(workerSockets[0]!, "message:new");
    const notSelected = noEvent(workerSockets[1]!, "message:new", 800);
    await utter(manager, session.id);
    expect((await selected).message.text).toBe("[vi] 자재를 옮기세요");
    await notSelected;
  });

  it("접속이 끊긴 대상자는 관리자 화면에 오프라인으로 표시되고, 지시는 기록으로 남아 다시 접속하면 받은 지시에서 볼 수 있다", async () => {
    const env = await setupSite(["vi", "zh"]);
    const { manager, siteId, workers, workerSockets, managerSocket } = env;
    const session = (await manager.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" })).body as LiveSession;
    const offline = waitFor(managerSocket, "session:updated", ({ session: s }) => s.participants.some((p) => p.userId === workers[1]!.id && !p.online));
    workerSockets[1]!.disconnect();
    await offline;
    // 수신자가 끊겨도 일괄 지시는 계속된다 (관리자가 끊긴 경우만 종료)
    await utter(manager, session.id);
    await t.context.pipeline.idle();
    expect((await manager.as("get", `/sessions/${session.id}`)).body.status).toBe("active");
    const inbox = (await workers[1]!.as("get", `/sites/${siteId}/inbox`)).body as { sessionId: string; text: string; myStatus: string }[];
    expect(inbox[0]).toMatchObject({ sessionId: session.id, text: "[zh] 자재를 옮기세요", myStatus: "sent" });
  });

  it("관리자의 연결이 끊긴 채 돌아오지 않으면 일괄 지시가 종료된다", async () => {
    const env = await setupSite(["vi"]);
    const session = (await env.manager.as("post", `/sites/${env.siteId}/broadcasts`).send({ target: "all" })).body as LiveSession;
    const ended = sessionEnded(env.workerSockets[0]!, session.id);
    env.managerSocket.disconnect();
    expect((await ended).session.endReason).toBe("connection_lost");
  });
});

describe("시나리오 G: 권한", () => {
  it("구성원은 일괄 지시를 시작·발화·종료할 수 없다", async () => {
    const env = await setupSite(["vi", "zh"]);
    const { manager, siteId, workers } = env;
    const denied = await workers[0]!.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" });
    expect(denied.status).toBe(403);
    const session = (await manager.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" })).body as LiveSession;
    expect((await utter(workers[0]!, session.id)).status).toBe(403);
    expect((await workers[0]!.as("post", `/sessions/${session.id}/end`)).status).toBe(403);
    // 다른 현장 사람은 존재도 모른다
    const outsider = await (await t.user()).withProfile();
    expect((await outsider.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" })).status).toBe(404);
  });

  it("일괄 지시 도중 관리자에서 해제되면 더 말할 수 없다 (해제 전 대조군 포함)", async () => {
    const env = await setupSite(["vi", "zh"]);
    const { manager, siteId, workers, workerSockets } = env;
    // 작업자2를 관리자로 지정 → 전체 대상 일괄 지시 시작 (대상: 구성원인 작업자1)
    const speaker = workers[1]!;
    expect((await manager.as("patch", `/sites/${siteId}/members/${speaker.id}`).send({ role: "manager" })).status).toBe(204);
    const session = (await speaker.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" })).body as LiveSession;
    expect(session.participants.map((p) => [p.userId, p.role])).toEqual([[speaker.id, "speaker"], [workers[0]!.id, "listener"]]);

    // 대조군: 관리자인 동안은 지시가 전달된다
    const heard = nextEvent(workerSockets[0]!, "message:new");
    expect((await utter(speaker, session.id)).status).toBe(202);
    expect((await heard).message).toMatchObject({ kind: "instruction", senderId: speaker.id, sessionId: session.id });
    await t.context.pipeline.idle();

    // 다른 관리자가 해제 → 연결이 그대로라 세션은 열려 있어도 발화는 403, 지시가 가지 않는다
    expect((await manager.as("patch", `/sites/${siteId}/members/${speaker.id}`).send({ role: "member" })).status).toBe(204);
    const notHeard = noEvent(workerSockets[0]!, "message:new", 800);
    const denied = await utter(speaker, session.id);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    await notHeard;
    // 남은 세션은 끝낼 수 있다
    expect((await speaker.as("post", `/sessions/${session.id}/end`)).body).toMatchObject({ status: "ended", endReason: "hangup" });
  });

  it("현장에 없는 사람을 대상으로 지정할 수 없고, 제외된 구성원은 진행 중인 세션에서 빠진다", async () => {
    const env = await setupSite(["vi", "zh"]);
    const { manager, siteId, workers, workerSockets } = env;
    const outsider = await (await t.user()).withProfile();
    expect((await manager.as("post", `/sites/${siteId}/broadcasts`).send({ target: { userIds: [outsider.id] } })).status).toBe(400);

    const session = (await manager.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" })).body as LiveSession;
    await manager.as("patch", `/sites/${siteId}/members/${workers[1]!.id}`).send({ action: "remove" });
    const stillListening = nextEvent(workerSockets[0]!, "message:new");
    const removed = noEvent(workerSockets[1]!, "message:new", 800);
    await utter(manager, session.id);
    expect((await stillListening).message.text).toBe("[vi] 자재를 옮기세요");
    await removed;
    expect((await workers[1]!.as("get", `/sessions/${session.id}`)).status).toBe(404);
  });
});

describe("시나리오 F: 대화 기록", () => {
  it("통화 발화는 1:1 대화 기록에, 일괄 지시 발화는 지시 기록에 세션 표시와 함께 남고, 세션별로 조회된다", async () => {
    const env = await setupSite(["vi"]);
    const { manager, siteId, workers } = env;
    const worker = workers[0]!;

    // 통화 전 일반 메시지(텍스트) 1건 + 통화 발화 2건
    const call = await connectCall(env);
    await manager.as("post", `/conversations/${call.conversationId}/messages`).send({ clientMessageId: randomUUID(), text: "통화 전 메모" });
    await utter(manager, call.id);
    await utter(worker, call.id);
    await t.context.pipeline.idle();
    await manager.as("post", `/sessions/${call.id}/end`);

    const conversation = (await worker.as("get", `/conversations/${call.conversationId}/messages`)).body as MessageView[];
    expect(conversation.map((m) => [m.sessionId === call.id, m.senderId === worker.id])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
    const callLog = (await worker.as("get", `/sessions/${call.id}/messages`)).body as MessageView[];
    expect(callLog.map((m) => m.text)).toEqual(["[vi] 자재를 옮기세요", "Tôi hiểu rồi"]);

    // 일괄 지시 1건 + 문자 지시 1건
    const broadcast = (await manager.as("post", `/sites/${siteId}/broadcasts`).send({ target: "all" })).body as LiveSession;
    await utter(manager, broadcast.id);
    await manager.as("post", `/sites/${siteId}/instructions`).send({ clientMessageId: randomUUID(), text: "문자 지시", target: "all", requiresAck: true });
    await t.context.pipeline.idle();
    await manager.as("post", `/sessions/${broadcast.id}/end`);

    const instructions = (await manager.as("get", `/sites/${siteId}/instructions`)).body as { sessionId: string | null; text: string }[];
    expect(instructions.map((i) => [i.text, i.sessionId])).toEqual([
      ["문자 지시", null],
      ["자재를 옮기세요", broadcast.id],
    ]);

    // 모드별 세션 목록
    const calls = (await manager.as("get", `/sites/${siteId}/sessions?mode=call`)).body as LiveSession[];
    const broadcasts = (await manager.as("get", `/sites/${siteId}/sessions?mode=broadcast`)).body as LiveSession[];
    expect(calls.map((s) => s.id)).toEqual([call.id]);
    expect(broadcasts.map((s) => [s.id, s.endReason])).toEqual([[broadcast.id, "hangup"]]);
    expect((await manager.as("get", `/sessions/${broadcast.id}/messages`)).body).toHaveLength(1);
  });

  it("열린 세션 조회: 앱을 다시 열면 진행 중인 통화를 복원할 수 있다", async () => {
    const env = await setupSite(["vi"]);
    const session = await connectCall(env);
    const open = (await env.workers[0]!.as("get", `/sites/${env.siteId}/sessions/open`)).body as LiveSession[];
    expect(open.map((s) => [s.id, s.status])).toEqual([[session.id, "active"]]);
  });
});
