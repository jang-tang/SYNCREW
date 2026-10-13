import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import type { SyncResponse } from "../../src/shared/api";
import { makeM4a } from "../helpers/audio";
import { createRealtimeTestApp, nextEvent } from "../helpers/testApp";

// Phase 6 권한 매트릭스 (시나리오 11·12, G): 모든 현장 경로를
// 토큰 없음 / 다른 현장 사용자 / 가입 대기자 / 제외된 구성원 / 구성원 / 관리자 로 호출해 결과를 확인한다.
// 차단 기대값과 함께 "관리자·구성원은 통과" 대조군을 같은 표에 둔다.

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
type User = Awaited<ReturnType<Awaited<ReturnType<RtApp["user"]>>["withProfile"]>>;
type Role = "none" | "outsider" | "pending" | "removed" | "member" | "manager";

let t: RtApp;
let m4a: Buffer;
let world: {
  siteId: string;
  codeId: string;
  users: Record<Exclude<Role, "none">, User>;
  conversationId: string;
  instructionId: string;
};

beforeAll(async () => {
  t = await createRealtimeTestApp({ stt: new FakeStt(), translator: new FakeTranslator() });
  m4a = makeM4a();
  const manager = await (await t.user("관리자", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "권한 현장" })).body.id as string;
  const codes = (await manager.as("get", `/sites/${siteId}/join-codes`)).body as { id: string; code: string }[];
  const code = codes[0]!.code;
  const join = async (name: string, lang: string, action?: "approve" | "remove") => {
    const user = await (await t.user(name, lang)).withProfile();
    await user.as("post", "/join").send({ code });
    if (action) await manager.as("patch", `/sites/${siteId}/members/${user.id}`).send({ action: "approve" });
    if (action === "remove") await manager.as("patch", `/sites/${siteId}/members/${user.id}`).send({ action: "remove" });
    return user;
  };
  const member = await join("구성원", "vi", "approve");
  const pending = await join("대기자", "zh");
  // 제외 전에 대화·지시를 받아 두고 제외한다 (제외 후 접근 차단 확인용)
  const removed = await join("제외자", "ru", "approve");
  const outsider = await (await t.user("외부인", "uz")).withProfile();
  await outsider.as("post", "/sites").send({ name: "다른 현장" });

  const conversationId = (await manager.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: member.id })).body.id as string;
  const instruction = await manager
    .as("post", `/sites/${siteId}/instructions`)
    .send({ clientMessageId: randomUUID(), text: "점검", target: "all", requiresAck: true });
  await t.context.pipeline.idle();
  await manager.as("patch", `/sites/${siteId}/members/${removed.id}`).send({ action: "remove" });

  world = {
    siteId,
    codeId: codes[0]!.id,
    users: { outsider, pending, removed, member, manager },
    conversationId,
    instructionId: instruction.body.messageId as string,
  };
});
afterAll(async () => {
  await t.close();
});

type Case = {
  name: string;
  call: (as: (method: "get" | "post" | "put" | "patch" | "delete", path: string) => request.Test) => request.Test;
  /** 역할별 기대 상태 코드. 적지 않은 역할은 검사하지 않는다. */
  expect: Partial<Record<Role, number>>;
};

const BLOCKED = { none: 401, outsider: 404, pending: 404, removed: 404 } as const;
const site = () => world.siteId;

