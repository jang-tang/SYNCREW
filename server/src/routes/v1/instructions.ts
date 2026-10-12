import { Router } from "express";
import { z } from "zod";
import { requireMembership, UUID } from "../../access/membership";
import type { AppContext } from "../../context";
import { audioUpload, sendLimiter } from "../../http/upload";
import { AppError } from "../../lib/errors";
import { createMessage } from "../../messaging/createMessage";
import { displayNames, fullMessage, recipientCounts, toMessageView, type FullMessage } from "../../messaging/views";
import type {
  InboxItem,
  InstructionDetail,
  InstructionSummary,
  MessageStatus,
  RecipientStatus,
  TranslationStatus,
} from "../../shared/api";
import type { Lang } from "../../shared/languages";

// 일괄 지시 조회와 응답 (docs/api-specification.md 6, 7절)
// 문자·음성으로 작성한 지시와 실시간 일괄 지시의 발화(session_id 있음)가 같은 목록에 쌓인다.

const clientMessageId = z.string().trim().min(1).max(64);
const targetSchema = z.union([z.literal("all"), z.object({ userIds: z.array(z.string().regex(UUID)).min(1).max(200) })]);
const textInstruction = z.object({
  clientMessageId,
  text: z.string().trim().min(1).max(1000),
  target: targetSchema,
  requiresAck: z.boolean().default(true),
});
/** multipart: target 은 JSON 문자열, requiresAck 는 "true"/"false" */
const audioInstruction = z.object({
  clientMessageId,
  target: z.string().transform((value, ctx) => {
    try {
      return targetSchema.parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: "custom", message: "target 형식이 올바르지 않습니다." });
      return z.NEVER;
    }
  }),
  requiresAck: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});
const completeInput = z.object({ note: z.string().trim().max(200).optional() });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

/** 수신 상태 순서. 확인·완료는 되돌리지 않는다. */
const ORDER: RecipientStatus[] = ["pending", "sent", "delivered", "acknowledged", "completed"];

const idParam = (value: unknown) => {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw new AppError("NOT_FOUND", "지시를 찾을 수 없습니다.");
  return id;
};

function summaryOf(message: FullMessage, senderName: string): InstructionSummary {
  return {
    id: message.id,
    sessionId: message.sessionId,
    senderName,
    text: message.rawText ?? "…",
    sourceLang: message.sourceLang as Lang,
    status: message.status as MessageStatus,
    requiresAck: message.requiresAck,
    createdAt: message.createdAt.toISOString(),
    total: message.recipients.length,
    counts: recipientCounts(message.recipients),
  };
}

