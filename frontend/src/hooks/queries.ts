import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { InstructionTarget, LiveSession, MemberAction, MessageView, ProfileInput, SessionMode, SiteInput } from "@shared/api";
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
  targetGroups: (siteId: string) => ["targetGroups", siteId] as const,
  conversations: (siteId: string) => ["conversations", siteId] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  instructions: (siteId: string) => ["instructions", siteId] as const,
  instruction: (messageId: string) => ["instruction", messageId] as const,
  inbox: (siteId: string) => ["inbox", siteId] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
  sessionMessages: (sessionId: string) => ["sessionMessages", sessionId] as const,
  openSessions: (siteId: string) => ["openSessions", siteId] as const,
  sessions: (siteId: string, mode?: SessionMode) => ["sessions", siteId, mode ?? "all"] as const,
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

// ─── 작업조 (B2) ───

export const useTargetGroups = (siteId: string, enabled = true) =>
  useQuery({ queryKey: qk.targetGroups(siteId), queryFn: () => api.listTargetGroups(siteId), enabled: !!siteId && enabled });

/** 저장: id 가 있으면 수정(이름·구성원), 없으면 새로 만들기 */
export function useSaveTargetGroup(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; name?: string; userIds?: string[] }) =>
      input.id
        ? api.updateTargetGroup(siteId, input.id, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.userIds ? { userIds: input.userIds } : {}) })
        : api.createTargetGroup(siteId, { name: input.name ?? "", userIds: input.userIds ?? [] }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.targetGroups(siteId) }),
  });
}

export function useDeleteTargetGroup(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.deleteTargetGroup(siteId, groupId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.targetGroups(siteId) }),
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
        sessionId: null,
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

// ─── 실시간 통역 세션 ─────────────────────────────────

export const useSession = (sessionId: string) =>
  useQuery({ queryKey: qk.session(sessionId), queryFn: () => api.getSession(sessionId), enabled: !!sessionId });
export const useSessionMessages = (sessionId: string) =>
  useQuery({ queryKey: qk.sessionMessages(sessionId), queryFn: () => api.listSessionMessages(sessionId), enabled: !!sessionId });
/** 내가 참여 중인 울림·진행 중 세션 (상단 배너·복원용) */
export const useOpenSessions = (siteId: string) =>
  useQuery({ queryKey: qk.openSessions(siteId), queryFn: () => api.listOpenSessions(siteId), enabled: !!siteId });

const STATUS_ORDER: Record<LiveSession["status"], number> = { ringing: 0, active: 1, ended: 2 };

/**
 * 세션을 화면 데이터에 넣는다. 상태는 울림 → 통화 중 → 종료로만 나아가게 한다: 늦게 도착한 옛 상태가 먼저 온 새 상태를 덮어쓰지 않게.
 * 2026-10-26 iPhone: 상대(자동 받기 스크립트)가 0.01초 만에 받아 "통화 중" 알림이 "걸기" 응답(울림)보다 먼저 와서,
 * 응답이 그것을 덮어써 화면이 "부르는 중…" 에 멈췄다 (통화 상대 바꾸기 C1 시험).
 */
export function cacheSession(client: QueryClient, session: LiveSession) {
  client.setQueryData<LiveSession>(qk.session(session.id), (current) =>
    current && STATUS_ORDER[current.status] > STATUS_ORDER[session.status] ? current : session,
  );
  void client.invalidateQueries({ queryKey: qk.openSessions(session.siteId) });
}

/** 지금 내 1:1 연결 (C2 연결 방식): 열린 세션 중 통화 중인 1:1 */
export function useActiveConnection(siteId: string) {
  const open = useOpenSessions(siteId);
  return open.data?.find((s) => s.mode === "call" && s.status === "active");
}

/** 1:1 연결 시작 (C2): 받기 없이 바로 연결 */
export function useConnect(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.startCall(siteId, userId, { connect: true }),
    onSuccess: (session) => {
      cacheSession(client, session);
      void client.invalidateQueries({ queryKey: qk.conversations(siteId) });
    },
  });
}

/** 연결 전환 (C2): 지금 연결을 끝내고 다른 사람과 바로 연결 */
export function useSwitchConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, userId }: { sessionId: string; userId: string }) => api.switchCall(sessionId, userId),
    onSuccess: (session, { sessionId }) => {
      const previous = client.getQueryData<LiveSession>(qk.session(sessionId));
      if (previous && previous.status !== "ended") cacheSession(client, { ...previous, status: "ended", endReason: "hangup" });
      cacheSession(client, session);
      void client.invalidateQueries({ queryKey: qk.conversations(session.siteId) });
    },
  });
}

export function useStartBroadcast(siteId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: InstructionTarget) => api.startBroadcast(siteId, target),
    onSuccess: (session) => cacheSession(client, session),
  });
}

/** 받기·거절·끊기 */
export function useSessionAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, action }: { sessionId: string; action: "accept" | "decline" | "end" }) =>
      action === "accept" ? api.acceptSession(sessionId) : action === "decline" ? api.declineSession(sessionId) : api.endSession(sessionId),
    onSuccess: (session) => cacheSession(client, session),
  });
}

/** 핸즈프리로 감지한 발화 1건 전송 */
export function useSendUtterance(sessionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { uri: string; mimeType: string }) =>
      api.sendUtterance(sessionId, { clientMessageId: newId(), audioUri: input.uri, mimeType: input.mimeType }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.sessionMessages(sessionId) }),
  });
}
