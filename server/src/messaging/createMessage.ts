import { randomUUID } from "node:crypto";
import type { AppContext } from "../context";
import { Prisma } from "../generated/prisma/client";
import { AppError } from "../lib/errors";
import type { MessageKind, MessageStatus, SendResult } from "../shared/api";
import { AUDIO_EXTENSIONS, baseMime } from "../http/upload";
import { siteLangs } from "./conversations";

// 메시지 1건 생성 (1:1·그룹 대화, 통화 발화, 일괄 지시 공통)
// 중복 확인 → 엔진·비용 한도 확인 → 원본 음성 저장 → 메시지·언어별 번역·수신자를 한 트랜잭션으로 → 파이프라인 등록


export type NewMessage = {
  siteId: string;
  kind: MessageKind;
  /** instruction 이면 null */
  conversationId: string | null;
  senderId: string;
  clientMessageId: string;
  /** 텍스트 입력 (음성이면 null) */
  text: string | null;
  audio?: { buffer: Buffer; mimetype: string };
  /** 받을 사람 (발신자 제외, 현장 활성 멤버만 남긴다) */
  recipientIds: string[];
  requiresAck?: boolean;
  /** 실시간 통역 세션 발화 */
  sessionId?: string | null;
};

export type CreateResult = { httpStatus: 200 | 202; body: SendResult };

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function createMessage(context: AppContext, input: NewMessage): Promise<CreateResult> {
  const { prisma } = context;
  const { senderId, clientMessageId, siteId } = input;

  // 같은 clientMessageId 재요청: 기존 메시지를 그대로 돌려준다 (시나리오 13)
  const existing = await prisma.message.findUnique({ where: { senderId_clientMessageId: { senderId, clientMessageId } } });
  if (existing) return { httpStatus: 200, body: { messageId: existing.id, status: existing.status as MessageStatus } };

  // 수신자: 현장 활성 멤버만. 언어는 발신 시점 스냅샷
  const active = await prisma.siteMembership.findMany({
    where: { siteId, status: "active", userId: { in: input.recipientIds.filter((id) => id !== senderId) } },
    select: { userId: true },
  });
  const recipientIds = active.map((m) => m.userId);
  if (recipientIds.length === 0) throw new AppError("CONFLICT", "메시지를 받을 사람이 없습니다.");
  const langs = await siteLangs(prisma, siteId, [senderId, ...recipientIds]);
  const sourceLang = langs.get(senderId)!;
  const targetLangs = [...new Set(recipientIds.map((id) => langs.get(id)!))];

  // 엔진·비용 한도 확인 (처리 전에 거절)
  const needsTranslation = targetLangs.some((lang) => lang !== sourceLang);
  if ((input.audio && !context.stt) || (needsTranslation && !context.translator)) {
    throw new AppError("OPENAI_NOT_CONFIGURED", "통역 엔진이 설정되지 않았습니다 (OpenAI API 키 필요).");
  }
  if ((input.audio || needsTranslation) && context.env.ENGINE === "openai" && (await context.budget.status()).remainingUsd <= 0) {
    throw new AppError("BUDGET_EXCEEDED", "OpenAI 비용 한도를 모두 사용했습니다.");
  }

  const messageId = randomUUID();
  const audioPath = input.audio
    ? await context.storage.saveUpload(messageId, input.audio.buffer, AUDIO_EXTENSIONS[baseMime(input.audio.mimetype)] ?? "bin")
    : null;

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          id: messageId,
          siteId,
          conversationId: input.conversationId,
          kind: input.kind,
          senderId,
          clientMessageId,
          inputType: input.audio ? "audio" : "text",
          inputAudioPath: audioPath,
          sourceLang,
          rawText: input.text,
          requiresAck: input.requiresAck ?? false,
          sessionId: input.sessionId ?? null,
          translations: { create: targetLangs.map((targetLang) => ({ targetLang })) },
          recipients: { create: recipientIds.map((userId) => ({ userId, targetLang: langs.get(userId)! })) },
        },
      });
      if (input.conversationId) {
        await tx.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: message.createdAt } });
        // 내가 보낸 메시지는 읽은 것으로
        await tx.conversationParticipant.updateMany({
          where: { conversationId: input.conversationId, userId: senderId },
          data: { lastReadSeq: message.seq },
        });
      }
      return message;
    });
  } catch (error) {
    if (audioPath) await context.storage.remove(audioPath);
    if (!isUniqueViolation(error)) throw error;
    // 같은 clientMessageId 동시 요청: 먼저 만든 쪽을 돌려준다.
    const winner = await prisma.message.findUniqueOrThrow({ where: { senderId_clientMessageId: { senderId, clientMessageId } } });
    return { httpStatus: 200, body: { messageId: winner.id, status: winner.status as MessageStatus } };
  }

  context.pipeline.enqueue(created.id);
  return { httpStatus: 202, body: { messageId: created.id, status: "queued" } };
}
