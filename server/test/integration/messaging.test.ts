import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AudioPreprocessor, PcmAudio } from "../../src/engine/audio/audioPreprocessor";
import type { Dataset } from "../../src/engine/dataset/types";
import { DomainProcessor } from "../../src/engine/domain/domainProcessor";
import { FakeStt, FakeTranslator } from "../../src/engine/fake";
import type { MessageView } from "../../src/shared/api";
import { createRealtimeTestApp, nextEvent, noEvent } from "../helpers/testApp";

// Phase 4: 통역 파이프라인 + 1:1 대화 (Fake 엔진, 실제 Postgres·Socket.IO)
// 시나리오: 5(1:1 양방향 음성), 6(지정 상대만), 9(부분 실패), 13(중복 전송), 14(노이즈 필터), 15(데이터셋 교체)

type RtApp = Awaited<ReturnType<typeof createRealtimeTestApp>>;
type User = Awaited<ReturnType<Awaited<ReturnType<RtApp["user"]>>["withProfile"]>>;

/** 번역 실패를 주입할 언어 (테스트마다 바꾼다) */
const failLangs = new Set<string>();
const stt = new FakeStt({ text: (lang) => (lang === "ko" ? "안전모 착용하세요" : "Tôi hiểu rồi") });
const translator = new FakeTranslator({ fail: ({ lang }) => failLangs.has(lang) });

let t: RtApp;
let originalDomain: DomainProcessor;

/** ffmpeg 로 만든 1초짜리 실제 m4a(AAC) 파일. 휴대폰 녹음처럼 moov 가 파일 끝에 있다. */
let m4a: Buffer;

beforeAll(async () => {
  t = await createRealtimeTestApp({ stt, translator });
  originalDomain = t.context.domain;
  const file = path.join(mkdtempSync(path.join(tmpdir(), "syncrew-m4a-")), "speech.m4a");
  execFileSync(ffmpegPath as unknown as string, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:a", "aac", file,
  ]);
  m4a = readFileSync(file);
  // moov 가 끝에 있는지 확인 (stdin 파이프로 읽으면 실패하는 형식)
  expect(m4a.indexOf("moov")).toBeGreaterThan(m4a.indexOf("mdat"));
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  failLangs.clear();
  t.context.domain = originalDomain;
});

/** 관리자(ko) + 승인된 구성원들 */
async function setupSite(workerLangs: string[]) {
  const manager = await (await t.user("김반장", "ko")).withProfile();
  const site = await manager.as("post", "/sites").send({ name: "통역 현장" });
  const siteId = site.body.id as string;
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

const openDirect = async (from: User, siteId: string, to: User) => {
  const res = await from.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: to.id });
  expect([200, 201]).toContain(res.status);
  return res.body.id as string;
};

const sendText = (from: User, conversationId: string, text: string, clientMessageId = randomUUID()) =>
  from.as("post", `/conversations/${conversationId}/messages`).send({ clientMessageId, text });

const sendAudio = (from: User, conversationId: string, clientMessageId = randomUUID()) =>
  from
    .as("post", `/conversations/${conversationId}/messages`)
    .field("clientMessageId", clientMessageId)
    .attach("audio", m4a, { filename: "speech.m4a", contentType: "audio/mp4" });

const groupOf = async (user: User, siteId: string) =>
  ((await user.as("get", `/sites/${siteId}/conversations`)).body as { id: string; type: string }[]).find((c) => c.type === "group")!.id;

describe("1:1 대화 열기", () => {
  it("같은 두 사람의 대화는 하나만 만들어지고(멱등), 양쪽 목록에 상대 이름으로 보인다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const worker = workers[0]!;
    const first = await manager.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: worker.id });
    const again = await worker.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: manager.id });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({ type: "direct", title: "작업자1", peer: { userId: worker.id, lang: "vi" }, participantCount: 2 });

    const list = (await worker.as("get", `/sites/${siteId}/conversations`)).body;
    expect(list.map((c: { type: string }) => c.type)).toEqual(["group", "direct"]);
    expect(list[1]).toMatchObject({ title: "김반장", peer: { userId: manager.id, lang: "ko" } });
  });

  it("자기 자신·비멤버·가입 대기자와는 대화를 열 수 없다", async () => {
    const { manager, siteId } = await setupSite([]);
    const outsider = await (await t.user()).withProfile();
    expect((await manager.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: manager.id })).status).toBe(400);
    expect((await manager.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: outsider.id })).status).toBe(404);
    // 비멤버는 현장 경로 자체가 404
    expect((await outsider.as("post", `/sites/${siteId}/conversations/direct`).send({ userId: manager.id })).status).toBe(404);
  });
});

