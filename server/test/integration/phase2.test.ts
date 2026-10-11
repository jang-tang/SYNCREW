import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/testApp";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

/** 관리자가 현장을 만들고, 첫 가입 코드를 돌려준다 */
async function setupSite(name = "A동 신축 현장") {
  const manager = await (await t.user("관리자")).withProfile();
  const site = await manager.as("post", "/sites").send({ name, address: "안산" });
  expect(site.status).toBe(201);
  const codes = await manager.as("get", `/sites/${site.body.id}/join-codes`);
  return { manager, siteId: site.body.id as string, code: codes.body[0].code as string };
}

async function joinAndApprove(siteId: string, code: string, manager: Awaited<ReturnType<typeof setupSite>>["manager"], name = "Nguyễn", lang = "vi") {
  const worker = await (await t.user(name, lang)).withProfile();
  expect((await worker.as("post", "/join").send({ code })).status).toBe(201);
  expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" })).status).toBe(204);
  return worker;
}

describe("인증", () => {
  it("토큰이 없거나 잘못되면 401", async () => {
    expect((await request(t.app).get("/api/v1/me")).status).toBe(401);
    const bad = await request(t.app).get("/api/v1/me").set("Authorization", "Bearer not-a-jwt");
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("UNAUTHORIZED");
  });

  it("만료됐거나 다른 발급자의 토큰은 거부한다", async () => {
    const expired = await t.issuer.sign({ sub: crypto.randomUUID() }, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    expect((await request(t.app).get("/api/v1/me").set("Authorization", `Bearer ${expired}`)).status).toBe(401);
    const foreign = await t.issuer.sign({ sub: crypto.randomUUID() }, { issuer: "https://evil.example/auth/v1" });
    expect((await request(t.app).get("/api/v1/me").set("Authorization", `Bearer ${foreign}`)).status).toBe(401);
  });

  it("/health 는 인증 없이 열려 있다", async () => {
    expect((await request(t.app).get("/health")).status).toBe(200);
  });
});

describe("내 정보", () => {
  it("프로필이 없으면 404 PROFILE_REQUIRED, 만들면 조회된다 (시나리오 4: 언어 설정)", async () => {
    const user = await t.user();
    const before = await user.as("get", "/me");
    expect(before.status).toBe(404);
    expect(before.body.error.code).toBe("PROFILE_REQUIRED");

    const created = await user.as("put", "/me").send({ displayName: "  Aziz  ", preferredLang: "uz" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ id: user.id, displayName: "Aziz", preferredLang: "uz", autoPlay: true, speechRate: 1 });

    const updated = await user.as("put", "/me").send({ displayName: "Aziz", preferredLang: "ru", autoPlay: false, speechRate: 1.2 });
    expect(updated.body).toMatchObject({ preferredLang: "ru", autoPlay: false, speechRate: 1.2 });
    expect((await user.as("get", "/me")).body.preferredLang).toBe("ru");
  });

  it("입력 검증: 지원하지 않는 언어·빈 이름·범위 밖 속도", async () => {
    const user = await t.user();
    for (const body of [
      { displayName: "A", preferredLang: "th" },
      { displayName: "   ", preferredLang: "ko" },
      { displayName: "A", preferredLang: "ko", speechRate: 3 },
    ]) {
      const res = await user.as("put", "/me").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("프로필 없이 현장을 만들거나 참여할 수 없다", async () => {
    const user = await t.user();
    expect((await user.as("post", "/sites").send({ name: "X" })).body.error.code).toBe("PROFILE_REQUIRED");
    expect((await user.as("post", "/join").send({ code: "ABCDEFGH" })).body.error.code).toBe("PROFILE_REQUIRED");
  });

  it("지원 언어 목록", async () => {
    const user = await t.user();
    const res = await user.as("get", "/languages");
    expect(res.body.map((l: { code: string }) => l.code)).toEqual(["ko", "zh", "vi", "uz", "ru"]);
  });
});

describe("현장 생성 (시나리오 1)", () => {
  it("현장 + 관리자 멤버십 + 그룹 대화 + 첫 가입 코드가 함께 만들어진다", async () => {
    const { manager, siteId, code } = await setupSite();
    const sites = await manager.as("get", "/me/sites");
    expect(sites.body).toEqual([
      expect.objectContaining({ id: siteId, name: "A동 신축 현장", role: "manager", membershipStatus: "active", memberCount: 1 }),
    ]);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);

    const group = await t.context.prisma.conversation.findMany({ where: { siteId }, include: { participants: true } });
    expect(group).toHaveLength(1);
    expect(group[0]).toMatchObject({ type: "group" });
    expect(group[0]!.participants.map((p) => p.userId)).toEqual([manager.id]);
  });

  it("관리자는 현장 정보를 고칠 수 있다", async () => {
    const { manager, siteId } = await setupSite();
    const res = await manager.as("patch", `/sites/${siteId}`).send({ name: "A동 2공구", address: null });
    expect(res.body).toMatchObject({ name: "A동 2공구", address: null });
    expect((await manager.as("patch", `/sites/${siteId}`).send({})).status).toBe(400);
  });
});

describe("가입 요청과 승인 (시나리오 2, 3)", () => {
  it("코드로 참여 요청 → 대기 → 관리자 승인 → 활성 + 그룹 대화 참여", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await (await t.user("Nguyễn Văn An", "vi")).withProfile();

    // 소문자·하이픈 입력도 받아 준다
    const joined = await worker.as("post", "/join").send({ code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` });
    expect(joined.status).toBe(201);
    expect(joined.body).toEqual({ siteId, siteName: "A동 신축 현장", status: "pending" });
    expect(t.events).toContainEqual({
      type: "joinRequested",
      payload: { siteId, userId: worker.id, displayName: "Nguyễn Văn An", lang: "vi" },
    });

    // 같은 요청을 다시 보내도 중복 생성·횟수 증가 없음
    const again = await worker.as("post", "/join").send({ code });
    expect(again.status).toBe(200);
    expect((await t.context.prisma.siteJoinCode.findUnique({ where: { code } }))!.useCount).toBe(1);

    // 승인 전: 내 현장에는 대기로 보이고, 현장 데이터에는 접근 불가
    expect((await worker.as("get", "/me/sites")).body[0]).toMatchObject({ id: siteId, membershipStatus: "pending" });
    expect((await worker.as("get", `/sites/${siteId}`)).status).toBe(404);

    const pending = await manager.as("get", `/sites/${siteId}/members`);
    expect(pending.body).toContainEqual(expect.objectContaining({ userId: worker.id, status: "pending", lang: "vi", role: "member" }));

    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" })).status).toBe(204);
    expect(t.events).toContainEqual({ type: "membershipChanged", payload: { siteId, userId: worker.id, role: "member", status: "active" } });

    expect((await worker.as("get", `/sites/${siteId}`)).body).toMatchObject({ id: siteId, role: "member", memberCount: 2 });
    const participants = await t.context.prisma.conversationParticipant.findMany({ where: { conversation: { siteId } } });
    expect(participants.map((p) => p.userId).sort()).toEqual([manager.id, worker.id].sort());

    // 승인 후 다시 코드를 넣으면 이미 멤버
    const already = await worker.as("post", "/join").send({ code });
    expect(already.status).toBe(409);
    expect(already.body.error.code).toBe("ALREADY_MEMBER");
  });

  it("거절된 사용자는 대기 목록에서 사라지고, 다시 요청하면 대기로 돌아온다", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await (await t.user("Li", "zh")).withProfile();
    await worker.as("post", "/join").send({ code });
    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "reject" })).status).toBe(204);
    expect((await manager.as("get", `/sites/${siteId}/members`)).body.some((m: { userId: string }) => m.userId === worker.id)).toBe(false);
    expect((await worker.as("get", "/me/sites")).body[0].membershipStatus).toBe("rejected");
    // 이미 결정된 요청을 다시 거절하면 404 (목록에 없음)
    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "reject" })).status).toBe(404);

    expect((await worker.as("post", "/join").send({ code })).status).toBe(201);
    expect((await worker.as("get", "/me/sites")).body[0].membershipStatus).toBe("pending");
  });

  it("승인 대기가 아닌 멤버를 승인하면 409", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await joinAndApprove(siteId, code, manager);
    const res = await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
    expect(res.status).toBe(409);
  });
});

describe("가입 코드 규칙", () => {
  it("없는 코드·폐기·만료·횟수 소진은 INVALID_JOIN_CODE", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = async () => (await t.user()).withProfile();
    const expectInvalid = async (value: string) => {
      const res = await (await worker()).as("post", "/join").send({ code: value });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("INVALID_JOIN_CODE");
    };

    await expectInvalid("ZZZZZZZZ");

    const limited = await manager.as("post", `/sites/${siteId}/join-codes`).send({ maxUses: 1 });
    expect(limited.status).toBe(201);
    expect(limited.body.qrPayload).toBe(`syncrew://join?code=${limited.body.code}`);
    expect((await (await worker()).as("post", "/join").send({ code: limited.body.code })).status).toBe(201);
    await expectInvalid(limited.body.code);

    await t.context.prisma.siteJoinCode.update({ where: { code }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectInvalid(code);

    const fresh = await manager.as("post", `/sites/${siteId}/join-codes`).send({});
    expect((await manager.as("delete", `/sites/${siteId}/join-codes/${fresh.body.id}`)).status).toBe(204);
    await expectInvalid(fresh.body.code);

    // 유효한 코드만 목록에 나온다
    const listed = await manager.as("get", `/sites/${siteId}/join-codes`);
    expect(listed.body.map((c: { code: string }) => c.code)).not.toContain(fresh.body.code);
    expect(listed.body.map((c: { code: string }) => c.code)).not.toContain(code);
  });

  it("보관(archived)된 현장의 코드로는 참여할 수 없다", async () => {
    const { manager, siteId, code } = await setupSite();
    await manager.as("patch", `/sites/${siteId}`).send({ status: "archived" });
    const res = await (await (await t.user()).withProfile()).as("post", "/join").send({ code });
    expect(res.body.error.code).toBe("INVALID_JOIN_CODE");
  });

  it("코드 입력 속도 제한 (사용자당 1분 N회)", async () => {
    const limited = await createTestApp({ limits: { joinPerMinute: 3 } });
    try {
      const user = await (await limited.user()).withProfile();
      const statuses: number[] = [];
      for (let index = 0; index < 4; index += 1) statuses.push((await user.as("post", "/join").send({ code: "WRONGCOD" })).status);
      expect(statuses).toEqual([404, 404, 404, 429]);
      // 다른 사용자는 영향 없음
      const other = await (await limited.user()).withProfile();
      expect((await other.as("post", "/join").send({ code: "WRONGCOD" })).status).toBe(404);
    } finally {
      await limited.close();
    }
  });
});

describe("언어 (시나리오 4)", () => {
  it("작업자 언어 변경과 관리자 지정 언어가 멤버 목록에 반영된다", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await joinAndApprove(siteId, code, manager, "Иван", "ru");
    const langOf = async () =>
      (await manager.as("get", `/sites/${siteId}/members`)).body.find((m: { userId: string }) => m.userId === worker.id).lang;

    expect(await langOf()).toBe("ru");
    await worker.as("put", "/me").send({ displayName: "Иван", preferredLang: "uz" });
    expect(await langOf()).toBe("uz");
    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ langOverride: "zh" })).status).toBe(204);
    expect(await langOf()).toBe("zh");
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ langOverride: null });
    expect(await langOf()).toBe("uz");
    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ langOverride: "th" })).status).toBe(400);
  });
});

