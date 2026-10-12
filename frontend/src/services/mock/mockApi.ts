import type { Profile } from "@shared/api";
import { secureStorage } from "@/lib/storage";
import { ApiError } from "../live/http";
import type { ApiService } from "../types";
import { mockBus } from "./bus";
import { ME, mockDb } from "./mockDb";
import { nextVoicePhrase } from "./phrases";

const PROFILE_KEY = "syncrew.mockProfile";
/** 실제 네트워크처럼 로딩 상태가 보이도록 약간 지연 */
const wait = <T,>(value: T, ms = 180) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

function applyProfile(profile: Profile) {
  mockDb.profile = profile;
  const me = mockDb.users.get(ME)!;
  me.displayName = profile.displayName;
  me.lang = profile.preferredLang;
}

async function restoreProfile() {
  const stored = await secureStorage.getItem(PROFILE_KEY).catch(() => null);
  if (stored) applyProfile(JSON.parse(stored) as Profile);
}

export function createMockApi(): ApiService {
  // 앱을 다시 열면 저장된 프로필(이름·언어)을 먼저 적용해야 번역·이름이 맞게 나온다.
  const restored = restoreProfile();
  const api: ApiService = {
    async getHealth() {
      return null;
    },

    async getMe() {
      return wait(mockDb.profile);
    },
    async saveMe(input) {
      const profile: Profile = {
        id: ME,
        email: mockDb.profile?.email || mockDb.sessionEmail,
        autoPlay: true,
        speechRate: 1,
        ...mockDb.profile,
        ...input,
      };
      applyProfile(profile);
      await secureStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      return wait(profile);
    },

    getMySites: async () => wait(mockDb.mySites()),
    createSite: async (input) => wait(mockDb.createSite(input.name, input.address ?? null), 400),
    async join(code) {
      const outcome = mockDb.join(code);
      if ("error" in outcome) throw new ApiError(outcome.error!, outcome.error!);
      return wait(outcome.result, 400);
    },

    listJoinCodes: async (siteId) => wait(mockDb.codes.filter((c) => c.siteId === siteId && !c.revoked)),
    createJoinCode: async (siteId) => wait(mockDb.createCode(siteId)),
    async revokeJoinCode(_siteId, codeId) {
      const code = mockDb.codes.find((c) => c.id === codeId);
      if (code) code.revoked = true;
      await wait(undefined);
    },

    listMembers: async (siteId) => wait(mockDb.members(siteId)),
    async updateMember(siteId, userId, action) {
      mockDb.updateMember(siteId, userId, action);
      await wait(undefined);
    },

    listConversations: async (siteId) => wait(mockDb.conversationsFor(siteId)),
    openDirect: async (siteId, userId) => wait(mockDb.openDirect(siteId, userId)),
    async listMessages(conversationId) {
      mockDb.markRead(conversationId);
      return wait(mockDb.messagesOf(conversationId).map((m) => mockDb.view(m, ME)));
    },
    async sendText(conversationId, input) {
      const message = mockDb.send(conversationId, input.clientMessageId, input.text);
      return wait({ messageId: message.id, status: message.status }, 120);
    },
    async sendAudio(conversationId, input) {
      // 데모: 음성 인식 대신 예문 하나를 말한 것으로 처리
      const conversation = mockDb.conversations.get(conversationId)!;
      const text = nextVoicePhrase(mockDb.langIn(conversation.siteId, ME));
      const message = mockDb.send(conversationId, input.clientMessageId, text);
      return wait({ messageId: message.id, status: message.status }, 500);
    },
    async retryMessage(messageId) {
      const message = mockDb.messages.get(messageId)!;
      return wait({ messageId, status: message.status });
    },

    async createInstruction(siteId, input) {
      const userIds =
        input.target === "all"
          ? mockDb.members(siteId).filter((m) => m.status === "active" && m.userId !== ME && m.role === "member").map((m) => m.userId)
          : input.target.userIds;
      const text = "text" in input ? input.text : nextVoicePhrase(mockDb.langIn(siteId, ME));
      const message = mockDb.createInstruction(siteId, input.clientMessageId, text, userIds, input.requiresAck);
      return wait({ messageId: message.id, status: message.status }, 300);
    },
    listInstructions: async (siteId) => wait(mockDb.instructions(siteId)),
    getInstruction: async (messageId) => wait(mockDb.instructionDetail(messageId)),
    getInbox: async (siteId) => wait(mockDb.inbox(siteId)),
    async ackInstruction(messageId) {
      mockDb.respond(messageId, "acknowledged");
      await wait(undefined);
    },
    async completeInstruction(messageId, note) {
      mockDb.respond(messageId, "completed", note);
      await wait(undefined);
    },

    async startCall(siteId, userId) {
      const outcome = mockDb.startCall(siteId, userId);
      if ("error" in outcome) throw new ApiError(outcome.error!, outcome.error!);
      return wait(outcome.session!, 300);
    },
    async startBroadcast(siteId, target) {
      const userIds =
        target === "all"
          ? mockDb.members(siteId).filter((m) => m.status === "active" && m.userId !== ME && m.role === "member").map((m) => m.userId)
          : target.userIds;
      const outcome = mockDb.startBroadcast(siteId, userIds);
      if ("error" in outcome) throw new ApiError(outcome.error!, outcome.error!);
      return wait(outcome.session!, 300);
    },
    getSession: async (sessionId) => wait(mockDb.sessionView(mockDb.sessions.get(sessionId)!)),
    listOpenSessions: async (siteId) =>
      wait(mockDb.sessionsOf(siteId).filter((s) => s.status !== "ended").map((s) => mockDb.sessionView(s))),
    listSessions: async (siteId, mode) => wait(mockDb.sessionsOf(siteId, mode).map((s) => mockDb.sessionView(s))),
    acceptSession: async (sessionId) => wait(mockDb.sessionView(mockDb.sessions.get(sessionId)!)),
    declineSession: async (sessionId) => wait(mockDb.endSession(sessionId, "declined")),
    endSession: async (sessionId) => wait(mockDb.endSession(sessionId)),
    async sendUtterance(sessionId, input) {
      // 데모: 음성 인식 대신 예문 하나를 말한 것으로 처리
      const session = mockDb.sessions.get(sessionId)!;
      const outcome = mockDb.utterance(sessionId, input.clientMessageId, nextVoicePhrase(mockDb.langIn(session.siteId, ME)));
      if ("error" in outcome) throw new ApiError(outcome.error!, outcome.error!);
      return wait({ messageId: outcome.message!.id, status: outcome.message!.status }, 400);
    },
    listSessionMessages: async (sessionId) => wait(mockDb.sessionMessages(sessionId).map((m) => mockDb.view(m, ME))),
  };

  return Object.fromEntries(
    Object.entries(api).map(([name, method]) => [
      name,
      async (...args: unknown[]) => {
        await restored;
        return (method as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as ApiService;
}

export { mockBus };