describe("시나리오 5: 1:1 양방향 통역", () => {
  it("텍스트: 상대는 자기 언어 번역을 실시간으로 받고, 발신자는 처리 상태를 받는다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const worker = workers[0]!;
    const conversationId = await openDirect(manager, siteId, worker);
    const managerSocket = await t.connected(manager.token);
    const workerSocket = await t.connected(worker.token);

    const received = nextEvent(workerSocket, "message:new");
    const sent = await sendText(manager, conversationId, "안전모 착용하세요");
    expect(sent.status).toBe(202);
    expect(sent.body).toMatchObject({ status: "queued" });

    const { message } = await received;
    expect(message).toMatchObject({
      id: sent.body.messageId,
      kind: "direct",
      conversationId,
      senderId: manager.id,
      senderName: "김반장",
      sourceLang: "ko",
      originalText: "안전모 착용하세요",
      text: "[vi] 안전모 착용하세요",
      myStatus: "sent",
    });
    expect(message.audioUrl).toMatch(/^\/api\/v1\/messages\/.+\/audio\?/);

    // 발신자: 최종 상태(done)까지 message:status 로 받는다
    let status;
    do status = await nextEvent(managerSocket, "message:status");
    while (status.status !== "done");
    expect(status.translations).toEqual([{ lang: "vi", status: "done", text: "[vi] 안전모 착용하세요" }]);
    expect(status.recipients).toMatchObject({ sent: 1, failed: 0 });

    // 조회: 사람마다 자기 언어로
    const asWorker = (await worker.as("get", `/conversations/${conversationId}/messages`)).body as MessageView[];
    const asManager = (await manager.as("get", `/conversations/${conversationId}/messages`)).body as MessageView[];
    expect(asWorker[0]).toMatchObject({ text: "[vi] 안전모 착용하세요", myStatus: "sent" });
    expect(asWorker[0]!.translations).toBeUndefined();
    expect(asManager[0]).toMatchObject({ text: "안전모 착용하세요", status: "done", translations: [{ lang: "vi", status: "done" }], audioUrl: null });
  });

  it("음성: m4a 업로드 → 디코딩(16kHz) → STT → 번역 → 번역 음성(WAV) 재생, 반대 방향도 동작한다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const worker = workers[0]!;
    const conversationId = await openDirect(manager, siteId, worker);
    const managerSocket = await t.connected(manager.token);
    const workerSocket = await t.connected(worker.token);

    const toWorker = nextEvent(workerSocket, "message:new");
    const callsBefore = stt.calls.length;
    expect((await sendAudio(manager, conversationId)).status).toBe(202);
    const { message } = await toWorker;
    expect(message).toMatchObject({ originalText: "안전모 착용하세요", text: "[vi] 안전모 착용하세요", sourceLang: "ko" });

    const sttInput = stt.calls[callsBefore]!;
    expect(sttInput.lang).toBe("ko");
    expect(sttInput.audio.sampleRate).toBe(16_000);
    expect(sttInput.audio.data.length / 16_000).toBeCloseTo(1, 1);

    const audio = await request(t.app).get(message.audioUrl!);
    expect(audio.status).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/wav");
    expect(Buffer.from(audio.body).subarray(0, 4).toString()).toBe("RIFF");

    // 반대 방향: 작업자(vi) → 관리자(ko)
    const toManager = nextEvent(managerSocket, "message:new");
    expect((await sendAudio(worker, conversationId)).status).toBe(202);
    expect((await toManager).message).toMatchObject({ senderId: worker.id, sourceLang: "vi", text: "[ko] Tôi hiểu rồi" });
  });

  it("음성 URL 은 서명이 틀리거나 다른 사람 것이면 거부된다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);
    await sendText(manager, conversationId, "확인");
    await t.context.pipeline.idle();
    const [view] = (await workers[0]!.as("get", `/conversations/${conversationId}/messages`)).body as MessageView[];
    const url = view!.audioUrl!;
    expect((await request(t.app).get(url)).status).toBe(200);
    expect((await request(t.app).get(url.replace(/sig=[^&]+/, "sig=forged"))).status).toBe(401);
    expect((await request(t.app).get(url.replace(/u=[^&]+/, `u=${manager.id}`))).status).toBe(401);
  });

  it("안 읽은 수: 받은 메시지는 늘고, 대화를 열면 0이 된다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const worker = workers[0]!;
    const conversationId = await openDirect(manager, siteId, worker);
    await sendText(manager, conversationId, "하나");
    await sendText(manager, conversationId, "둘");
    await t.context.pipeline.idle();
    const direct = async (user: User) =>
      ((await user.as("get", `/sites/${siteId}/conversations`)).body as { id: string; unreadCount: number; lastMessage?: { text: string } }[]).find(
        (c) => c.id === conversationId,
      )!;
    expect(await direct(worker)).toMatchObject({ unreadCount: 2, lastMessage: { text: "[vi] 둘" } });
    expect((await direct(manager)).unreadCount).toBe(0);
    await worker.as("get", `/conversations/${conversationId}/messages`);
    expect((await direct(worker)).unreadCount).toBe(0);
  });
});

