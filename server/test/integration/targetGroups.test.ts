import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TargetGroup } from "../../src/shared/api";
import { createTestApp } from "../helpers/testApp";

// B2 작업조 저장 (docs/streaming-plan.md 8-1절 ⑥). 권한(구성원 403·비멤버 404)은 permissions.test.ts 매트릭스에 있다.

type App = Awaited<ReturnType<typeof createTestApp>>;
let t: App;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function setupSite(workerLangs: string[]) {
  const manager = await (await t.user("관리자", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "작업조 현장" })).body.id as string;
  const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
  const join = async (name: string, lang: string, role?: "manager") => {
    const user = await (await t.user(name, lang)).withProfile();
    await user.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${user.id}`).send({ action: "approve" });
    // 역할 변경 API 가 없어 DB 에서 직접 관리자로 (같은 현장 관리자 2명 상황)
    if (role) await t.context.prisma.siteMembership.update({ where: { siteId_userId: { siteId, userId: user.id } }, data: { role } });
    return user;
  };
  const workers = [];
  for (const [index, lang] of workerLangs.entries()) workers.push(await join(`작업자${index + 1}`, lang));
  const manager2 = await join("부관리자", "ko", "manager");
  return { manager, manager2, siteId, workers };
}

const ids = (users: { id: string }[]) => users.map((u) => u.id).sort();

describe("작업조 저장 (B2)", () => {
  it("만들기·목록·이름/구성원 수정·삭제, 같은 현장 관리자끼리 공유", async () => {
    const { manager, manager2, siteId, workers } = await setupSite(["vi", "zh", "ru"]);
    const [a, b, c] = workers;
    const created = await manager.as("post", `/sites/${siteId}/target-groups`).send({ name: " 철근조 ", userIds: [a!.id, b!.id, a!.id] });
    expect(created.status).toBe(201);
    const group = created.body as TargetGroup;
    expect(group).toMatchObject({ name: "철근조", createdBy: manager.id });
    expect(group.userIds.sort()).toEqual(ids([a!, b!])); // 중복 제거

    // 다른 관리자도 보고 고칠 수 있다 (현장 단위 공유)
    const list = await manager2.as("get", `/sites/${siteId}/target-groups`);
    expect(list.status).toBe(200);
    expect((list.body as TargetGroup[]).map((g) => g.name)).toEqual(["철근조"]);
    const renamed = await manager2.as("patch", `/sites/${siteId}/target-groups/${group.id}`).send({ name: "2층 철근조", userIds: [c!.id] });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: "2층 철근조", userIds: [c!.id] });
    const onlyName = await manager.as("patch", `/sites/${siteId}/target-groups/${group.id}`).send({ name: "3층 철근조" });
    expect(onlyName.body).toMatchObject({ name: "3층 철근조", userIds: [c!.id] }); // 구성원 유지

    expect((await manager.as("delete", `/sites/${siteId}/target-groups/${group.id}`)).status).toBe(204);
    expect((await manager.as("get", `/sites/${siteId}/target-groups`)).body).toEqual([]);
    expect((await manager.as("delete", `/sites/${siteId}/target-groups/${group.id}`)).status).toBe(404);
  });

  it("입력 검증: 같은 이름 409, 빈 이름·빈 구성원·바꿀 것 없음 400, 다른 현장 사용자·가입 대기자는 넣을 수 없다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "zh"]);
    const other = await setupSite(["ru"]);
    const pending = await (await t.user("대기자", "uz")).withProfile();
    const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
    await pending.as("post", "/join").send({ code });

    const post = (body: object) => manager.as("post", `/sites/${siteId}/target-groups`).send(body);
    expect((await post({ name: "A조", userIds: [workers[0]!.id] })).status).toBe(201); // 대조군
    expect((await post({ name: "A조", userIds: [workers[1]!.id] })).status).toBe(409);
    expect((await post({ name: "  ", userIds: [workers[0]!.id] })).status).toBe(400);
    expect((await post({ name: "B조", userIds: [] })).status).toBe(400);
    expect((await post({ name: "가".repeat(31), userIds: [workers[0]!.id] })).status).toBe(400);
    const outsider = await post({ name: "B조", userIds: [workers[0]!.id, other.workers[0]!.id] });
    expect(outsider.status).toBe(400);
    expect(outsider.body.error.code).toBe("VALIDATION_ERROR");
    expect((await post({ name: "B조", userIds: [pending.id] })).status).toBe(400);

    const group = (await manager.as("get", `/sites/${siteId}/target-groups`)).body[0] as TargetGroup;
    expect((await manager.as("patch", `/sites/${siteId}/target-groups/${group.id}`).send({})).status).toBe(400);
    const second = (await post({ name: "B조", userIds: [workers[1]!.id] })).body as TargetGroup;
    expect((await manager.as("patch", `/sites/${siteId}/target-groups/${second.id}`).send({ name: "A조" })).status).toBe(409);
  });

  it("다른 현장의 작업조 id 로는 조회·수정·삭제할 수 없다 (404), 그 현장 관리자는 된다 (대조군)", async () => {
    const mine = await setupSite(["vi"]);
    const theirs = await setupSite(["zh"]);
    const theirGroup = (await theirs.manager.as("post", `/sites/${theirs.siteId}/target-groups`).send({ name: "남의 조", userIds: [theirs.workers[0]!.id] })).body as TargetGroup;
    // 내 현장 경로에 남의 작업조 id
    expect((await mine.manager.as("patch", `/sites/${mine.siteId}/target-groups/${theirGroup.id}`).send({ name: "탈취" })).status).toBe(404);
    expect((await mine.manager.as("delete", `/sites/${mine.siteId}/target-groups/${theirGroup.id}`)).status).toBe(404);
    // 남의 현장 경로 (비멤버)
    expect((await mine.manager.as("get", `/sites/${theirs.siteId}/target-groups`)).status).toBe(404);
    const still = (await theirs.manager.as("get", `/sites/${theirs.siteId}/target-groups`)).body as TargetGroup[];
    expect(still).toMatchObject([{ id: theirGroup.id, name: "남의 조" }]);
  });

  it("현장에서 제외된 구성원은 작업조에서도 빠진다 (남은 사람은 그대로)", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "zh"]);
    const [stay, leave] = workers;
    const group = (await manager.as("post", `/sites/${siteId}/target-groups`).send({ name: "C조", userIds: [stay!.id, leave!.id] })).body as TargetGroup;
    expect((await manager.as("patch", `/sites/${siteId}/members/${leave!.id}`).send({ action: "remove" })).status).toBe(204);
    const after = (await manager.as("get", `/sites/${siteId}/target-groups`)).body as TargetGroup[];
    expect(after.find((g) => g.id === group.id)!.userIds).toEqual([stay!.id]);
    expect(await t.context.prisma.targetGroupMember.count({ where: { groupId: group.id, userId: leave!.id } })).toBe(0);
  });
});
