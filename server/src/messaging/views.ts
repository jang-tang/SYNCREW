import type { Message, MessageRecipient, MessageTranslation, PrismaClient } from "../generated/prisma/client";
import type { MessageKind, MessageStatus, MessageView, RecipientCounts, RecipientStatus, TranslationStatus } from "../shared/api";
import type { Lang } from "../shared/languages";
import type { AudioUrlSigner } from "./audioUrls";

// DB 행 → 조회자 기준 MessageView (server/src/shared/api.ts)

export type FullMessage = Message & { translations: MessageTranslation[]; recipients: MessageRecipient[] };

export const fullMessage = { translations: true, recipients: true } as const;

/** 조회자 언어로 된 문장. 발신자는 자기 원문, 같은 언어(skipped)는 원문, 번역 전이면 null */
function textFor(message: FullMessage, translation: MessageTranslation | undefined): string | null {
  if (!translation) return null;
  if (translation.status === "skipped") return message.rawText;
  return translation.status === "done" ? translation.translatedText : null;
}

export function toMessageView(
  message: FullMessage,
  viewerId: string,
  senderName: string,
  signer: AudioUrlSigner,
): MessageView {
  const isSender = message.senderId === viewerId;
  const mine = message.recipients.find((r) => r.userId === viewerId);
  const translation = mine ? message.translations.find((t) => t.targetLang === mine.targetLang) : undefined;

  const view: MessageView = {
    id: message.id,
    kind: message.kind as MessageKind,
    siteId: message.siteId,
    conversationId: message.conversationId,
    seq: Number(message.seq),
    senderId: message.senderId,
    senderName,
    sourceLang: message.sourceLang as Lang,
    originalText: message.rawText,
    text: isSender ? message.rawText : textFor(message, translation),
    audioUrl:
      !isSender && translation?.status === "done" && translation.audioPath
        ? signer.url(message.id, translation.targetLang, viewerId)
        : null,
    status: message.status as MessageStatus,
    requiresAck: message.requiresAck,
    createdAt: message.createdAt.toISOString(),
  };
  if (isSender) view.translations = translationStates(message);
  if (mine) view.myStatus = mine.status as RecipientStatus;
  return view;
}

export const translationStates = (message: FullMessage) =>
  message.translations
    .map((t) => ({ lang: t.targetLang as Lang, status: t.status as TranslationStatus }))
    .sort((a, b) => a.lang.localeCompare(b.lang));

export function recipientCounts(recipients: Pick<MessageRecipient, "status">[]): RecipientCounts {
  const counts: RecipientCounts = { pending: 0, sent: 0, delivered: 0, acknowledged: 0, completed: 0, failed: 0 };
  for (const r of recipients) counts[r.status as RecipientStatus] += 1;
  return counts;
}

/** 여러 사용자의 표시 이름 */
export async function displayNames(prisma: PrismaClient, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.profile.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

/** 메시지 목록을 조회자 기준으로 변환 */
export async function toMessageViews(
  prisma: PrismaClient,
  signer: AudioUrlSigner,
  messages: FullMessage[],
  viewerId: string,
): Promise<MessageView[]> {
  const names = await displayNames(prisma, messages.map((m) => m.senderId));
  return messages.map((m) => toMessageView(m, viewerId, names.get(m.senderId) ?? "", signer));
}
