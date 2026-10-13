import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import type { LiveSession } from "../../src/shared/api";
import { ensureDirectConversation } from "../../src/messaging/conversations";
import { recoverOnStartup } from "../../src/startup";
import { createTestApp } from "../helpers/testApp";

// 서버 재시작 복구 (src/startup.ts, index.ts 가 시작 직후 부른다)
//  - 이전 실행에서 열린 채 남은 통역 세션(울림·진행 중)을 connection_lost 로 닫는다 (끝난 세션은 그대로)
//  - 처리 도중 멈춘 메시지를 다시 처리한다
// 같은 DB 를 쓰는 다른 테스트 파일과 섞이지 않도록 이 테스트의 현장만 범위로 준다 (대조군: 범위 밖 현장은 그대로).

type App = Awaited<ReturnType<typeof createTestApp>>;
let t: App;
beforeAll(async () => {
  t = await createTestApp({ stt: new FakeStt(), translator: new FakeTranslator() });
});
afterAll(async () => {
  await t.close();
});

async function setupSite(workerLangs: string[]) {
  const manager = await (await t.user("관리자", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "재시작 현장" })).body.id as string;
  const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
  const workers = [];
  for (const [index, lang] of workerLangs.entries()) {
    const worker = await (await t.user(`작업자${index + 1}`, lang)).withProfile();
    await worker.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
    workers.push(worker);
  }
  return { manager, siteId, workers };
}

/** 실시간 연결 없이 세션 행을 직접 만든다 (재시작 전 상태 재현) */
async function openSession(siteId: string, startedBy: string, otherId: string, status: "ringing" | "active" | "ended") {
  const now = new Date();
  const { conversation } = await ensureDirectConversation(t.context.prisma, siteId, startedBy, otherId);
  return t.context.prisma.liveSession.create({
    data: {
      siteId,
      mode: "call",
      conversationId: conversation.id,
      status,
      startedBy,
      answeredAt: status === "ringing" ? null : now,
      ...(status === "ended" ? { endedAt: now, endReason: "hangup" } : {}),
      participants: { create: [{ userId: startedBy, role: "caller", joinedAt: now }, { userId: otherId, role: "callee" }] },
    },
  });
}

describe("서버 시작 시 정리 (recoverOnStartup)", () => {
  it("열린 세션은 connection_lost 로 닫고 끝난 세션·범위 밖 현장은 그대로, 멈춘 메시지는 다시 처리한다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "zh"]);
    const active = await openSession(siteId, manager.id, workers[0]!.id, "active");
    const ringing = await openSession(siteId, manager.id, workers[1]!.id, "ringing");
    const ended = await openSession(siteId, workers[0]!.id, workers[1]!.id, "ended");
    // 대조군: 다른 현장(범위 밖)의 진행 중 세션
    const other = await setupSite(["vi"]);
    const otherActive = await openSession(other.siteId, other.manager.id, other.workers[0]!.id, "active");

    // 처리 도중 서버가 멈춘 메시지 (지시)
    const stuck = await t.context.prisma.message.create({
      data: {
        siteId,
        kind: "instruction",
        senderId: manager.id,
        clientMessageId: randomUUID(),
        inputType: "text",
        sourceLang: "ko",
        rawText: "재시작 전에 보낸 지시",
        status: "processing",
        translations: { create: [{ targetLang: "vi", status: "processing" }] },
        recipients: { create: [{ userId: workers[0]!.id, targetLang: "vi" }] },
      },
    });

    const result = await recoverOnStartup(t.context, { siteIds: [siteId] });
    expect(result).toEqual({ closedSessions: 2, requeuedMessages: 1 });

    const rows = await t.context.prisma.liveSession.findMany({ where: { id: { in: [active.id, ringing.id, ended.id, otherActive.id] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(active.id)).toMatchObject({ status: "ended", endReason: "connection_lost" });
    expect(byId.get(ringing.id)).toMatchObject({ status: "ended", endReason: "connection_lost" });
    expect(byId.get(ended.id)).toMatchObject({ status: "ended", endReason: "hangup" });
    expect(byId.get(otherActive.id)).toMatchObject({ status: "active", endReason: null });

    // 앱이 다시 연결해 열린 세션을 물으면 없다 (화면은 통화 종료로)
    expect((await manager.as("get", `/sites/${siteId}/sessions/open`)).body as LiveSession[]).toEqual([]);

    await t.context.pipeline.idle();
    const recovered = await t.context.prisma.message.findUniqueOrThrow({ where: { id: stuck.id }, include: { translations: true } });
    expect(recovered.status).toBe("done");
    expect(recovered.translations[0]).toMatchObject({ status: "done", translatedText: "[vi] 재시작 전에 보낸 지시" });

    // 두 번 불러도 안전 (이미 닫힌 세션·끝난 메시지는 건드리지 않음)
    expect(await recoverOnStartup(t.context, { siteIds: [siteId] })).toEqual({ closedSessions: 0, requeuedMessages: 0 });
    await t.context.prisma.liveSession.update({ where: { id: otherActive.id }, data: { status: "ended", endReason: "hangup", endedAt: new Date() } });
  });
});
