import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { MemberAction, MessageView, ProfileInput, SiteInput } from "@shared/api";
import type { Lang } from "@shared/languages";
import { newId } from "@/lib/id";
import { services } from "@/services";
import type { InstructionInput } from "@/services/types";
import { useSessionStore } from "@/stores/session";

const { api } = services;

export const qk = {
  health: ["health"] as const,
  me: ["me"] as const,
  sites: ["sites"] as const,
  members: (siteId: string) => ["members", siteId] as const,
  codes: (siteId: string) => ["codes", siteId] as const,
  conversations: (siteId: string) => ["conversations", siteId] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  instructions: (siteId: string) => ["instructions", siteId] as const,
  instruction: (messageId: string) => ["instruction", messageId] as const,
  inbox: (siteId: string) => ["inbox", siteId] as const,
};

/** 현재 선택된 현장 id (사이트 화면 안에서는 항상 있음) */
export const useSiteId = () => useSessionStore((state) => state.siteId) ?? "";

// ─── 조회 ───────────────────────────────────────────

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: api.getHealth, refetchInterval: 15_000 });
export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, queryFn: api.getMe, enabled });
export const useMySites = () => useQuery({ queryKey: qk.sites, queryFn: api.getMySites });

export function useCurrentSite() {
  const siteId = useSiteId();
  const sites = useMySites();
  return { ...sites, site: sites.data?.find((site) => site.id === siteId) };
}

export const useMembers = (siteId: string) =>
  useQuery({ queryKey: qk.members(siteId), queryFn: () => api.listMembers(siteId), enabled: !!siteId });
export const useJoinCodes = (siteId: string) =>
  useQuery({ queryKey: qk.codes(siteId), queryFn: () => api.listJoinCodes(siteId), enabled: !!siteId });
export const useConversations = (siteId: string) =>
  useQuery({ queryKey: qk.conversations(siteId), queryFn: () => api.listConversations(siteId), enabled: !!siteId });
export const useMessages = (conversationId: string) =>
  useQuery({ queryKey: qk.messages(conversationId), queryFn: () => api.listMessages(conversationId), enabled: !!conversationId });
export const useInstructions = (siteId: string, enabled = true) =>
  useQuery({ queryKey: qk.instructions(siteId), queryFn: () => api.listInstructions(siteId), enabled: !!siteId && enabled });
export const useInstruction = (messageId: string) =>
  useQuery({ queryKey: qk.instruction(messageId), queryFn: () => api.getInstruction(messageId), enabled: !!messageId });
export const useInbox = (siteId: string, enabled = true) =>
  useQuery({ queryKey: qk.inbox(siteId), queryFn: () => api.getInbox(siteId), enabled: !!siteId && enabled });

// ─── 변경 ───────────────────────────────────────────

export function useSaveProfile() {
  const client = useQueryClient();
  const setUiLang = useSessionStore((state) => state.setUiLang);
  return useMutation({
    mutationFn: (input: ProfileInput) => api.saveMe(input),
    onSuccess: (profile) => {
      client.setQueryData(qk.me, profile);
      setUiLang(profile.preferredLang);
      // 언어가 바뀌면 번역문이 달라지므로 대화·지시를 다시 불러온다.
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    },
  });
}

export function useCreateSite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SiteInput) => api.createSite(input),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.sites }),
  });
}

export function useJoin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.join(code),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.sites }),
  });
}

export function useCreateJoinCode(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.createJoinCode(siteId, { expiresInHours: 24 * 7 }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.codes(siteId) }),
  });
}

export function useRevokeJoinCode(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (codeId: string) => api.revokeJoinCode(siteId, codeId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.codes(siteId) }),
  });
}

export function useUpdateMember(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: MemberAction }) => api.updateMember(siteId, userId, action),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.members(siteId) });
      void client.invalidateQueries({ queryKey: qk.sites });
      void client.invalidateQueries({ queryKey: qk.conversations(siteId) });
    },
  });
}

export function useOpenDirect(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.openDirect(siteId, userId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.conversations(siteId) }),
  });
}

/** 보내는 즉시 화면에 표시(낙관적 갱신)하고, 서버 결과로 다시 맞춘다. */
function addPending(client: QueryClient, conversationId: string, message: MessageView) {
  client.setQueryData<MessageView[]>(qk.messages(conversationId), (current = []) => [...current, message]);
}

export type SendInput = { kind: "text"; text: string } | { kind: "audio"; uri: string; mimeType: string };

export function useSendMessage(conversationId: string, me: { id: string; name: string; lang: Lang }) {
  const client = useQueryClient();
  const siteId = useSiteId();
  return useMutation({
    mutationFn: async ({ input, clientMessageId }: { input: SendInput; clientMessageId: string }) =>
      input.kind === "text"
        ? api.sendText(conversationId, { clientMessageId, text: input.text })
        : api.sendAudio(conversationId, { clientMessageId, audioUri: input.uri, mimeType: input.mimeType }),
    onMutate: ({ input, clientMessageId }) => {
      addPending(client, conversationId, {
        id: `local:${clientMessageId}`,
        kind: "direct",
        siteId,
        conversationId,
        seq: Number.MAX_SAFE_INTEGER,
        senderId: me.id,
        senderName: me.name,
        sourceLang: me.lang,
        originalText: input.kind === "text" ? input.text : null,
        text: input.kind === "text" ? input.text : null,
        audioUrl: null,
        status: "queued",
        requiresAck: false,
        createdAt: new Date().toISOString(),
      });
    },
    onError: (_error, { clientMessageId }) => {
      client.setQueryData<MessageView[]>(qk.messages(conversationId), (current = []) =>
        current.map((message) => (message.id === `local:${clientMessageId}` ? { ...message, status: "failed" } : message)),
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.messages(conversationId) });
      void client.invalidateQueries({ queryKey: qk.conversations(siteId) });
    },
  });
}

export const newClientMessageId = newId;

export function useRetryMessage(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.retryMessage(messageId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.messages(conversationId) }),
  });
}

export function useCreateInstruction(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: InstructionInput) => api.createInstruction(siteId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.instructions(siteId) }),
  });
}

export function useRetryInstruction(siteId: string, messageId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.retryMessage(messageId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.instruction(messageId) });
      void client.invalidateQueries({ queryKey: qk.instructions(siteId) });
    },
  });
}

export function useRespondInstruction(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, action, note }: { messageId: string; action: "ack" | "complete"; note?: string }) =>
      action === "ack" ? api.ackInstruction(messageId) : api.completeInstruction(messageId, note),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.inbox(siteId) }),
  });
}
