import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRealtimeTestApp, nextEvent, noEvent } from "../helpers/testApp";

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
let t: RtApp;

beforeAll(async () => {
  t = await createRealtimeTestApp();
});
afterAll(async () => {
  await t.close();
});

async function setupSite() {
  const manager = await (await t.user("관리자")).withProfile();
  const site = await manager.as("post", "/sites").send({ name: "실시간 현장" });
  const codes = await manager.as("get", `/sites/${site.body.id}/join-codes`);
  return { manager, siteId: site.body.id as string, code: codes.body[0].code as string };
}

const subscribe = (socket: Awaited<ReturnType<RtApp["connected"]>>, siteId: string) =>
  socket.timeout(3000).emitWithAck("site:subscribe", { siteId });

describe("연결 인증", () => {
  it("토큰이 없거나 잘못되면 연결을 거부한다 (UNAUTHORIZED)", async () => {
    for (const token of [undefined, "not-a-jwt"]) {
      const socket = t.client(token);
      const error = await new Promise<Error & { data?: { code?: string } }>((resolve) => socket.once("connect_error", resolve));
      expect(error.message).toBe("UNAUTHORIZED");
      expect(error.data?.code).toBe("UNAUTHORIZED");
    }
  });

  it("토큰이 만료되면 auth:expired 를 보내고 연결을 끊는다", async () => {
    const user = await (await t.user()).withProfile();
    const shortToken = await t.issuer.sign({ sub: user.id }, { expiresIn: Math.floor(Date.now() / 1000) + 2 });
    const socket = await t.connected(shortToken);
    const expired = await nextEvent(socket, "auth:expired", 4000);
    expect(expired.eventId).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise<void>((resolve) => (socket.connected ? socket.once("disconnect", () => resolve()) : resolve()));
    expect(socket.connected).toBe(false);
  });
});