export function instructionsRouter(context: AppContext): Router {
  const router = Router();
  const { prisma } = context;
  const member = requireMembership(context);
  const manager = requireMembership(context, "manager");
  const limiter = sendLimiter(context);

  /** 지시 작성 (관리자): JSON 텍스트 또는 multipart 음성 */
  router.post("/sites/:siteId/instructions", manager, limiter, audioUpload, async (req, res) => {
    const siteId = req.membership!.siteId;
    const senderId = req.auth!.userId;
    const file = req.file;
    const input = file ? { ...audioInstruction.parse(req.body), text: null } : textInstruction.parse(req.body);

    const members = await prisma.siteMembership.findMany({ where: { siteId, status: "active", userId: { not: senderId } } });
    let recipientIds: string[];
    if (input.target === "all") {
      recipientIds = members.filter((m) => m.role === "member").map((m) => m.userId);
    } else {
      const allowed = new Set(members.map((m) => m.userId));
      if (input.target.userIds.some((id) => !allowed.has(id))) throw new AppError("VALIDATION_ERROR", "현장 구성원이 아닌 대상이 있습니다.");
      recipientIds = input.target.userIds;
    }

    const result = await createMessage(context, {
      siteId,
      kind: "instruction",
      conversationId: null,
      senderId,
      clientMessageId: input.clientMessageId,
      text: input.text,
      ...(file ? { audio: { buffer: file.buffer, mimetype: file.mimetype } } : {}),
      recipientIds,
      requiresAck: input.requiresAck,
    });
    res.status(result.httpStatus).json(result.body);
  });

  /** 현장의 지시 목록과 상태별 집계 (관리자) */
  router.get("/sites/:siteId/instructions", manager, async (req, res) => {
    const { limit } = listQuery.parse(req.query);
    const rows = await prisma.message.findMany({
      where: { siteId: req.membership!.siteId, kind: "instruction" },
      orderBy: { seq: "desc" },
      take: limit,
      include: fullMessage,
    });
    const names = await displayNames(prisma, rows.map((m) => m.senderId));
    res.json(rows.map((m) => summaryOf(m, names.get(m.senderId) ?? "")));
  });

  /** 지시 상세: 수신자별 상태, 언어별 번역 (그 현장 관리자) */
  router.get("/instructions/:messageId", async (req, res) => {
    const message = await prisma.message.findUnique({ where: { id: idParam(req.params["messageId"]) }, include: fullMessage });
    if (!message || message.kind !== "instruction") throw new AppError("NOT_FOUND", "지시를 찾을 수 없습니다.");
    const membership = await prisma.siteMembership.findUnique({
      where: { siteId_userId: { siteId: message.siteId, userId: req.auth!.userId } },
    });
    if (membership?.status !== "active" || membership.role !== "manager") throw new AppError("NOT_FOUND", "지시를 찾을 수 없습니다.");

    const userIds = message.recipients.map((r) => r.userId);
    const names = await displayNames(prisma, [message.senderId, ...userIds]);
    const detail: InstructionDetail = {
      ...summaryOf(message, names.get(message.senderId) ?? ""),
      recipients: message.recipients
        .map((r) => ({
          userId: r.userId,
          displayName: names.get(r.userId) ?? "",
          lang: r.targetLang as Lang,
          status: r.status as RecipientStatus,
          deliveredAt: r.deliveredAt?.toISOString() ?? null,
          acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
          responseNote: r.responseNote,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      translations: message.translations.map((t) => ({
        lang: t.targetLang as Lang,
        status: t.status as TranslationStatus,
        text: t.status === "done" ? t.translatedText : t.status === "skipped" ? message.rawText : null,
      })),
    };
    res.json(detail);
  });

  /** 내가 받은 지시 (내 언어, 음성 URL, 내 상태) */
  router.get("/sites/:siteId/inbox", member, async (req, res) => {
    const { limit } = listQuery.parse(req.query);
    const userId = req.auth!.userId;
    const rows = await prisma.message.findMany({
      where: { siteId: req.membership!.siteId, kind: "instruction", recipients: { some: { userId } } },
      orderBy: { seq: "desc" },
      take: limit,
      include: fullMessage,
    });
    const names = await displayNames(prisma, rows.map((m) => m.senderId));
    const items: InboxItem[] = rows.map((m) => {
      const mine = m.recipients.find((r) => r.userId === userId)!;
      return {
        ...toMessageView(m, userId, names.get(m.senderId) ?? "", context.audioUrls),
        myStatus: mine.status as RecipientStatus,
        acknowledgedAt: mine.acknowledgedAt?.toISOString() ?? null,
        completedAt: mine.completedAt?.toISOString() ?? null,
      };
    });
    res.json(items);
  });

  /** 확인·완료 응답 (수신자, 멱등). 관리자에게 instruction:recipient */
  const respond = (status: "acknowledged" | "completed") =>
    router.post(`/instructions/:messageId/${status === "acknowledged" ? "ack" : "complete"}`, async (req, res) => {
      const messageId = idParam(req.params["messageId"]);
      const userId = req.auth!.userId;
      const note = status === "completed" ? completeInput.parse(req.body ?? {}).note : undefined;
      const recipient = await prisma.messageRecipient.findUnique({
        where: { messageId_userId: { messageId, userId } },
        include: { message: { select: { kind: true, siteId: true } } },
      });
      if (!recipient || recipient.message.kind !== "instruction") throw new AppError("NOT_FOUND", "지시를 찾을 수 없습니다.");
      const membership = await prisma.siteMembership.findUnique({
        where: { siteId_userId: { siteId: recipient.message.siteId, userId } },
      });
      if (membership?.status !== "active") throw new AppError("NOT_FOUND", "지시를 찾을 수 없습니다.");
      if (recipient.status === "failed") throw new AppError("CONFLICT", "아직 전달되지 않은 지시입니다.");

      const current = ORDER.indexOf(recipient.status as RecipientStatus);
      if (current < ORDER.indexOf(status)) {
        const now = new Date();
        await prisma.messageRecipient.update({
          where: { messageId_userId: { messageId, userId } },
          data: {
            status,
            deliveredAt: recipient.deliveredAt ?? now,
            acknowledgedAt: recipient.acknowledgedAt ?? now,
            ...(status === "completed" ? { completedAt: now, ...(note ? { responseNote: note } : {}) } : {}),
          },
        });
        context.events.instructionRecipient({ siteId: recipient.message.siteId, messageId, userId, status });
      }
      res.status(204).end();
    });
  respond("acknowledged");
  respond("completed");

  return router;
}
