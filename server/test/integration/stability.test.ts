import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BudgetGuard, InMemoryUsageStore } from "../../src/engine/budget/budgetGuard";
import { buildPricingTable } from "../../src/engine/budget/pricing";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import { MAX_AUDIO_BYTES } from "../../src/http/upload";
import type { SyncResponse } from "../../src/shared/api";
import { makeM4a } from "../helpers/audio";
import { createRealtimeTestApp, nextEvent } from "../helpers/testApp";

// Phase 6 안정화: 중복 전송(시나리오 13 보강), 전송 속도·업로드 크기 제한, API 단계 비용 한도(시나리오 17 보강),
// 연결이 끊긴 동안 온 메시지의 재접속 동기화(시나리오 10 보강), 동시 메시지 처리량.

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
type User = Awaited<ReturnType<Awaited<ReturnType<RtApp["user"]>>["withProfile"]>>;

let t: RtApp;
let m4a: Buffer;
beforeAll(async () => {
  t = await createRealtimeTestApp({ stt: new FakeStt(), translator: new FakeTranslator() });
  m4a = makeM4a();
});
afterAll(async () => {
  await t.close();
});

async function setupSite(app: RtApp, workerLangs: string[]) {
  const manager = await (await app.user("관리자", "ko")).withProfile();
  const siteId = (await manager.as("post", "/sites").send({ name: "안정화 현장" })).body.id as string;
  const code = (await manager.as("get", `/sites/${siteId}/join-codes`)).body[0].code as string;
  const workers: User[] = [];
  for (const [index, lang] of workerLangs.entries()) {
    const worker = await (await app.user(`작업자${index + 1}`, lang)).withProfile();
    await worker.as("post", "/join").send({ code });
    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "approve" });
    workers.push(worker);
  }
  return { manager, siteId, workers };
}

const openDirect = async (from: User, siteId: string, to: User) =>
  (await from.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: to.id })).body.id as string;

describe("시나리오 13 보강: 지시·통화 발화의 중복 전송", () => {
  it("같은 clientMessageId 로 지시를 다시 보내면(동시 포함) 지시는 하나만 만들어진다", async () => {
    const { manager, siteId } = await setupSite(t, ["vi"]);
    const clientMessageId = randomUUID();
    const send = () => manager.as("post", `/sites/${siteId}/instructions`).send({ clientMessageId, text: "중복 지시", target: "all", requiresAck: true });
    const results = await Promise.all([send(), send(), send()]);
    expect(new Set(results.map((r) => r.body.messageId)).size).toBe(1);
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    await t.context.pipeline.idle();
    expect(await t.context.prisma.message.count({ where: { siteId, kind: "instruction" } })).toBe(1);
  });

  it("같은 clientMessageId 로 통화 발화를 다시 올려도 발화는 하나만 만들어진다", async () => {
    const { manager, siteId, workers } = await setupSite(t, ["vi"]);
    const workerSocket = await t.connected(workers[0]!.token);
    const invited = nextEvent(workerSocket, "session:invite");
    const call = (await manager.as("post", `/sites/${siteId}/calls`).send({ userId: workers[0]!.id })).body as { id: string };
    await invited;
    expect((await workers[0]!.as("post", `/sessions/${call.id}/accept`)).status).toBe(200);

    const clientMessageId = randomUUID();
    const utter = () =>
      manager
        .as("post", `/sessions/${call.id}/utterances`)
        .field("clientMessageId", clientMessageId)
        .attach("audio", m4a, { filename: "speech.m4a", contentType: "audio/mp4" });
    const first = await utter();
    const again = await utter();
    expect(first.status).toBe(202);
    expect(again.body.messageId).toBe(first.body.messageId);
    await t.context.pipeline.idle();
    expect(await t.context.prisma.message.count({ where: { sessionId: call.id } })).toBe(1);
    await manager.as("post", `/sessions/${call.id}/end`);
    workerSocket.disconnect();
  });
});

