import { Router } from "express";
import { z } from "zod";
import { requireMembership, UUID } from "../../access/membership";
import type { AppContext } from "../../context";
import { audioUpload, sendLimiter } from "../../http/upload";
import { AppError } from "../../lib/errors";
import { conversationSummaries, ensureDirectConversation, requireParticipant, visibleTo } from "../../messaging/conversations";
import { createMessage } from "../../messaging/createMessage";
import { fullMessage, toMessageViews } from "../../messaging/views";
import type { SendResult } from "../../shared/api";

// 대화와 메시지 (docs/api-specification.md 5, 6, 8절)

const directInput = z.object({ userId: z.string().regex(UUID) });
const clientMessageId = z.string().trim().min(1).max(64);
const textInput = z.object({ clientMessageId, text: z.string().trim().min(1).max(1000) });
const audioFields = z.object({ clientMessageId });
const listQuery = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  beforeSeq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const audioQuery = z.object({
  lang: z.string(),
  u: z.string().regex(UUID),
  exp: z.string(),
  sig: z.string(),
});

const idParam = (value: unknown) => {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw new AppError("NOT_FOUND", "찾을 수 없습니다.");
  return id;
};

/** 음성 다운로드: 서명 URL 로 인증한다 (requireAuth 앞에 붙인다). */
export function audioRouter(context: AppContext): Router {
  const router = Router();
  const { prisma, audioUrls, storage } = context;

  router.get("/messages/:messageId/audio", async (req, res) => {
    const messageId = idParam(req.params["messageId"]);
    const query = audioQuery.safeParse(req.query);
    if (!query.success || !audioUrls.verify(messageId, query.data)) {
      throw new AppError("UNAUTHORIZED", "음성 링크가 만료되었거나 유효하지 않습니다.");
    }
    const { lang, u: userId } = query.data;
    // 서명 이후 권한이 바뀌었을 수 있으므로 다시 확인: 해당 언어의 수신자이고, 현장의 활성 멤버
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { recipients: { where: { userId } }, translations: { where: { targetLang: lang } } },
    });
    const recipient = message?.recipients[0];
    const translation = message?.translations[0];
    const membership = message
      ? await prisma.siteMembership.findUnique({ where: { siteId_userId: { siteId: message.siteId, userId } } })
      : null;
    if (!recipient || recipient.targetLang !== lang || membership?.status !== "active" || !translation?.audioPath) {
      throw new AppError("NOT_FOUND", "음성을 찾을 수 없습니다.");
    }
    const wav = await storage.read(translation.audioPath);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(wav);
  });

  return router;
}