describe("시나리오 6: 1:1 메시지는 지정된 상대에게만", () => {
  it("같은 현장의 다른 구성원은 받지 못하고, 대화 조회도 404", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "vi"]);
    const [peer, other] = workers as [User, User];
    const conversationId = await openDirect(manager, siteId, peer);
    const peerSocket = await t.connected(peer.token);
    const otherSocket = await t.connected(other.token);
    await peerSocket.timeout(3000).emitWithAck("site:subscribe", { siteId });
    await otherSocket.timeout(3000).emitWithAck("site:subscribe", { siteId });

    const toPeer = nextEvent(peerSocket, "message:new");
    const notToOther = noEvent(otherSocket, "message:new", 800);
    await sendText(manager, conversationId, "너만 봐");
    expect((await toPeer).message.text).toBe("[vi] 너만 봐"); // 대조군: 같은 상황에서 상대는 받는다
    await notToOther;

    expect((await other.as("get", `/conversations/${conversationId}/messages`)).status).toBe(404);
    expect((await sendText(other, conversationId, "끼어들기")).status).toBe(404);
  });
});

describe("시나리오 13: 같은 clientMessageId 재전송", () => {
  it("순차·동시 재전송 모두 메시지를 하나만 만들고 같은 id 를 돌려준다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);
    const clientMessageId = randomUUID();
    const first = await sendText(manager, conversationId, "중복 확인", clientMessageId);
    const again = await sendText(manager, conversationId, "중복 확인", clientMessageId);
    expect(first.status).toBe(202);
    expect(again.status).toBe(200);
    expect(again.body.messageId).toBe(first.body.messageId);

    const concurrentId = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => sendText(manager, conversationId, "동시", concurrentId)));
    expect(new Set(results.map((r) => r.body.messageId)).size).toBe(1);
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);

    await t.context.pipeline.idle();
    const count = await t.context.prisma.message.count({ where: { conversationId } });
    expect(count).toBe(2);
  });
});

