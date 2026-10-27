import type { Profile, TargetGroup } from "@shared/api";
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
  // 데모 작업조 (현장 A): 현장 관리자끼리 공유되는 대상 묶음 (B2)
  const groups = new Map<string, TargetGroup & { siteId: string }>([
    ["g_1f", { id: "g_1f", siteId: "s_a", name: "1층 작업조", userIds: ["u_nguyen", "u_li"], createdBy: ME, updatedAt: new Date().toISOString() }],
  ]);
  const activeIds = (siteId: string) => new Set(mockDb.memberships.filter((m) => m.siteId === siteId && m.status === "active").map((m) => m.userId));
  const groupView = (g: TargetGroup & { siteId: string }): TargetGroup => {
    const active = activeIds(g.siteId);
    return { id: g.id, name: g.name, userIds: g.userIds.filter((id) => active.has(id)), createdBy: g.createdBy, updatedAt: g.updatedAt };
  };
  const checkGroup = (siteId: string, name: string | undefined, userIds: string[] | undefined, selfId?: string) => {
    if (name !== undefined && !name.trim()) throw new ApiError("VALIDATION_ERROR", "VALIDATION_ERROR");
    if (name !== undefined && [...groups.values()].some((g) => g.siteId === siteId && g.name === name.trim() && g.id !== selfId)) {
      throw new ApiError("CONFLICT", "CONFLICT");
    }
    if (userIds && (userIds.length === 0 || userIds.some((id) => !activeIds(siteId).has(id)))) throw new ApiError("VALIDATION_ERROR", "VALIDATION_ERROR");
  };
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

    async startCall(siteId, userId, options) {
      const outcome = mockDb.startCall(siteId, userId, options?.connect);
      if ("error" in outcome) throw new ApiError(outcome.error!, outcome.error!);
      return wait(outcome.session!, 300);
    },
    async switchCall(sessionId, userId) {
      const outcome = mockDb.switchCall(sessionId, userId);
      if ("error" in outcome) throw new ApiError(outcome.error!, outcome.error!);
      return wait(outcome.session!, 300);
    },
    currentGroup: async (siteId) => wait(mockDb.currentGroup(siteId)),
    joinGroup: async (siteId) => wait(mockDb.joinGroup(siteId), 300),
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

    listTargetGroups: async (siteId) =>
      wait([...groups.values()].filter((g) => g.siteId === siteId).map(groupView).sort((a, b) => a.name.localeCompare(b.name))),
    async createTargetGroup(siteId, input) {
      checkGroup(siteId, input.name, input.userIds);
      const group = { id: `g_${Date.now()}`, siteId, name: input.name.trim(), userIds: [...new Set(input.userIds)], createdBy: ME, updatedAt: new Date().toISOString() };
      groups.set(group.id, group);
      return wait(groupView(group));
    },
    async updateTargetGroup(siteId, groupId, input) {
      const group = groups.get(groupId);
      if (!group || group.siteId !== siteId) throw new ApiError("NOT_FOUND", "NOT_FOUND");
      checkGroup(siteId, input.name, input.userIds, groupId);
      if (input.name !== undefined) group.name = input.name.trim();
      if (input.userIds) group.userIds = [...new Set(input.userIds)];
      group.updatedAt = new Date().toISOString();
      return wait(groupView(group));
    },
    async deleteTargetGroup(siteId, groupId) {
      const group = groups.get(groupId);
      if (!group || group.siteId !== siteId) throw new ApiError("NOT_FOUND", "NOT_FOUND");
      groups.delete(groupId);
      await wait(undefined);
    },
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
