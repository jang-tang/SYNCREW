import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import type { InboxItem, InstructionDetail, InstructionSummary, MessageView } from "../../src/shared/api";
import { makeM4a } from "../helpers/audio";
import { createRealtimeTestApp, nextEvent } from "../helpers/testApp";

// 작성한 일괄 지시(문자·음성)와 확인·완료 응답, 그룹 대화 (시나리오 7, 8, 10)

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
type User = Awaited<ReturnType<Awaited<ReturnType<RtApp["user"]>>["withProfile"]>>;

let t: RtApp;
beforeAll(async () => {
  t = await createRealtimeTestApp({ stt: new FakeStt({ text: () => "안전 점검 시작" }), translator: new FakeTranslator() });
});
afterAll(async () => {
  await t.close();
});

async function setupSite(workerLangs: string[]) {
  const manager = await (await t.user("김반장", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "지시 현장" })).body.id as string;
  const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
  const workers: User[] = [];
  for (const [index, lang] of workerLangs.entries()) {
    const worker = await (await t.user(`작업자${index + 1}`, lang)).withProfile();
    await worker.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
    workers.push(worker);
  }
  return { manager, siteId, workers };
}

const instruct = (manager: User, siteId: string, text: string, target: unknown = "all", requiresAck = true) =>
  manager.as("post", `/sites/${siteId}/instructions`).send({ clientMessageId: randomUUID(), text, target, requiresAck });

describe("시나리오 8: 작성한 일괄 지시", () => {
  it("여러 언어 구성원이 각자 언어로 받고, 확인·완료 응답이 관리자에게 실시간으로 집계된다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "uz"]);
    const [vi, uz] = workers as [User, User];
    const managerSocket = await t.connected(manager.token);
    await managerSocket.timeout(3000).emitWithAck("site:subscribe", { siteId });
    const viSocket = await t.connected(vi.token);
    const uzSocket = await t.connected(uz.token);

    const viNew = nextEvent(viSocket, "message:new");
    const uzNew = nextEvent(uzSocket, "message:new");
    const sent = await instruct(manager, siteId, "안전모 착용");
    expect(sent.status).toBe(202);
    expect((await viNew).message).toMatchObject({ kind: "instruction", text: "[vi] 안전모 착용", requiresAck: true, sessionId: null });
    expect((await uzNew).message.text).toBe("[uz] 안전모 착용");
    await t.context.pipeline.idle();
    const messageId = sent.body.messageId as string;

    // 단말 수신 확인 → delivered → 관리자에게 instruction:recipient
    const delivered = nextEvent(managerSocket, "instruction:recipient");
    await viSocket.timeout(3000).emitWithAck("receipt:delivered", { messageIds: [messageId] });
    expect(await delivered).toMatchObject({ messageId, userId: vi.id, status: "delivered" });

    const acked = nextEvent(managerSocket, "instruction:recipient");
    expect((await vi.as("post", `/instructions/${messageId}/ack`)).status).toBe(204);
    expect((await acked).status).toBe("acknowledged");
    expect((await uz.as("post", `/instructions/${messageId}/complete`).send({ note: "완료" })).status).toBe(204);
    // 멱등: 완료 뒤 확인을 눌러도 되돌아가지 않는다
    expect((await uz.as("post", `/instructions/${messageId}/ack`)).status).toBe(204);

    const list = (await manager.as("get", `/sites/${siteId}/instructions`)).body as InstructionSummary[];
    expect(list[0]).toMatchObject({ id: messageId, total: 2, counts: { acknowledged: 1, completed: 1 }, status: "done" });
    const detail = (await manager.as("get", `/instructions/${messageId}`)).body as InstructionDetail;
    expect(detail.recipients.map((r) => [r.displayName, r.lang, r.status, r.responseNote])).toEqual([
      ["작업자1", "vi", "acknowledged", null],
      ["작업자2", "uz", "completed", "완료"],
    ]);
    expect(detail.translations.map((tr) => [tr.lang, tr.text]).sort()).toEqual([["uz", "[uz] 안전모 착용"], ["vi", "[vi] 안전모 착용"]]);
  });

  it("음성 지시(multipart, target 은 JSON 문자열)와 선택 대상", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "zh"]);
    const sent = await manager
      .as("post", `/sites/${siteId}/instructions`)
      .field("clientMessageId", randomUUID())
      .field("target", JSON.stringify({ userIds: [workers[1]!.id] }))
      .field("requiresAck", "false")
      .attach("audio", makeM4a(), { filename: "speech.m4a", contentType: "audio/mp4" });
    expect(sent.status).toBe(202);
    await t.context.pipeline.idle();
    const zhInbox = (await workers[1]!.as("get", `/sites/${siteId}/inbox`)).body as InboxItem[];
    expect(zhInbox.map((i) => [i.text, i.requiresAck, i.myStatus])).toEqual([["[zh] 안전 점검 시작", false, "sent"]]);
    expect((await workers[0]!.as("get", `/sites/${siteId}/inbox`)).body).toEqual([]);
  });

  it("권한: 구성원은 지시를 보내거나 상세를 볼 수 없고, 받지 않은 지시에는 응답할 수 없다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "zh"]);
    expect((await instruct(workers[0]!, siteId, "몰래 지시")).status).toBe(403);
    const sent = await instruct(manager, siteId, "1번만", { userIds: [workers[0]!.id] });
    await t.context.pipeline.idle();
    const messageId = sent.body.messageId as string;
    expect((await workers[0]!.as("get", `/instructions/${messageId}`)).status).toBe(404);
    expect((await workers[1]!.as("post", `/instructions/${messageId}/ack`)).status).toBe(404);
    expect((await workers[0]!.as("get", `/sites/${siteId}/instructions`)).status).toBe(403);
  });

  it("시나리오 10: 오프라인이던 구성원은 다시 접속해 받은 지시·동기화로 누락분을 확인한다", async () => {
    const { manager, siteId, workers } = await setupSite(["ru"]);
    const worker = workers[0]!;
    const { cursor } = (await worker.as("get", `/sync?siteId=${siteId}`)).body;
    await instruct(manager, siteId, "자재 정리");
    await t.context.pipeline.idle();
    const sync = (await worker.as("get", `/sync?siteId=${siteId}&since=${encodeURIComponent(cursor)}`)).body as { messages: MessageView[] };
    expect(sync.messages.map((m) => [m.kind, m.text])).toEqual([["instruction", "[ru] 자재 정리"]]);
    expect(((await worker.as("get", `/sites/${siteId}/inbox`)).body as InboxItem[])[0]!.myStatus).toBe("sent");
  });
});

describe("시나리오 7: 그룹 대화", () => {
  it("현장 그룹 대화에서 각 참여자가 자기 언어로 받는다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "zh", "ko"]);
    const sockets = await Promise.all(workers.map((w) => t.connected(w.token)));
    const group = ((await manager.as("get", `/sites/${siteId}/conversations`)).body as { id: string; type: string }[]).find((c) => c.type === "group")!;
    const heard = sockets.map((s) => nextEvent(s, "message:new"));
    await manager.as("post", `/conversations/${group.id}/messages`).send({ clientMessageId: randomUUID(), text: "점심 12시" });
    const texts = await Promise.all(heard.map(async (h) => (await h).message.text));
    expect(texts).toEqual(["[vi] 점심 12시", "[zh] 점심 12시", "점심 12시"]);
  });
});
