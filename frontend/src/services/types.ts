import type {
  ConversationSummary,
  DeviceStatus,
  HealthResponse,
  InboxItem,
  InstructionDetail,
  InstructionSummary,
  InstructionTarget,
  JoinCode,
  JoinCodeInput,
  JoinResult,
  LiveSession,
  Member,
  MemberAction,
  MessageView,
  MySite,
  Profile,
  ProfileInput,
  SendAudioInput,
  SendResult,
  SendTextInput,
  SendUtteranceInput,
  SessionMode,
  SiteInput,
  TargetGroup,
  TargetGroupInput,
} from "@shared/api";
import type { ServerEventName, ServerToClientEvents, StreamFormat, StreamOpenResult } from "@shared/realtime";
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

  // 실시간 통역 세션 (docs/live-interpretation.md)
  startCall(siteId: string, userId: string): Promise<LiveSession>;
  startBroadcast(siteId: string, target: InstructionTarget): Promise<LiveSession>;
  getSession(sessionId: string): Promise<LiveSession>;
  /** 내가 참여 중인 울림·진행 중 세션 */
  listOpenSessions(siteId: string): Promise<LiveSession[]>;
  listSessions(siteId: string, mode?: SessionMode): Promise<LiveSession[]>;
  acceptSession(sessionId: string): Promise<LiveSession>;
  declineSession(sessionId: string): Promise<LiveSession>;
  endSession(sessionId: string): Promise<LiveSession>;
  /** 말이 끝날 때마다 문장 단위 음성을 보낸다 */
  sendUtterance(sessionId: string, input: SendUtteranceInput): Promise<SendResult>;
  listSessionMessages(sessionId: string): Promise<MessageView[]>;

  // 일괄 지시 작업조 (B2, 관리자만)
  listTargetGroups(siteId: string): Promise<TargetGroup[]>;
  createTargetGroup(siteId: string, input: TargetGroupInput): Promise<TargetGroup>;
  updateTargetGroup(siteId: string, groupId: string, input: Partial<TargetGroupInput>): Promise<TargetGroup>;
  deleteTargetGroup(siteId: string, groupId: string): Promise<void>;
}

export interface RealtimeService {
  connect(): void;
  disconnect(): void;
  subscribeSite(siteId: string): Promise<void>;
  on<E extends ServerEventName>(event: E, handler: ServerToClientEvents[E]): () => void;
  onConnection(listener: (state: ConnectionState) => void): () => void;
  sendReceipts(messageIds: string[]): Promise<void>;
  /** 내 오디오 장치 상태(헤드셋·마이크 권한)를 알린다 */
  reportDevice(device: DeviceStatus): Promise<void>;

  // 스트리밍 통역 (1:1 통화, docs/realtime-protocol.md 10절). ok 가 아니면 앱은 발화 단위 방식을 쓴다.
  openStream(sessionId: string, format: StreamFormat): Promise<StreamOpenResult>;
  /** 음성 조각 (PCM16 mono, 약 100ms). 연결이 끊겨 있으면 버린다 */
  sendStreamAudio(streamId: string, seq: number, pcm: ArrayBuffer): void;
  /** 단말이 말 끝을 판단했을 때 */
  pauseStream(streamId: string): void;
  closeStream(streamId: string): void;
}

export type Services = { mode: "mock" | "live"; auth: AuthService; api: ApiService; realtime: RealtimeService };