describe("시나리오 9: 일부 언어 번역 실패", () => {
  it("실패한 언어 수신자만 failed, 다른 언어 수신자는 정상 수신. 재시도하면 실패한 언어만 다시 번역한다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "zh", "ko"]);
    const [vi, zh, ko] = workers as [User, User, User];
    const group = await groupOf(manager, siteId);
    const zhSocket = await t.connected(zh.token);
    const viSocket = await t.connected(vi.token);
    const koSocket = await t.connected(ko.token);

    failLangs.add("zh");
    const viReceived = nextEvent(viSocket, "message:new");
    const koReceived = nextEvent(koSocket, "message:new");
    const zhNothing = noEvent(zhSocket, "message:new", 800);
    const callsBefore = translator.calls.length;
    const sent = await sendText(manager, group, "작업 중지");
    expect((await viReceived).message.text).toBe("[vi] 작업 중지");
    // 같은 언어(ko) 수신자는 번역 없이 원문
    expect((await koReceived).message).toMatchObject({ text: "작업 중지", audioUrl: null });
    await zhNothing;
    await t.context.pipeline.idle();

    const messageId = sent.body.messageId as string;
    const stored = await t.context.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { translations: true, recipients: true } });
    expect(stored.status).toBe("partially_failed");
    expect(Object.fromEntries(stored.translations.map((tr) => [tr.targetLang, [tr.status, tr.attempts]]))).toEqual({
      vi: ["done", 1],
      zh: ["failed", 3], // 1회 + 재시도 2회
      ko: ["skipped", 0],
    });
    expect(Object.fromEntries(stored.recipients.map((r) => [r.userId, r.status]))).toEqual({ [vi.id]: "sent", [zh.id]: "failed", [ko.id]: "sent" });
    // 번역은 언어별 1회 시도씩 (ko 는 생략)
    expect(translator.calls.slice(callsBefore).map((c) => c.targetLang).sort()).toEqual(["vi", "zh", "zh", "zh"]);

    // 재시도: 다른 사람은 다시 받지 않고, zh 만 받는다
    failLangs.clear();
    const zhReceived = nextEvent(zhSocket, "message:new");
    const viNoDuplicate = noEvent(viSocket, "message:new", 800);
    const retry = await manager.as("post", `/messages/${messageId}/retry`);
    expect(retry.status).toBe(202);
    expect((await zhReceived).message.text).toBe("[zh] 작업 중지");
    await viNoDuplicate;
    await t.context.pipeline.idle();
    expect((await t.context.prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status).toBe("done");

    // 이미 끝난 메시지·다른 사람 메시지는 재시도 불가
    expect((await manager.as("post", `/messages/${messageId}/retry`)).status).toBe(409);
    expect((await vi.as("post", `/messages/${messageId}/retry`)).status).toBe(404);
  });

  it("음성 인식이 실패하면 메시지 전체가 failed 가 되고, 재시도하면 인식부터 다시 한다", async () => {
    const flaky = new FakeStt({ fail: ({ attempt }) => attempt <= 3 });
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);
    const original = t.context.stt;
    t.context.stt = flaky;
    try {
      const sent = await sendAudio(manager, conversationId);
      await t.context.pipeline.idle();
      const failed = await t.context.prisma.message.findUniqueOrThrow({ where: { id: sent.body.messageId }, include: { recipients: true } });
      expect(failed).toMatchObject({ status: "failed", errorCode: "STT_FAILED", rawText: null });
      expect(failed.recipients[0]!.status).toBe("failed");

      await manager.as("post", `/messages/${sent.body.messageId}/retry`);
      await t.context.pipeline.idle();
      const done = await t.context.prisma.message.findUniqueOrThrow({ where: { id: sent.body.messageId }, include: { recipients: true } });
      expect(done.status).toBe("done");
      expect(done.recipients[0]!.status).toBe("sent");
      expect(flaky.calls).toHaveLength(4);
    } finally {
      t.context.stt = original;
    }
  });
});

describe("시나리오 14: 노이즈 필터 플러그인", () => {
  it("교체한 전처리기가 16kHz PCM 으로 호출되고, 그 출력이 STT 에 들어간다", async () => {
    const seen: PcmAudio[] = [];
    const halve: AudioPreprocessor = {
      name: "test-filter",
      async process(audio) {
        seen.push(audio);
        return { data: audio.data.slice(0, audio.data.length / 2), sampleRate: audio.sampleRate };
      },
    };
    const original = t.context.audioPreprocessor;
    t.context.audioPreprocessor = halve;
    try {
      const { manager, siteId, workers } = await setupSite(["vi"]);
      const conversationId = await openDirect(manager, siteId, workers[0]!);
      const before = stt.calls.length;
      await sendAudio(manager, conversationId);
      await t.context.pipeline.idle();
      expect(seen).toHaveLength(1);
      expect(seen[0]!.sampleRate).toBe(16_000);
      expect(stt.calls[before]!.audio.data.length).toBe(Math.floor(seen[0]!.data.length / 2));
    } finally {
      t.context.audioPreprocessor = original;
    }
  });

  it("전처리기가 오류를 내면 원본 오디오로 통역을 계속한다", async () => {
    const original = t.context.audioPreprocessor;
    t.context.audioPreprocessor = { name: "broken", process: async () => Promise.reject(new Error("model crashed")) };
    try {
      const { manager, siteId, workers } = await setupSite(["vi"]);
      const conversationId = await openDirect(manager, siteId, workers[0]!);
      const sent = await sendAudio(manager, conversationId);
      await t.context.pipeline.idle();
      const stored = await t.context.prisma.message.findUniqueOrThrow({ where: { id: sent.body.messageId } });
      expect(stored.status).toBe("done");
      expect(stored.timings).toMatchObject({ preprocessApplied: false });
    } finally {
      t.context.audioPreprocessor = original;
    }
  });
});