// 쓰기 경로의 "통과" 대조군은 부작용을 피하려고 일부러 검증 오류(400)가 나는 본문을 보낸다.
// 400 은 권한 검사를 통과해 본문 검증까지 갔다는 뜻이다.
const CASES: Case[] = [
  { name: "GET /sites/:id", call: (as) => as("get", `/sites/${site()}`), expect: { ...BLOCKED, member: 200, manager: 200 } },
  { name: "PATCH /sites/:id", call: (as) => as("patch", `/sites/${site()}`).send({ name: "" }), expect: { ...BLOCKED, member: 403, manager: 400 } },
  { name: "GET /sites/:id/join-codes", call: (as) => as("get", `/sites/${site()}/join-codes`), expect: { ...BLOCKED, member: 403, manager: 200 } },
  { name: "POST /sites/:id/join-codes", call: (as) => as("post", `/sites/${site()}/join-codes`).send({ maxUses: -1 }), expect: { ...BLOCKED, member: 403, manager: 400 } },
  {
    name: "DELETE /sites/:id/join-codes/:codeId",
    call: (as) => as("delete", `/sites/${site()}/join-codes/${randomUUID()}`),
    expect: { ...BLOCKED, member: 403, manager: 404 },
  },
  { name: "GET /sites/:id/members", call: (as) => as("get", `/sites/${site()}/members`), expect: { ...BLOCKED, member: 200, manager: 200 } },
  {
    name: "PATCH /sites/:id/members/:userId",
    call: (as) => as("patch", `/sites/${site()}/members/${world.users.member.id}`).send({ action: "nope" }),
    expect: { ...BLOCKED, member: 403, manager: 400 },
  },
  { name: "GET /sites/:id/conversations", call: (as) => as("get", `/sites/${site()}/conversations`), expect: { ...BLOCKED, member: 200, manager: 200 } },
  {
    name: "POST /sites/:id/conversations/direct",
    call: (as) => as("post", `/sites/${site()}/conversations/direct`).send({ userId: "not-a-uuid" }),
    expect: { ...BLOCKED, member: 400, manager: 400 },
  },
  {
    name: "GET /conversations/:id/messages",
    call: (as) => as("get", `/conversations/${world.conversationId}/messages`),
    expect: { none: 401, outsider: 404, pending: 404, removed: 404, member: 200, manager: 200 },
  },
  {
    name: "POST /conversations/:id/messages",
    call: (as) => as("post", `/conversations/${world.conversationId}/messages`).send({ clientMessageId: "x" }),
    expect: { none: 401, outsider: 404, pending: 404, removed: 404, member: 400, manager: 400 },
  },
  {
    name: "POST /sites/:id/calls",
    call: (as) => as("post", `/sites/${site()}/calls`).send({ userId: "not-a-uuid" }),
    expect: { ...BLOCKED, member: 400, manager: 400 },
  },
  {
    name: "POST /sites/:id/broadcasts",
    call: (as) => as("post", `/sites/${site()}/broadcasts`).send({ target: 1 }),
    expect: { ...BLOCKED, member: 403, manager: 400 },
  },
  { name: "GET /sites/:id/sessions/open", call: (as) => as("get", `/sites/${site()}/sessions/open`), expect: { ...BLOCKED, member: 200, manager: 200 } },
  { name: "GET /sites/:id/sessions", call: (as) => as("get", `/sites/${site()}/sessions`), expect: { ...BLOCKED, member: 200, manager: 200 } },
  {
    name: "POST /sites/:id/instructions",
    call: (as) => as("post", `/sites/${site()}/instructions`).send({ clientMessageId: "x" }),
    expect: { ...BLOCKED, member: 403, manager: 400 },
  },
  { name: "GET /sites/:id/instructions", call: (as) => as("get", `/sites/${site()}/instructions`), expect: { ...BLOCKED, member: 403, manager: 200 } },
  // 지시 상세는 관리자 전용이지만 존재를 숨기려고 구성원에게도 404
  {
    name: "GET /instructions/:id",
    call: (as) => as("get", `/instructions/${world.instructionId}`),
    expect: { none: 401, outsider: 404, pending: 404, removed: 404, member: 404, manager: 200 },
  },
  // B2 작업조: 관리자만 (구성원 403). 관리자 대조군은 잘못된 입력 400 / 없는 작업조 404 (데이터를 바꾸지 않게)
  { name: "GET /sites/:id/target-groups", call: (as) => as("get", `/sites/${site()}/target-groups`), expect: { ...BLOCKED, member: 403, manager: 200 } },
  { name: "POST /sites/:id/target-groups", call: (as) => as("post", `/sites/${site()}/target-groups`).send({ name: "" }), expect: { ...BLOCKED, member: 403, manager: 400 } },
  {
    name: "PATCH /sites/:id/target-groups/:gid",
    call: (as) => as("patch", `/sites/${site()}/target-groups/${randomUUID()}`).send({ name: "철근조" }),
    expect: { ...BLOCKED, member: 403, manager: 404 },
  },
  {
    name: "DELETE /sites/:id/target-groups/:gid",
    call: (as) => as("delete", `/sites/${site()}/target-groups/${randomUUID()}`),
    expect: { ...BLOCKED, member: 403, manager: 404 },
  },
  { name: "GET /sites/:id/inbox", call: (as) => as("get", `/sites/${site()}/inbox`), expect: { ...BLOCKED, member: 200, manager: 200 } },
  // 받은 사람만 응답할 수 있다: 제외자는 지시를 받았지만 제외 후에는 404
  {
    name: "POST /instructions/:id/ack",
    call: (as) => as("post", `/instructions/${world.instructionId}/ack`),
    expect: { none: 401, outsider: 404, pending: 404, removed: 404, manager: 404, member: 204 },
  },
  {
    name: "POST /instructions/:id/complete",
    // 본문 검증이 받은 사람 확인보다 먼저라 유효한 본문으로 확인한다 (400 은 존재 여부를 드러내지 않음)
    call: (as) => as("post", `/instructions/${world.instructionId}/complete`).send({ note: "완료" }),
    expect: { none: 401, outsider: 404, pending: 404, removed: 404, manager: 404, member: 204 },
  },
];