describe("현장 구독 권한", () => {
  it("활성 멤버만 구독할 수 있고, 비멤버·잘못된 id 는 거부된다", async () => {
    const { manager, siteId } = await setupSite();
    const outsider = await (await t.user()).withProfile();

    expect(await subscribe(await t.connected(manager.token), siteId)).toEqual({ ok: true });
    expect(await subscribe(await t.connected(outsider.token), siteId)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await subscribe(await t.connected(outsider.token), "not-a-uuid")).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("가입 대기 중인 사용자는 구독할 수 없다", async () => {
    const { siteId, code } = await setupSite();
    const worker = await (await t.user()).withProfile();
    await worker.as("post", "/join").send({ code });
    expect(await subscribe(await t.connected(worker.token), siteId)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("가입 요청 → 승인 알림 (시나리오 2, 3 실시간)", () => {
  it("관리자는 가입 요청을, 작업자는 승인 결과를 실시간으로 받는다", async () => {
    const { manager, siteId, code } = await setupSite();
    const managerSocket = await t.connected(manager.token);
    await subscribe(managerSocket, siteId);

    const worker = await (await t.user("Nguyễn", "vi")).withProfile();
    const workerSocket = await t.connected(worker.token);

    const requested = nextEvent(managerSocket, "join:requested");
    await worker.as("post", "/join").send({ code });
    expect(await requested).toMatchObject({ siteId, userId: worker.id, displayName: "Nguyễn", lang: "vi" });

    const toWorker = nextEvent(workerSocket, "membership:changed");
    const toManager = nextEvent(managerSocket, "membership:changed");
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
    const expected = { siteId, userId: worker.id, role: "member", status: "active" };
    expect(await toWorker).toMatchObject(expected);
    expect(await toManager).toMatchObject(expected);

    // 승인 후에는 구독 가능
    expect(await subscribe(workerSocket, siteId)).toEqual({ ok: true });
  });

  it("구성원은 관리자용 알림(가입 요청)을 받지 않는다", async () => {
    const { manager, siteId, code } = await setupSite();
    const member = await (await t.user()).withProfile();
    await member.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${member.id}`).send({ action: "approve" });
    const memberSocket = await t.connected(member.token);
    await subscribe(memberSocket, siteId);

    const newcomer = await (await t.user()).withProfile();
    const silent = noEvent(memberSocket, "join:requested");
    await newcomer.as("post", "/join").send({ code });
    await silent;
  });
});

describe("제외 즉시 차단 (시나리오 12 실시간)", () => {
  it("제외되면 알림을 받고 현장 방에서 즉시 빠져, 이후 현장 알림을 받지 못하며 재구독도 거부된다", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await (await t.user()).withProfile();
    await worker.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });

    const workerSocket = await t.connected(worker.token);
    await subscribe(workerSocket, siteId);

    const removed = nextEvent(workerSocket, "membership:changed");
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "remove" });
    expect(await removed).toMatchObject({ siteId, userId: worker.id, status: "removed" });

    // 현장 방 알림이 더 이상 오지 않는다: 다른 멤버가 처음 접속하면
    // 관리자(대조군)는 presence 알림을 받고, 제외된 작업자는 받지 않아야 한다.
    const other = await (await t.user()).withProfile();
    await other.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${other.id}`).send({ action: "approve" });
    const managerSocket = await t.connected(manager.token);
    await subscribe(managerSocket, siteId);
    const control = nextEvent(managerSocket, "presence:changed");
    const silent = noEvent(workerSocket, "presence:changed", 600);
    await t.connected(other.token);
    expect(await control).toMatchObject({ userId: other.id, online: true });
    await silent;

    expect(await subscribe(workerSocket, siteId)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("접속 상태 (presence)", () => {
  it("현장 멤버의 접속·종료를 알리고 멤버 목록의 online 에 반영한다", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await (await t.user()).withProfile();
    await worker.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });

    const managerSocket = await t.connected(manager.token);
    await subscribe(managerSocket, siteId);
    const onlineOf = async () =>
      (await manager.as("get", `/sites/${siteId}/members`)).body.find((m: { userId: string }) => m.userId === worker.id).online;
    expect(await onlineOf()).toBe(false);

    const cameOnline = nextEvent(managerSocket, "presence:changed");
    const workerSocket = await t.connected(worker.token);
    expect(await cameOnline).toMatchObject({ userId: worker.id, online: true });
    expect(await onlineOf()).toBe(true);

    // 같은 사용자의 두 번째 기기 연결은 상태 변화가 아니다
    const silent = noEvent(managerSocket, "presence:changed", 400);
    const secondDevice = await t.connected(worker.token);
    await silent;

    const wentOffline = nextEvent(managerSocket, "presence:changed");
    workerSocket.disconnect();
    secondDevice.disconnect();
    expect(await wentOffline).toMatchObject({ userId: worker.id, online: false });
    expect(await onlineOf()).toBe(false);
  });
});

describe("수신 확인 · 동기화", () => {
  it("receipt:delivered 형식 검증 (메시지 반영은 Phase 4)", async () => {
    const user = await (await t.user()).withProfile();
    const socket = await t.connected(user.token);
    expect(await socket.timeout(3000).emitWithAck("receipt:delivered", { messageIds: [crypto.randomUUID()] })).toEqual({ ok: true, updated: 0 });
    expect(await socket.timeout(3000).emitWithAck("receipt:delivered", { messageIds: ["x"] })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("sync:required 는 대상 사용자에게만 간다", async () => {
    const a = await (await t.user()).withProfile();
    const b = await (await t.user()).withProfile();
    const socketA = await t.connected(a.token);
    const socketB = await t.connected(b.token);
    const received = nextEvent(socketA, "sync:required");
    const silent = noEvent(socketB, "sync:required");
    t.gateway.requireSync({ userId: a.id });
    await received;
    await silent;
  });

  it("GET /sync: since 이후 바뀐 멤버십과 다음 cursor", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await (await t.user()).withProfile();
    await worker.as("post", "/join").send({ code });
    const first = await worker.as("get", "/sync");
    expect(first.body.memberships).toEqual([{ siteId, status: "pending", role: "member" }]);

    const quiet = await worker.as("get", `/sync?since=${encodeURIComponent(first.body.cursor)}`);
    expect(quiet.body.memberships).toEqual([]);

    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
    const changed = await worker.as("get", `/sync?since=${encodeURIComponent(first.body.cursor)}`);
    expect(changed.body.memberships).toEqual([{ siteId, status: "active", role: "member" }]);
    expect(changed.body).toMatchObject({ conversations: [], messages: [] });
  });
});