describe("시나리오 15: 데이터셋 교체", () => {
  it("교체한 데이터셋의 용어로 원문이 보정되고, 번역기에 보정문·용어 컨텍스트가 전달된다", async () => {
    const dataset: Dataset = {
      name: "swap-test",
      version: "1",
      lexicon: [
        { id: "X1", lang: "ko", canonical: "비계발판", variants: [], asrCorrections: ["삐계발판"], translations: { vi: "sàn giàn giáo" }, meaning: "비계 작업 발판" },
      ],
      phrases: [],
    };
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);

    // 기본 데이터셋: 보정 없음 (대조군)
    const before = translator.calls.length;
    await sendText(manager, conversationId, "삐계발판 설치하세요");
    await t.context.pipeline.idle();
    expect(translator.calls[before]!.text).toBe("삐계발판 설치하세요");

    t.context.domain = new DomainProcessor(dataset);
    const sent = await sendText(manager, conversationId, "삐계발판 설치하세요");
    await t.context.pipeline.idle();
    const call = translator.calls.at(-1)!;
    expect(call.text).toBe("비계발판 설치하세요");
    expect(call.context.terms).toEqual([{ source: "비계발판", target: "sàn giàn giáo", meaning: "비계 작업 발판" }]);
    const stored = await t.context.prisma.message.findUniqueOrThrow({ where: { id: sent.body.messageId } });
    expect(stored).toMatchObject({ rawText: "삐계발판 설치하세요", correctedText: "비계발판 설치하세요" });
  });
});

