import type {
  ConversationSummary,
  HealthResponse,
  InboxItem,
  InstructionDetail,
  InstructionSummary,
  InstructionTarget,
  JoinCode,
  JoinCodeInput,
  JoinResult,
  Member,
  MemberAction,
  MessageView,
  MySite,
  Profile,
  ProfileInput,
  SendAudioInput,
  SendResult,
  SendTextInput,
  SiteInput,
} from "@shared/api";
import type { ServerEventName, ServerToClientEvents } from "@shared/realtime";
import type { AuthUser, ConnectionState } from "@/stores/session";

export type AuthSession = { user: AuthUser; accessToken: string };

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  onChange(listener: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** 이메일 확인이 필요하면 needsConfirmation=true (세션 없음) */
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** 비밀번호 재설정 메일 링크(딥링크)로 세션을 복원한다. */
  handleAuthRedirect(url: string): Promise<boolean>;
}

export type InstructionInput = {
  clientMessageId: string;
  target: InstructionTarget;
  requiresAck: boolean;
} & ({ text: string } | { audioUri: string; mimeType: string });

export interface ApiService {
  getHealth(): Promise<HealthResponse | null>;

  /** 프로필이 아직 없으면 null */
  getMe(): Promise<Profile | null>;
  saveMe(input: ProfileInput): Promise<Profile>;

  getMySites(): Promise<MySite[]>;
  createSite(input: SiteInput): Promise<MySite>;
  join(code: string): Promise<JoinResult>;

  listJoinCodes(siteId: string): Promise<JoinCode[]>;
  createJoinCode(siteId: string, input?: JoinCodeInput): Promise<JoinCode>;
  revokeJoinCode(siteId: string, codeId: string): Promise<void>;

  listMembers(siteId: string): Promise<Member[]>;
  updateMember(siteId: string, userId: string, action: MemberAction): Promise<void>;

  listConversations(siteId: string): Promise<ConversationSummary[]>;
  openDirect(siteId: string, userId: string): Promise<ConversationSummary>;
  listMessages(conversationId: string): Promise<MessageView[]>;
  sendText(conversationId: string, input: SendTextInput): Promise<SendResult>;
  sendAudio(conversationId: string, input: SendAudioInput): Promise<SendResult>;
  retryMessage(messageId: string): Promise<SendResult>;

  createInstruction(siteId: string, input: InstructionInput): Promise<SendResult>;
  listInstructions(siteId: string): Promise<InstructionSummary[]>;
  getInstruction(messageId: string): Promise<InstructionDetail>;
  getInbox(siteId: string): Promise<InboxItem[]>;
  ackInstruction(messageId: string): Promise<void>;
  completeInstruction(messageId: string, note?: string): Promise<void>;
}

export interface RealtimeService {
  connect(): void;
  disconnect(): void;
  subscribeSite(siteId: string): Promise<void>;
  on<E extends ServerEventName>(event: E, handler: ServerToClientEvents[E]): () => void;
  onConnection(listener: (state: ConnectionState) => void): () => void;
  sendReceipts(messageIds: string[]): Promise<void>;
}

export type Services = { mode: "mock" | "live"; auth: AuthService; api: ApiService; realtime: RealtimeService };