describe("권한과 현장 간 격리 (시나리오 11)", () => {
  it("다른 현장 사용자는 존재 여부도 알 수 없다 (404)", async () => {
    const a = await setupSite("A 현장");
    const b = await setupSite("B 현장");
    for (const path of [`/sites/${a.siteId}`, `/sites/${a.siteId}/members`, `/sites/${a.siteId}/join-codes`]) {
      const res = await b.manager.as("get", path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    expect((await b.manager.as("patch", `/sites/${a.siteId}/members/${a.manager.id}`).send({ action: "remove" })).status).toBe(404);
    expect((await b.manager.as("get", "/sites/not-a-uuid")).status).toBe(404);
  });

  it("구성원은 관리자 기능을 쓸 수 없다 (403) 및 대기 중 요청을 볼 수 없다", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await joinAndApprove(siteId, code, manager);
    const pendingUser = await (await t.user()).withProfile();
    await pendingUser.as("post", "/join").send({ code });

    expect((await worker.as("get", `/sites/${siteId}/join-codes`)).status).toBe(403);
    expect((await worker.as("post", `/sites/${siteId}/join-codes`).send({})).status).toBe(403);
    expect((await worker.as("patch", `/sites/${siteId}`).send({ name: "X" })).status).toBe(403);
    expect((await worker.as("patch", `/sites/${siteId}/members/${manager.id}`).send({ action: "remove" })).status).toBe(403);

    const visible = await worker.as("get", `/sites/${siteId}/members`);
    expect(visible.status).toBe(200);
    expect(visible.body.every((m: { status: string }) => m.status === "active")).toBe(true);
    expect(visible.body).toHaveLength(2);
  });
});

describe("멤버 제외 (시나리오 12)", () => {
  it("제외되면 즉시 현장 API 접근이 막히고 대화에서 나가며, 다시 요청하면 대기로 시작한다", async () => {
    const { manager, siteId, code } = await setupSite();
    const worker = await joinAndApprove(siteId, code, manager);

    expect((await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "remove" })).status).toBe(204);
    expect(t.events).toContainEqual({ type: "membershipChanged", payload: { siteId, userId: worker.id, role: "member", status: "removed" } });

    expect((await worker.as("get", `/sites/${siteId}`)).status).toBe(404);
    expect((await worker.as("get", `/sites/${siteId}/members`)).status).toBe(404);
    expect((await worker.as("get", "/me/sites")).body[0].membershipStatus).toBe("removed");
    const participant = await t.context.prisma.conversationParticipant.findFirst({ where: { userId: worker.id, conversation: { siteId } } });
    expect(participant!.leftAt).not.toBeNull();

    expect((await worker.as("post", "/join").send({ code })).status).toBe(201);
    expect((await worker.as("get", "/me/sites")).body[0]).toMatchObject({ membershipStatus: "pending", role: "member" });
  });

  it("관리자는 자기 자신을 제외할 수 없고, 마지막 관리자는 제외할 수 없다", async () => {
    const { manager, siteId } = await setupSite();
    expect((await manager.as("patch", `/sites/${siteId}/members/${manager.id}`).send({ action: "remove" })).status).toBe(403);

    // 관리자 2명 중 한 명이 다른 관리자를 제외: 남은 관리자가 있으면 가능
    const second = await (await t.user("부관리자")).withProfile();
    await t.context.prisma.siteMembership.create({ data: { siteId, userId: second.id, role: "manager", status: "active" } });
    expect((await second.as("patch", `/sites/${siteId}/members/${manager.id}`).send({ action: "remove" })).status).toBe(204);
  });
});

describe("DB 제약조건", () => {
  it("지원하지 않는 언어, 현장당 두 번째 그룹 대화를 거부한다", async () => {
    const { siteId } = await setupSite();
    await expect(
      t.context.prisma.profile.create({ data: { id: crypto.randomUUID(), email: "", displayName: "x", preferredLang: "th" } }),
    ).rejects.toThrow();
    await expect(t.context.prisma.conversation.create({ data: { siteId, type: "group" } })).rejects.toThrow();
    await expect(
      t.context.prisma.siteMembership.create({ data: { siteId, userId: (await (await t.user()).withProfile()).id, role: "owner", status: "active" } }),
    ).rejects.toThrow();
  });
});
