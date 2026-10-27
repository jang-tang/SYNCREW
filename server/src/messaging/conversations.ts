import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { AppError } from "../lib/errors";
import type { ConversationSummary, ConversationType } from "../shared/api";
import type { Lang } from "../shared/languages";
import type { AudioUrlSigner } from "./audioUrls";
import { fullMessage, toMessageView } from "./views";

/** 현장 안에서 사용자의 언어: 관리자가 지정한 언어(lang_override) 또는 본인 선호 언어 */
export async function siteLangs(prisma: PrismaClient, siteId: string, userIds: string[]): Promise<Map<string, Lang>> {
  const rows = await prisma.siteMembership.findMany({
    where: { siteId, userId: { in: userIds } },
    select: { userId: true, langOverride: true, user: { select: { preferredLang: true } } },
  });
  return new Map(rows.map((r) => [r.userId, (r.langOverride ?? r.user.preferredLang) as Lang]));
}

/**
 * 대화 참여자 확인: 대화에 참여 중(left_at 없음)이고 그 현장의 활성 멤버여야 한다.
 * 아니면 대화가 있는지조차 알리지 않도록 404.
 */
export async function requireParticipant(prisma: PrismaClient, conversationId: string, userId: string) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: true },
  });
  if (!participant || participant.leftAt) throw new AppError("NOT_FOUND", "대화를 찾을 수 없습니다.");
  const membership = await prisma.siteMembership.findUnique({
    where: { siteId_userId: { siteId: participant.conversation.siteId, userId } },
  });
  if (!membership || membership.status !== "active") throw new AppError("NOT_FOUND", "대화를 찾을 수 없습니다.");
  return { participant, conversation: participant.conversation, membership };
}

/** 조회자에게 보이는 메시지: 본인이 보냈거나 수신자인 것 */
/** 말한 사람에게 숨기는 스트리밍 기록의 clientMessageId 앞부분 (streaming/persistTurn.ts) */
export const HIDDEN_FROM_SENDER_PREFIX = "gcopy-";

export const visibleTo = (userId: string) => ({
  OR: [
    // 현장 전체 연결의 언어별 기록 중 대표가 아닌 것은 말한 사람에게 숨긴다 (streaming/persistTurn.ts)
    { senderId: userId, NOT: { clientMessageId: { startsWith: HIDDEN_FROM_SENDER_PREFIX } } },
    { recipients: { some: { userId } } },
  ],
});

/** 조회자 기준 대화 요약 목록 (group 먼저, 그다음 최근 메시지 순) */
export async function conversationSummaries(
  prisma: PrismaClient,
  signer: AudioUrlSigner,
  siteId: string,
  userId: string,
  conversationIds?: string[],
): Promise<ConversationSummary[]> {
  const rows = await prisma.conversationParticipant.findMany({
    where: { userId, leftAt: null, conversation: { siteId, ...(conversationIds ? { id: { in: conversationIds } } : {}) } },
    include: { conversation: { include: { site: true, participants: true } } },
  });

  const peerIds = rows
    .filter((r) => r.conversation.type === "direct")
    .map((r) => r.conversation.participants.find((p) => p.userId !== userId)?.userId)
    .filter((id): id is string => Boolean(id));
  const [langs, peers] = await Promise.all([
    siteLangs(prisma, siteId, peerIds),
    prisma.profile.findMany({ where: { id: { in: peerIds } }, select: { id: true, displayName: true } }),
  ]);
  const peerName = new Map(peers.map((p) => [p.id, p.displayName]));

  const summaries = await Promise.all(
    rows.map(async ({ conversation, lastReadSeq }) => {
      const [last, unreadCount] = await Promise.all([
        prisma.message.findFirst({
          where: { conversationId: conversation.id, ...visibleTo(userId) },
          orderBy: { seq: "desc" },
          include: fullMessage,
        }),
        prisma.message.count({
          where: { conversationId: conversation.id, senderId: { not: userId }, seq: { gt: lastReadSeq }, recipients: { some: { userId } } },
        }),
      ]);
      const peerId = conversation.type === "direct" ? conversation.participants.find((p) => p.userId !== userId)?.userId : undefined;
      let lastMessage: ConversationSummary["lastMessage"];
      if (last) {
        const senderName = last.senderId === peerId ? (peerName.get(peerId) ?? "") : (await prisma.profile.findUnique({ where: { id: last.senderId } }))?.displayName ?? "";
        const view = toMessageView(last, userId, senderName, signer);
        lastMessage = { text: view.text ?? "…", senderName, createdAt: view.createdAt };
      }
      const summary: ConversationSummary = {
        id: conversation.id,
        type: conversation.type as ConversationType,
        title: peerId ? (peerName.get(peerId) ?? "") : (conversation.title ?? conversation.site.name),
        participantCount: conversation.participants.filter((p) => !p.leftAt).length,
        unreadCount,
        ...(lastMessage ? { lastMessage } : {}),
        ...(peerId ? { peer: { userId: peerId, displayName: peerName.get(peerId) ?? "", lang: langs.get(peerId) ?? "ko" } } : {}),
      };
      return summary;
    }),
  );

  return summaries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "group" ? -1 : 1;
    return (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? "");
  });
}

/**
 * 두 사람의 1:1 대화를 연다 (현장당 1개, 멱등). 동시에 열어도 한쪽만 생성된다.
 * 이미 있으면 두 사람 모두 다시 참여시킨다 (제외됐다가 다시 승인된 경우 등).
 */
export async function ensureDirectConversation(prisma: PrismaClient, siteId: string, userId: string, peerId: string) {
  const directKey = [userId, peerId].sort().join(":");
  const find = () => prisma.conversation.findFirst({ where: { siteId, type: "direct", directKey } });
  let conversation = await find();
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({
        data: { siteId, type: "direct", directKey, participants: { create: [{ userId }, { userId: peerId }] } },
      });
      return { conversation, created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      conversation = (await find())!;
    }
  }
  for (const id of [userId, peerId]) {
    await prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: id } },
      create: { conversationId: conversation.id, userId: id },
      update: { leftAt: null },
    });
  }
  return { conversation, created: false };
}
