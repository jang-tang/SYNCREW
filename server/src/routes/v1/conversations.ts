import { randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { requireMembership, UUID } from "../../access/membership";
import type { AppContext } from "../../context";
import { Prisma } from "../../generated/prisma/client";
import { AppError } from "../../lib/errors";
import { conversationSummaries, requireParticipant, siteLangs, visibleTo } from "../../messaging/conversations";
import { fullMessage, toMessageViews } from "../../messaging/views";
import type { MessageStatus, SendResult } from "../../shared/api";

// 대화와 메시지 (docs/api-specification.md 5, 6, 8절)

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/3gpp": "3gp",
};

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

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

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

  const sendLimiter = rateLimit({
    windowMs: 60_000,
    limit: context.limits.messagesPerMinute,
    keyGenerator: (req) => req.auth!.userId,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.")),
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 5 } });
  const audioUpload: RequestHandler = (req, res, next) => {
    upload.single("audio")(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        const message = error.code === "LIMIT_FILE_SIZE" ? "음성 파일은 2MB 이하여야 합니다." : `업로드 오류: ${error.code}`;
        return next(new AppError("VALIDATION_ERROR", message));
      }
      next(error as Error | undefined);
    });
  };

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

    const directKey = [userId, peerId].sort().join(":");
    const find = () => prisma.conversation.findFirst({ where: { siteId, type: "direct", directKey } });
    let conversation = await find();
    let created = false;
    if (!conversation) {
      try {
        conversation = await prisma.conversation.create({
          data: { siteId, type: "direct", directKey, participants: { create: [{ userId }, { userId: peerId }] } },
        });
        created = true;
      } catch (error) {
        // 두 사람이 동시에 열면 한쪽만 생성된다.
        if (!isUniqueViolation(error)) throw error;
        conversation = (await find())!;
      }
    }
    if (!created) {
      // 제외됐다가 다시 승인된 경우 등: 두 사람 모두 다시 참여시킨다.
      for (const id of [userId, peerId]) {
        await prisma.conversationParticipant.upsert({
          where: { conversationId_userId: { conversationId: conversation.id, userId: id } },
          create: { conversationId: conversation.id, userId: id },
          update: { leftAt: null },
        });
      }
    }
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
  router.post("/conversations/:conversationId/messages", sendLimiter, audioUpload, async (req, res) => {
    const conversationId = idParam(req.params["conversationId"]);
    const senderId = req.auth!.userId;
    const { conversation } = await requireParticipant(prisma, conversationId, senderId);
    const file = req.file;
    const input = file ? { ...audioFields.parse(req.body), text: null } : textInput.parse(req.body);

    // 같은 clientMessageId 재요청: 기존 메시지를 그대로 돌려준다 (시나리오 13)
    const existing = await prisma.message.findUnique({
      where: { senderId_clientMessageId: { senderId, clientMessageId: input.clientMessageId } },
    });
    if (existing) {
      const body: SendResult = { messageId: existing.id, status: existing.status as MessageStatus };
      return void res.status(200).json(body);
    }

    // 수신자: 대화에 참여 중인 다른 활성 멤버. 언어는 발신 시점 스냅샷
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId, leftAt: null, userId: { not: senderId } },
      select: { userId: true },
    });
    const active = await prisma.siteMembership.findMany({
      where: { siteId: conversation.siteId, status: "active", userId: { in: participants.map((p) => p.userId) } },
      select: { userId: true },
    });
    const recipientIds = active.map((m) => m.userId);
    if (recipientIds.length === 0) throw new AppError("CONFLICT", "메시지를 받을 사람이 없습니다.");
    const langs = await siteLangs(prisma, conversation.siteId, [senderId, ...recipientIds]);
    const sourceLang = langs.get(senderId)!;
    const targetLangs = [...new Set(recipientIds.map((id) => langs.get(id)!))];

    // 엔진·비용 한도 확인 (처리 전에 거절)
    const needsTranslation = targetLangs.some((lang) => lang !== sourceLang);
    if ((file && !context.stt) || (needsTranslation && !context.translator)) {
      throw new AppError("OPENAI_NOT_CONFIGURED", "통역 엔진이 설정되지 않았습니다 (OpenAI API 키 필요).");
    }
    if ((file || needsTranslation) && context.env.ENGINE === "openai" && (await context.budget.status()).remainingUsd <= 0) {
      throw new AppError("BUDGET_EXCEEDED", "OpenAI 비용 한도를 모두 사용했습니다.");
    }

    const messageId = randomUUID();
    const audioPath = file
      ? await context.storage.saveUpload(messageId, file.buffer, AUDIO_EXTENSIONS[file.mimetype.split(";")[0]!] ?? "bin")
      : null;

    let message;
    try {
      message = await prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            id: messageId,
            siteId: conversation.siteId,
            conversationId,
            kind: conversation.type,
            senderId,
            clientMessageId: input.clientMessageId,
            inputType: file ? "audio" : "text",
            inputAudioPath: audioPath,
            sourceLang,
            rawText: input.text,
            translations: { create: targetLangs.map((targetLang) => ({ targetLang })) },
            recipients: { create: recipientIds.map((userId) => ({ userId, targetLang: langs.get(userId)! })) },
          },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });
        // 내가 보낸 메시지는 읽은 것으로
        await tx.conversationParticipant.update({
          where: { conversationId_userId: { conversationId, userId: senderId } },
          data: { lastReadSeq: created.seq },
        });
        return created;
      });
    } catch (error) {
      if (audioPath) await context.storage.remove(audioPath);
      if (!isUniqueViolation(error)) throw error;
      // 같은 clientMessageId 동시 요청: 먼저 만든 쪽을 돌려준다.
      const winner = await prisma.message.findUniqueOrThrow({
        where: { senderId_clientMessageId: { senderId, clientMessageId: input.clientMessageId } },
      });
      return void res.status(200).json({ messageId: winner.id, status: winner.status as MessageStatus } satisfies SendResult);
    }

    context.pipeline.enqueue(message.id);
    res.status(202).json({ messageId: message.id, status: "queued" } satisfies SendResult);
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