describe("권한 매트릭스: 현장 경로 × 역할", () => {
  it.each(CASES)("$name", async ({ call, expect: expected }) => {
    const results: Partial<Record<Role, number>> = {};
    for (const role of Object.keys(expected) as Role[]) {
      const as =
        role === "none"
          ? (method: "get" | "post" | "put" | "patch" | "delete", path: string) => request(t.app)[method](`/api/v1${path}`)
          : world.users[role].as;
      results[role] = (await call(as)).status;
    }
    expect(results).toEqual(expected);
  });
});

describe("세션 권한 (시나리오 G 보강)", () => {
  it("통화는 받는 사람만 수락·거절할 수 있고(건 사람 403), 참여자가 아니면 조회·수락·기록 모두 404", async () => {
    const { manager, member, outsider } = world.users;
    const managerSocket = await t.connected(manager.token);
    const memberSocket = await t.connected(member.token);
    const invited = nextEvent(memberSocket, "session:invite");
    const call = await manager.as("post", `/sites/${world.siteId}/calls`).send({ userId: member.id });
    expect(call.status).toBe(201);
    await invited;
    const id = call.body.id as string;

    expect((await manager.as("post", `/sessions/${id}/accept`)).status).toBe(403);
    expect((await manager.as("post", `/sessions/${id}/decline`)).status).toBe(403);
    for (const path of [`/sessions/${id}`, `/sessions/${id}/messages`]) expect((await outsider.as("get", path)).status).toBe(404);
    for (const action of ["accept", "decline", "end"]) expect((await outsider.as("post", `/sessions/${id}/${action}`)).status).toBe(404);
    // 대조군: 받는 사람은 수락할 수 있다
    expect((await member.as("post", `/sessions/${id}/accept`)).status).toBe(200);
    expect((await member.as("get", `/sessions/${id}/messages`)).status).toBe(200);
    expect((await outsider.as("post", `/sessions/${id}/utterances`).field("clientMessageId", randomUUID()).attach("audio", m4a, { filename: "a.m4a", contentType: "audio/mp4" })).status).toBe(404);
    await manager.as("post", `/sessions/${id}/end`);
    managerSocket.disconnect();
    memberSocket.disconnect();
  });
});

describe("제외된 구성원 차단 보강 (시나리오 12)", () => {
  it("제외된 사람은 메시지를 보낼 수 없고, /sync 에 그 현장 메시지가 나오지 않는다 (대조군: 구성원은 나옴)", async () => {
    const { removed, member } = world.users;
    // 제외자의 1:1 대화를 직접 만들 수 없으므로 그룹 대화 id 로 확인한다
    const group = ((await member.as("get", `/sites/${world.siteId}/conversations`)).body as { id: string; type: string }[]).find((c) => c.type === "group")!;
    const sent = await removed.as("post", `/conversations/${group.id}/messages`).send({ clientMessageId: randomUUID(), text: "몰래 보내기" });
    expect(sent.status).toBe(404);

    const removedSync = (await removed.as("get", "/sync")).body as SyncResponse;
    expect(removedSync.messages.filter((m) => m.siteId === world.siteId)).toHaveLength(0);
    expect(removedSync.memberships).toContainEqual(expect.objectContaining({ siteId: world.siteId, status: "removed" }));
    const memberSync = (await member.as("get", "/sync")).body as SyncResponse;
    expect(memberSync.messages.some((m) => m.siteId === world.siteId)).toBe(true);
  });
});