describe("입력 제한", () => {
  it("음성 파일이 2MB를 넘으면 VALIDATION_ERROR (대조군: 정상 크기는 202)", async () => {
    const { manager, siteId, workers } = await setupSite(t, ["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);
    const upload = (audio: Buffer) =>
      manager
        .as("post", `/conversations/${conversationId}/messages`)
        .field("clientMessageId", randomUUID())
        .attach("audio", audio, { filename: "speech.m4a", contentType: "audio/mp4" });
    const tooBig = await upload(Buffer.alloc(MAX_AUDIO_BYTES + 1));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe("VALIDATION_ERROR");
    expect((await upload(m4a)).status).toBe(202);
    await t.context.pipeline.idle();
  });

  it("음성 형식 허용 목록: 오디오가 아닌 형식은 업로드 단계에서 VALIDATION_ERROR, 웹의 'audio/webm;codecs=opus' 는 받는다", async () => {
    const { manager, siteId, workers } = await setupSite(t, ["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);
    const upload = (contentType: string, filename = "speech.m4a") =>
      manager
        .as("post", `/conversations/${conversationId}/messages`)
        .field("clientMessageId", randomUUID())
        .attach("audio", m4a, { filename, contentType });
    for (const type of ["image/png", "application/octet-stream", "text/plain", "video/mp4"]) {
      const res = await upload(type, "file.bin");
      expect(res.status, type).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await t.context.prisma.message.count({ where: { conversationId } })).toBe(0); // 거절된 업로드는 메시지를 만들지 않는다
    // 대조군: 앱이 실제로 보내는 형식
    expect((await upload("audio/mp4")).status).toBe(202);
    expect((await upload("audio/webm;codecs=opus", "speech.webm")).status).toBe(202);
    await t.context.pipeline.idle();
    const saved = await t.context.prisma.message.findMany({ where: { conversationId }, select: { inputAudioPath: true } });
    expect(saved.map((m) => m.inputAudioPath?.split(".").pop()).sort()).toEqual(["m4a", "webm"]);
  });

  it("전송 속도 제한: 사용자당 1분 N회를 넘으면 429, 다른 사용자는 영향 없음 (메시지·지시가 한도를 함께 쓴다)", async () => {
    const limited = await createRealtimeTestApp({ stt: new FakeStt(), translator: new FakeTranslator(), limits: { messagesPerMinute: 2 } });
    try {
      const { manager, siteId, workers } = await setupSite(limited, ["vi"]);
      const conversationId = await openDirect(manager, siteId, workers[0]!);
      const text = (from: User, conversation: string) =>
        from.as("post", `/conversations/${conversation}/messages`).send({ clientMessageId: randomUUID(), text: "안녕" });
      expect((await text(manager, conversationId)).status).toBe(202);
      expect((await manager.as("post", `/sites/${siteId}/instructions`).send({ clientMessageId: randomUUID(), text: "지시", target: "all", requiresAck: false })).status).toBe(202);
      const third = await text(manager, conversationId);
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe("RATE_LIMITED");
      expect((await text(workers[0]!, conversationId)).status).toBe(202);
      await limited.context.pipeline.idle();
    } finally {
      await limited.close();
    }
  });
});

describe("시나리오 17 보강: API 단계 비용 한도", () => {
  it("한도를 다 쓰면 번역이 필요한 전송은 BUDGET_EXCEEDED(402)로 거절되고 메시지가 만들어지지 않는다. 같은 언어끼리는 계속 보낼 수 있다", async () => {
    const original = t.context.budget;
    const { manager, siteId, workers } = await setupSite(t, ["vi", "ko"]);
    const toVi = await openDirect(manager, siteId, workers[0]!);
    const toKo = await openDirect(manager, siteId, workers[1]!);
    // 공유 DB 의 사용량을 건드리지 않도록 이 앱의 한도만 0으로 바꾼다
    t.context.budget = new BudgetGuard(new InMemoryUsageStore(), buildPricingTable(undefined), { limitUsd: 0, period: "total" });
    try {
      expect(t.context.env.ENGINE).toBe("openai");
      const rejected = await manager.as("post", `/conversations/${toVi}/messages`).send({ clientMessageId: randomUUID(), text: "번역 필요" });
      expect(rejected.status).toBe(402);
      expect(rejected.body.error.code).toBe("BUDGET_EXCEEDED");
      expect(await t.context.prisma.message.count({ where: { conversationId: toVi } })).toBe(0);
      // 대조군: 번역이 필요 없는 같은 언어 상대에게는 보낼 수 있다
      expect((await manager.as("post", `/conversations/${toKo}/messages`).send({ clientMessageId: randomUUID(), text: "같은 언어" })).status).toBe(202);
      await t.context.pipeline.idle();
    } finally {
      t.context.budget = original;
    }
  });
});

describe("시나리오 10 보강: 연결이 끊긴 동안 온 메시지", () => {
  it("실시간 연결이 끊긴 동안 온 메시지는 실시간으로 오지 않고, 다시 접속해 /sync(since) 로 빠짐없이 받는다", async () => {
    const { manager, siteId, workers } = await setupSite(t, ["vi"]);
    const worker = workers[0]!;
    const conversationId = await openDirect(manager, siteId, worker);

    // 연결 중 1건 → 실시간 수신 (대조군)
    let socket = await t.connected(worker.token);
    const live = nextEvent(socket, "message:new");
    await manager.as("post", `/conversations/${conversationId}/messages`).send({ clientMessageId: randomUUID(), text: "연결 중" });
    expect((await live).message.text).toBe("[vi] 연결 중");
    await t.context.pipeline.idle();
    const cursor = ((await worker.as("get", "/sync")).body as SyncResponse).cursor;

    // 연결 끊김 → 3건
    socket.disconnect();
    for (const text of ["끊김 1", "끊김 2", "끊김 3"]) {
      await manager.as("post", `/conversations/${conversationId}/messages`).send({ clientMessageId: randomUUID(), text });
    }
    await t.context.pipeline.idle();

    // 재접속: 실시간으로 지난 메시지가 다시 오지는 않으므로 동기화로 받는다
    socket = await t.connected(worker.token);
    const sync = (await worker.as("get", `/sync?since=${encodeURIComponent(cursor)}`)).body as SyncResponse;
    expect(sync.messages.map((m) => m.text)).toEqual(["[vi] 끊김 1", "[vi] 끊김 2", "[vi] 끊김 3"]);
    expect(sync.conversations.find((c) => c.id === conversationId)).toBeDefined();
    // 대화 화면 다시 불러오기(앱의 재연결 시 쿼리 무효화)에도 4건이 순서대로 있다
    const history = (await worker.as("get", `/conversations/${conversationId}/messages`)).body as { items?: { text: string }[] } | { text: string }[];
    const items = Array.isArray(history) ? history : (history.items ?? []);
    expect(items.map((m) => m.text)).toEqual(expect.arrayContaining(["[vi] 연결 중", "[vi] 끊김 1", "[vi] 끊김 2", "[vi] 끊김 3"]));
    socket.disconnect();
  });
});

describe("동시 메시지 처리량 (가짜 엔진, 번역 1건 100ms, 동시 처리 4)", () => {
  it("구성원 8명이 동시에 5건씩(40건) 보내도 모두 한 번씩만 관리자에게 전달된다", async () => {
    const app = await createRealtimeTestApp({
      stt: new FakeStt(),
      translator: new FakeTranslator({ delayMs: 100 }),
      pipeline: { concurrency: 4 },
    });
    try {
      const langs = ["vi", "zh", "uz", "ru", "vi", "zh", "uz", "ru"];
      const { manager, siteId, workers } = await setupSite(app, langs);
      const conversations = await Promise.all(workers.map((w) => openDirect(w, siteId, manager)));
      const managerSocket = await app.connected(manager.token);
      const received: string[] = [];
      managerSocket.on("message:new", ({ message }) => received.push(message.id));

      const started = performance.now();
      const sends = workers.flatMap((worker, index) =>
        [1, 2, 3, 4, 5].map((n) =>
          worker.as("post", `/conversations/${conversations[index]}/messages`).send({ clientMessageId: randomUUID(), text: `작업 보고 ${n}` }),
        ),
      );
      const responses = await Promise.all(sends);
      const accepted = performance.now() - started;
      expect(responses.every((r) => r.status === 202)).toBe(true);
      await app.context.pipeline.idle();
      const done = performance.now() - started;
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(received).toHaveLength(40);
      expect(new Set(received).size).toBe(40);
      const statuses = await app.context.prisma.message.groupBy({ by: ["status"], where: { siteId }, _count: true });
      expect(statuses).toEqual([expect.objectContaining({ status: "done", _count: 40 })]);
      // 기록용 (docs/phase6-report.md): 40건 × 100ms / 동시 4 ≈ 1초가 이론 하한
      console.log(`[처리량] 40건 접수 ${accepted.toFixed(0)}ms, 전체 번역·전달 ${done.toFixed(0)}ms`);
      managerSocket.disconnect();
    } finally {
      await app.close();
    }
  });
});