export function conversationsRouter(context: AppContext): Router {
  const router = Router();
  const { prisma, audioUrls } = context;
  const member = requireMembership(context);

  const limiter = sendLimiter(context);

  // ─── 대화 ───────────────────────────────────────

  router.get("/sites/:siteId/conversations", member, async (req, res) => {
    res.json(await conversationSummaries(prisma, audioUrls, req.membership!.siteId, req.auth!.userId));
  });

  /** 1:1 대화 열기 (멱등): 같은 두 사람의 대화는 현장당 1개 */
  router.post("/sites/:siteId/conversations/direct", member, async (req, res) => {
    const { userId: peerId } = directInput.parse(req.body);
    const siteId = req.membership!.siteId;
    const userId = req.auth!.userId;
    if (peerId === userId) throw new AppError("VALIDATION_ERROR", "자기 자신과는 대화를 만들 수 없습니다.");
    const peer = await prisma.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId: peerId } } });
    if (!peer || peer.status !== "active") throw new AppError("NOT_FOUND", "멤버를 찾을 수 없습니다.");

    const { conversation, created } = await ensureDirectConversation(prisma, siteId, userId, peerId);
    const [summary] = await conversationSummaries(prisma, audioUrls, siteId, userId, [conversation.id]);
    res.status(created ? 201 : 200).json(summary);
  });

  // ─── 메시지 ─────────────────────────────────────

  router.get("/conversations/:conversationId/messages", async (req, res) => {
    const conversationId = idParam(req.params["conversationId"]);
    const userId = req.auth!.userId;
    const { participant } = await requireParticipant(prisma, conversationId, userId);
    const { afterSeq, beforeSeq, limit } = listQuery.parse(req.query);

    const seq = {
      ...(afterSeq !== undefined ? { gt: BigInt(afterSeq) } : {}),
      ...(beforeSeq !== undefined ? { lt: BigInt(beforeSeq) } : {}),
    };
    // afterSeq 가 있으면 그 뒤부터 오래된 순, 아니면 최신 limit 개
    const newestFirst = afterSeq === undefined;
    const rows = await prisma.message.findMany({
      where: { conversationId, ...visibleTo(userId), ...(Object.keys(seq).length ? { seq } : {}) },
      orderBy: { seq: newestFirst ? "desc" : "asc" },
      take: limit,
      include: fullMessage,
    });
    if (newestFirst) rows.reverse();

    // 읽음 위치 갱신 (안 읽은 수 계산용)
    const lastSeq = rows.at(-1)?.seq;
    if (lastSeq !== undefined && lastSeq > participant.lastReadSeq) {
      await prisma.conversationParticipant.updateMany({
        where: { conversationId, userId, lastReadSeq: { lt: lastSeq } },
        data: { lastReadSeq: lastSeq },
      });
    }
    res.json(await toMessageViews(prisma, audioUrls, rows, userId));
  });

  /** 메시지 전송: JSON 텍스트 또는 multipart 음성 → 202, 처리 결과는 Socket.IO 로 */
  router.post("/conversations/:conversationId/messages", limiter, audioUpload, async (req, res) => {
    const conversationId = idParam(req.params["conversationId"]);
    const senderId = req.auth!.userId;
    const { conversation } = await requireParticipant(prisma, conversationId, senderId);
    const file = req.file;
    const input = file ? { ...audioFields.parse(req.body), text: null } : textInput.parse(req.body);

    // 수신자: 대화에 참여 중인 다른 사람 (활성 멤버 확인은 createMessage 가 한다)
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId, leftAt: null, userId: { not: senderId } },
      select: { userId: true },
    });
    const result = await createMessage(context, {
      siteId: conversation.siteId,
      kind: conversation.type as "direct" | "group",
      conversationId,
      senderId,
      clientMessageId: input.clientMessageId,
      text: input.text,
      ...(file ? { audio: { buffer: file.buffer, mimetype: file.mimetype } } : {}),
      recipientIds: participants.map((p) => p.userId),
    });
    res.status(result.httpStatus).json(result.body);
  });

  /** 실패한 언어만 다시 번역 (음성 인식 단계에서 실패했으면 인식부터) */
  router.post("/messages/:messageId/retry", async (req, res) => {
    const messageId = idParam(req.params["messageId"]);
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.senderId !== req.auth!.userId) throw new AppError("NOT_FOUND", "메시지를 찾을 수 없습니다.");
    const membership = await prisma.siteMembership.findUnique({
      where: { siteId_userId: { siteId: message.siteId, userId: message.senderId } },
    });
    if (membership?.status !== "active") throw new AppError("NOT_FOUND", "메시지를 찾을 수 없습니다.");
    if (message.status !== "failed" && message.status !== "partially_failed") {
      throw new AppError("CONFLICT", "실패한 메시지만 다시 보낼 수 있습니다.");
    }
    if ((message.inputType === "audio" && message.rawText === null && !context.stt) || !context.translator) {
      throw new AppError("OPENAI_NOT_CONFIGURED", "통역 엔진이 설정되지 않았습니다 (OpenAI API 키 필요).");
    }

    // 조건부 갱신: 동시에 두 번 눌러도 한 번만 다시 처리한다.
    const reset = await prisma.$transaction(async (tx) => {
      const { count } = await tx.message.updateMany({
        where: { id: messageId, status: { in: ["failed", "partially_failed"] } },
        data: { status: "queued", errorCode: null },
      });
      if (count === 0) return false;
      await tx.messageTranslation.updateMany({ where: { messageId, status: "failed" }, data: { status: "pending", errorCode: null } });
      await tx.messageRecipient.updateMany({ where: { messageId, status: "failed" }, data: { status: "pending" } });
      return true;
    });
    if (reset) context.pipeline.enqueue(messageId);
    res.status(202).json({ messageId, status: "queued" } satisfies SendResult);
  });

  return router;
}
