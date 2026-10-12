import type {
  ConversationSummary,
  HealthResponse,
  InboxItem,
  InstructionDetail,
  InstructionSummary,
  JoinCode,
  JoinResult,
  LiveSession,
  Member,
  MessageView,
  MySite,
  Profile,
  SendResult,
} from "@shared/api";
import type { ApiService, AuthService } from "../types";
import { ApiError, request } from "./http";

const V1 = "/api/v1";

/** 음성 파일 multipart 업로드용 (React Native FormData 파일 형식) */
function audioForm(fields: Record<string, string>, audio: { uri: string; mimeType: string }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const extension = audio.mimeType.includes("mp4") || audio.mimeType.includes("m4a") ? "m4a" : "webm";
  form.append("audio", { uri: audio.uri, name: `speech.${extension}`, type: audio.mimeType } as unknown as Blob);
  return form;
}

/** docs/api-specification.md 의 REST API 호출 */
export function createHttpApi(auth: AuthService): ApiService {
  const call = async <T,>(path: string, init: Parameters<typeof request>[1] = {}) => {
    const session = await auth.getSession();
    return request<T>(`${V1}${path}`, { ...init, token: session?.accessToken });
  };

  return {
    async getHealth() {
      try {
        return await request<HealthResponse>("/health", { acceptStatuses: [503], timeoutMs: 5000 });
      } catch {
        return null;
      }
    },

    async getMe() {
      try {
        return await call<Profile>("/me");
      } catch (error) {
        if (error instanceof ApiError && error.code === "PROFILE_REQUIRED") return null;
        throw error;
      }
    },
    saveMe: (input) => call<Profile>("/me", { method: "PUT", json: input }),

    getMySites: () => call<MySite[]>("/me/sites"),
    createSite: (input) => call<MySite>("/sites", { method: "POST", json: input }),
    join: (code) => call<JoinResult>("/join", { method: "POST", json: { code } }),

    listJoinCodes: (siteId) => call<JoinCode[]>(`/sites/${siteId}/join-codes`),
    createJoinCode: (siteId, input = {}) => call<JoinCode>(`/sites/${siteId}/join-codes`, { method: "POST", json: input }),
    revokeJoinCode: (siteId, codeId) => call<void>(`/sites/${siteId}/join-codes/${codeId}`, { method: "DELETE" }),

    listMembers: (siteId) => call<Member[]>(`/sites/${siteId}/members`),
    updateMember: (siteId, userId, action) =>
      call<void>(`/sites/${siteId}/members/${userId}`, { method: "PATCH", json: action }),

    listConversations: (siteId) => call<ConversationSummary[]>(`/sites/${siteId}/conversations`),
    openDirect: (siteId, userId) =>
      call<ConversationSummary>(`/sites/${siteId}/conversations/direct`, { method: "POST", json: { userId } }),
    listMessages: (conversationId) => call<MessageView[]>(`/conversations/${conversationId}/messages?limit=100`),
    sendText: (conversationId, input) =>
      call<SendResult>(`/conversations/${conversationId}/messages`, { method: "POST", json: input }),
    sendAudio: (conversationId, input) =>
      call<SendResult>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: audioForm({ clientMessageId: input.clientMessageId }, { uri: input.audioUri, mimeType: input.mimeType }),
        timeoutMs: 30_000,
      }),
    retryMessage: (messageId) => call<SendResult>(`/messages/${messageId}/retry`, { method: "POST" }),

    createInstruction: (siteId, input) => {
      const { clientMessageId, target, requiresAck } = input;
      if ("text" in input) {
        return call<SendResult>(`/sites/${siteId}/instructions`, {
          method: "POST",
          json: { clientMessageId, text: input.text, target, requiresAck },
        });
      }
      return call<SendResult>(`/sites/${siteId}/instructions`, {
        method: "POST",
        body: audioForm(
          { clientMessageId, target: JSON.stringify(target), requiresAck: String(requiresAck) },
          { uri: input.audioUri, mimeType: input.mimeType },
        ),
        timeoutMs: 30_000,
      });
    },
    listInstructions: (siteId) => call<InstructionSummary[]>(`/sites/${siteId}/instructions`),
    getInstruction: (messageId) => call<InstructionDetail>(`/instructions/${messageId}`),
    getInbox: (siteId) => call<InboxItem[]>(`/sites/${siteId}/inbox`),
    ackInstruction: (messageId) => call<void>(`/instructions/${messageId}/ack`, { method: "POST" }),
    completeInstruction: (messageId, note) =>
      call<void>(`/instructions/${messageId}/complete`, { method: "POST", json: note ? { note } : {} }),

    startCall: (siteId, userId) => call<LiveSession>(`/sites/${siteId}/calls`, { method: "POST", json: { userId } }),
    startBroadcast: (siteId, target) => call<LiveSession>(`/sites/${siteId}/broadcasts`, { method: "POST", json: { target } }),
    getSession: (sessionId) => call<LiveSession>(`/sessions/${sessionId}`),
    listOpenSessions: (siteId) => call<LiveSession[]>(`/sites/${siteId}/sessions/open`),
    listSessions: (siteId, mode) => call<LiveSession[]>(`/sites/${siteId}/sessions${mode ? `?mode=${mode}` : ""}`),
    acceptSession: (sessionId) => call<LiveSession>(`/sessions/${sessionId}/accept`, { method: "POST" }),
    declineSession: (sessionId) => call<LiveSession>(`/sessions/${sessionId}/decline`, { method: "POST" }),
    endSession: (sessionId) => call<LiveSession>(`/sessions/${sessionId}/end`, { method: "POST" }),
    sendUtterance: (sessionId, input) =>
      call<SendResult>(`/sessions/${sessionId}/utterances`, {
        method: "POST",
        body: audioForm({ clientMessageId: input.clientMessageId }, { uri: input.audioUri, mimeType: input.mimeType }),
        timeoutMs: 30_000,
      }),
    listSessionMessages: (sessionId) => call<MessageView[]>(`/sessions/${sessionId}/messages`),
  };
}
