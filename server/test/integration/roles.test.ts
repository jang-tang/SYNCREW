import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRealtimeTestApp, nextEvent, noEvent } from "../helpers/testApp";

// 관리자 지정·해제 (PATCH /sites/:siteId/members/:userId { role }). 권한(구성원 403 등)은 permissions.test.ts 매트릭스.

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
let t: RtApp;
beforeAll(async () => {
  t = await createRealtimeTestApp();
});
afterAll(async () => {
  await t.close();
});

async function setupSite() {
  const manager = await (await t.user("관리자", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "역할 현장" })).body.id as string;
  const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
  const worker = await (await t.user("작업자", "vi")).withProfile();
  await worker.as("post", "/join").send({ code });
  await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
  return { manager, worker, siteId, code };
}

describe("관리자 지정·해제", () => {
  it("지정하면 관리자 기능이 열리고, 해제하면 다시 막힌다", async () => {
    const { manager, worker, siteId } = await setupSite();
    const managerOnly = () => worker.as("get", `/sites/${siteId}/instructions`);
    expect((await managerOnly()).status).toBe(403); // 대조군: 지정 전

    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ role: "manager" })).status).toBe(204);
    expect((await managerOnly()).status).toBe(200);
    const members = (await manager.as("get", `/sites/${siteId}/members`)).body as { userId: string; role: string }[];
    expect(members.find((m) => m.userId === worker.id)?.role).toBe("manager");
    // 같은 역할로 다시 보내도 그대로 (멱등)
    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ role: "manager" })).status).toBe(204);

    // 새 관리자가 원래 관리자를 해제할 수도 있다 (관리자가 2명이므로)
    expect((await worker.as("patch", `/sites/${siteId}/members/${manager.id}`).send({ role: "member" })).status).toBe(204);
    expect((await manager.as("get", `/sites/${siteId}/instructions`)).status).toBe(403);
  });

  it("현장의 마지막 관리자는 해제할 수 없다 (자기 자신 포함), 가입 대기자는 역할을 바꿀 수 없다", async () => {
    const { manager, siteId, code } = await setupSite();
    const self = await manager.as("patch", `/sites/${siteId}/members/${manager.id}`).send({ role: "member" });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe("CONFLICT");

    const pending = await (await t.user("대기자", "zh")).withProfile();
    await pending.as("post", "/join").send({ code });
    expect((await manager.as("patch", `/sites/${siteId}/members/${pending.id}`).send({ role: "manager" })).status).toBe(409);
    expect((await manager.as("patch", `/sites/${siteId}/members/${pending.id}`).send({ role: "boss" })).status).toBe(400);
  });

  it("실시간: 지정되면 관리자 알림(가입 요청)을 받고, 해제되면 더 받지 않는다", async () => {
    const { manager, worker, siteId, code } = await setupSite();
    const socket = await t.connected(worker.token);
    await new Promise((resolve) => socket.emit("site:subscribe", { siteId }, resolve));

    const joinAs = async (name: string) => (await (await t.user(name, "ru")).withProfile()).as("post", "/join").send({ code });
    // 대조군: 지정 전에는 가입 요청 알림을 받지 않는다
    const before = noEvent(socket, "join:requested", 500);
    await joinAs("지원자1");
    await before;

    const changed = nextEvent(socket, "membership:changed");
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ role: "manager" });
    expect(await changed).toMatchObject({ siteId, userId: worker.id, role: "manager", status: "active" });
    const received = nextEvent(socket, "join:requested");
    await joinAs("지원자2");
    expect(await received).toMatchObject({ siteId, displayName: "지원자2" });

    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ role: "member" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = noEvent(socket, "join:requested", 500);
    await joinAs("지원자3");
    await after;
  });
});