describe("수신 확인 · 동기화 · 복구 · 엔진 없음", () => {
  it("receipt:delivered: 본인이 수신자인 메시지만 delivered 로 바뀐다 (멱등)", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const worker = workers[0]!;
    const conversationId = await openDirect(manager, siteId, worker);
    const sent = await sendText(manager, conversationId, "확인 바람");
    await t.context.pipeline.idle();
    const messageIds = [sent.body.messageId as string];

    const managerSocket = await t.connected(manager.token);
    expect(await managerSocket.timeout(3000).emitWithAck("receipt:delivered", { messageIds })).toEqual({ ok: true, updated: 0 });
    const workerSocket = await t.connected(worker.token);
    expect(await workerSocket.timeout(3000).emitWithAck("receipt:delivered", { messageIds })).toEqual({ ok: true, updated: 1 });
    expect(await workerSocket.timeout(3000).emitWithAck("receipt:delivered", { messageIds })).toEqual({ ok: true, updated: 0 });
    const recipient = await t.context.prisma.messageRecipient.findFirstOrThrow({ where: { messageId: messageIds[0] } });
    expect(recipient.status).toBe("delivered");
    expect(recipient.deliveredAt).not.toBeNull();
  });

  it("GET /sync: since 이후 받은 메시지와 대화 요약을 돌려준다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const worker = workers[0]!;
    const conversationId = await openDirect(manager, siteId, worker);
    await sendText(manager, conversationId, "이전 메시지");
    await t.context.pipeline.idle();
    const { cursor } = (await worker.as("get", `/sync?siteId=${siteId}`)).body;

    await sendText(manager, conversationId, "끊긴 동안 온 메시지");
    await t.context.pipeline.idle();
    const sync = (await worker.as("get", `/sync?siteId=${siteId}&since=${encodeURIComponent(cursor)}`)).body;
    expect(sync.messages.map((m: MessageView) => m.text)).toEqual(["[vi] 끊긴 동안 온 메시지"]);
    expect(sync.conversations).toEqual([expect.objectContaining({ id: conversationId, lastMessage: expect.objectContaining({ text: "[vi] 끊긴 동안 온 메시지" }) })]);
  });

  it("DB 시각과 서버 시각이 같다 (세션 시간대 UTC 고정 — 어긋나면 복구·동기화 비교가 틀어진다)", async () => {
    const [row] = await t.context.prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
    expect(Math.abs(row!.now.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("서버 재시작 복구: 처리 도중 멈춘 메시지를 다시 처리해 전달한다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);
    // 서버가 처리 중에 죽은 상황을 DB 에 직접 만든다 (번역 processing, 3분 전)
    const message = await t.context.prisma.message.create({
      data: {
        siteId,
        conversationId,
        kind: "direct",
        senderId: manager.id,
        clientMessageId: randomUUID(),
        inputType: "text",
        sourceLang: "ko",
        rawText: "멈췄던 메시지",
        status: "processing",
        translations: { create: [{ targetLang: "vi", status: "processing" }] },
        recipients: { create: [{ userId: workers[0]!.id, targetLang: "vi" }] },
      },
    });
    await t.context.prisma.$executeRaw`UPDATE messages SET updated_at = now() - interval '3 minutes' WHERE id = ${message.id}::uuid`;
    await t.context.prisma.$executeRaw`UPDATE message_translations SET updated_at = now() - interval '3 minutes' WHERE message_id = ${message.id}::uuid`;

    const workerSocket = await t.connected(workers[0]!.token);
    const received = nextEvent(workerSocket, "message:new");
    expect(await t.context.pipeline.recover()).toBeGreaterThanOrEqual(1);
    expect((await received).message).toMatchObject({ id: message.id, text: "[vi] 멈췄던 메시지" });
    await t.context.pipeline.idle();
    expect((await t.context.prisma.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe("done");
  });

  it("엔진이 없으면 번역이 필요한 메시지는 503, 같은 언어끼리는 그대로 전달된다", async () => {
    const { manager, siteId, workers } = await setupSite(["vi", "ko"]);
    const [vi, ko] = workers as [User, User];
    const original = { stt: t.context.stt, translator: t.context.translator };
    t.context.stt = null;
    t.context.translator = null;
    try {
      const toVi = await openDirect(manager, siteId, vi);
      const toKo = await openDirect(manager, siteId, ko);
      const blocked = await sendText(manager, toVi, "번역 필요");
      expect(blocked.status).toBe(503);
      expect(blocked.body.error.code).toBe("OPENAI_NOT_CONFIGURED");
      expect((await sendAudio(manager, toKo)).status).toBe(503);
      expect((await sendText(manager, toKo, "같은 언어")).status).toBe(202);
      await t.context.pipeline.idle();
      const [view] = (await ko.as("get", `/conversations/${toKo}/messages`)).body as MessageView[];
      expect(view).toMatchObject({ text: "같은 언어", status: "done" });
    } finally {
      Object.assign(t.context, original);
    }
  });

  it("제외된 구성원은 대화·음성 URL 에 접근할 수 없다 (시나리오 12)", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const worker = workers[0]!;
    const conversationId = await openDirect(manager, siteId, worker);
    await sendText(manager, conversationId, "제외 전 메시지");
    await t.context.pipeline.idle();
    const [view] = (await worker.as("get", `/conversations/${conversationId}/messages`)).body as MessageView[];

    await manager.as("patch", `/sites/${siteId}/members/${worker.id}`).send({ action: "remove" });
    expect((await worker.as("get", `/conversations/${conversationId}/messages`)).status).toBe(404);
    expect((await request(t.app).get(view!.audioUrl!)).status).toBe(404);
    // 관리자 쪽에서도 더 보낼 상대가 없다
    expect((await sendText(manager, conversationId, "제외 후")).status).toBe(409);
  });

  it("입력 검증: 빈 텍스트·긴 텍스트·형식 오류는 400", async () => {
    const { manager, siteId, workers } = await setupSite(["vi"]);
    const conversationId = await openDirect(manager, siteId, workers[0]!);
    expect((await sendText(manager, conversationId, "   ")).status).toBe(400);
    expect((await sendText(manager, conversationId, "가".repeat(1001))).status).toBe(400);
    expect((await manager.as("post", `/conversations/${conversationId}/messages`).send({ text: "id 없음" })).status).toBe(400);
    expect((await manager.as("get", "/conversations/not-a-uuid/messages")).status).toBe(404);
  });
});
