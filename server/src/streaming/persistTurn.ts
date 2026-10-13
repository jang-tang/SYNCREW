import { randomUUID } from "node:crypto";
import type { AppContext } from "../context";
import { encodeWav } from "../engine/audio/codec";
import type { Lang } from "../shared/languages";
import { fullMessage, recipientCounts, toMessageView } from "../messaging/views";

// 스트리밍 턴 1개를 기록으로 저장 (docs/streaming-plan.md 4절 persistTurn, 완료 기준 4).
// 파이프라인을 거치지 않고 "이미 번역된 1:1 메시지"로 저장한다. 형식은 발화 단위 방식과 같다:
//   messages(kind direct, sessionId, 원문 음성) + message_translations(done, 번역문·번역 음성) + message_recipients(sent)
// 원문 전사에는 현장 용어 보정을 적용한다 (P5: 전사가 "비계→기계"처럼 틀린 경우).

export type StreamedTurn = {
  turnId: string;
  siteId: string;
  sessionId: string;
  conversationId: string | null;
  senderId: string;
  recipientId: string;
  sourceLang: Lang;
  targetLang: Lang;
  original: string | null;
  translation: string;
  model: string;
  /** 말한 사람 음성 (PCM16) */
  inputPcm: Buffer;
  /** 번역 음성 (PCM16) */
  outputPcm: Buffer;
  sampleRate: number;
  timings: Record<string, number>;
};

export async function persistTurn(context: AppContext, turn: StreamedTurn): Promise<string> {
  const { prisma, storage, domain } = context;
  const clientMessageId = `stream-${turn.turnId}`.slice(0, 64);
  const existing = await prisma.message.findUnique({ where: { senderId_clientMessageId: { senderId: turn.senderId, clientMessageId } } });
  if (existing) return existing.id;

  const messageId = randomUUID();
  const rawText = turn.original?.trim() ?? "";
  const corrected = rawText ? domain.process(rawText, turn.sourceLang) : null;
  const inputAudioPath = turn.inputPcm.length > 0 ? await storage.saveUpload(messageId, encodeWav(turn.inputPcm, turn.sampleRate), "wav") : null;
  const audioPath = turn.outputPcm.length > 0
    ? await storage.saveTranslationAudio(messageId, turn.targetLang, encodeWav(turn.outputPcm, turn.sampleRate))
    : null;
  const now = new Date();

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        id: messageId,
        siteId: turn.siteId,
        conversationId: turn.conversationId,
        kind: "direct",
        senderId: turn.senderId,
        clientMessageId,
        inputType: "audio",
        inputAudioPath,
        sourceLang: turn.sourceLang,
        rawText,
        correctedText: corrected?.correctedText ?? rawText,
        glossaryHits: corrected?.hits ?? [],
        status: "done",
        timings: { ...turn.timings, streamed: 1 },
        sessionId: turn.sessionId,
        translations: {
          create: [
            {
              targetLang: turn.targetLang,
              status: "done",
              translatedText: turn.translation,
              audioPath,
              model: turn.model,
              attempts: 1,
              latencyMs: turn.timings["firstAudioMs"] ?? null,
              timings: turn.timings,
            },
          ],
        },
        recipients: { create: [{ userId: turn.recipientId, targetLang: turn.targetLang, status: "sent", sentAt: now }] },
      },
      include: fullMessage,
    });
    if (turn.conversationId) {
      await tx.conversation.update({ where: { id: turn.conversationId }, data: { lastMessageAt: created.createdAt } });
      await tx.conversationParticipant.updateMany({
        where: { conversationId: turn.conversationId, userId: turn.senderId },
        data: { lastReadSeq: created.seq },
      });
    }
    return created;
  });

  // 발화 단위 방식과 같은 알림: 받는 사람 message:new, 말한 사람 message:status
  const sender = await prisma.profile.findUnique({ where: { id: turn.senderId }, select: { displayName: true } });
  context.events.messageNew({
    userId: turn.recipientId,
    message: toMessageView(message, turn.recipientId, sender?.displayName ?? "", context.audioUrls),
  });
  context.events.messageStatus({
    userId: turn.senderId,
    messageId,
    status: "done",
    translations: [{ lang: turn.targetLang, status: "done", text: turn.translation }],
    recipients: recipientCounts(message.recipients),
  });
  return messageId;
}
