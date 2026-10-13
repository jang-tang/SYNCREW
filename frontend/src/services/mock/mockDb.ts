// 데모 모드 전용 메모리 DB. 서버(docs/database-design.md)의 동작을 단순하게 흉내 낸다.
// 앱을 다시 시작하면 초기 데이터로 돌아간다 (프로필·로그인만 기기에 저장).
import type {
  ConversationSummary,
  DeviceStatus,
  InboxItem,
  InstructionDetail,
  InstructionSummary,
  JoinCode,
  LiveSession,
  Member,
  MembershipStatus,
  MessageKind,
  MessageStatus,
  MessageView,
  MySite,
  Profile,
  RecipientCounts,
  RecipientStatus,
  SessionEndReason,
  SessionRole,
  SiteRole,
  TranslationStatus,
} from "@shared/api";
import type { Lang } from "@shared/languages";
import { newId } from "@/lib/id";
import { mockBus } from "./bus";
import { demoTranslate, P, PHRASES } from "./phrases";

export const ME = "me";

type User = { id: string; displayName: string; lang: Lang; online: boolean; device?: DeviceStatus };
type Session = {
  id: string;
  siteId: string;
  mode: "call" | "broadcast";
  status: "ringing" | "active" | "ended";
  conversationId: string | null;
  startedBy: string;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: SessionEndReason | null;
  participants: { userId: string; role: SessionRole }[];
};
type Site = { id: string; name: string; address: string | null };
type Membership = { siteId: string; userId: string; role: SiteRole; status: MembershipStatus; langOverride: Lang | null };
type Conversation = { id: string; siteId: string; type: "direct" | "group"; participants: Set<string> };
type Recipient = {
  lang: Lang;
  status: RecipientStatus;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  completedAt: string | null;
  note: string | null;
};
type Message = {
  id: string;
  clientMessageId: string;
  kind: MessageKind;
  siteId: string;
  conversationId: string | null;
  seq: number;
  senderId: string;
  sourceLang: Lang;
  originalText: string;
  translations: Map<Lang, { status: TranslationStatus; text: string | null }>;
  status: MessageStatus;
  requiresAck: boolean;
  createdAt: string;
  recipients: Map<string, Recipient>;
  sessionId: string | null;
};
type Code = JoinCode & { siteId: string; revoked: boolean };

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const later = (ms: number, task: () => void) => setTimeout(task, ms);

class MockDb {
  profile: Profile | null = null;
  /** 데모 로그인 이메일 (프로필 생성 시 사용) */
  sessionEmail = "";
  users = new Map<string, User>();
  sites = new Map<string, Site>();
  memberships: Membership[] = [];
  conversations = new Map<string, Conversation>();
  messages = new Map<string, Message>();
  codes: Code[] = [];
  lastRead = new Map<string, number>();
  sessions = new Map<string, Session>();
  private seq = 1;

  constructor() {
    this.seed();
  }

  // ─── 초기 데이터 ───────────────────────────────────

  private seed() {
    const users: User[] = [
      { id: ME, displayName: "", lang: "ko", online: true },
      { id: "u_kim", displayName: "김민준", lang: "ko", online: true },
      { id: "u_nguyen", displayName: "Nguyễn Văn An", lang: "vi", online: true },
      { id: "u_tran", displayName: "Trần Thị Mai", lang: "vi", online: false },
      { id: "u_li", displayName: "李伟", lang: "zh", online: true },
      { id: "u_aziz", displayName: "Aziz Karimov", lang: "uz", online: false },
      { id: "u_ivan", displayName: "Иван Петров", lang: "ru", online: true },
      { id: "u_park", displayName: "박현우", lang: "ko", online: true },
      { id: "u_dilnoza", displayName: "Dilnoza Yusupova", lang: "uz", online: true },
    ];
    users.forEach((user) => this.users.set(user.id, user));
    // 데모: 접속 중인 작업자들의 오디오 장치 (대부분 블루투스 헤드셋, 한 명은 휴대폰 스피커)
    const bt = (name: string): DeviceStatus => ({ audioRoute: "bluetooth", inputName: name, micPermission: "granted" });
    this.users.get("u_kim")!.device = bt("SafeHelmet BT-2");
    this.users.get("u_nguyen")!.device = bt("SafeHelmet BT-2");
    this.users.get("u_li")!.device = { audioRoute: "builtin", inputName: null, micPermission: "granted" };
    this.users.get("u_ivan")!.device = bt("Jabra Talk");
    this.users.get("u_park")!.device = bt("SafeHelmet BT-2");
    this.users.get("u_dilnoza")!.device = bt("SafeHelmet BT-2");

    this.sites.set("s_a", { id: "s_a", name: "A동 신축 현장", address: "경기도 안산시 단원구" });
    this.sites.set("s_b", { id: "s_b", name: "평택 물류센터 현장", address: "경기도 평택시 포승읍" });
    this.sites.set("s_c", { id: "s_c", name: "인천 항만 창고 현장", address: "인천광역시 중구" });

    const member = (siteId: string, userId: string, role: SiteRole = "member", status: MembershipStatus = "active") =>
      this.memberships.push({ siteId, userId, role, status, langOverride: null });
    member("s_a", ME, "manager");
    ["u_kim", "u_nguyen", "u_li", "u_aziz", "u_ivan"].forEach((id) => member("s_a", id));
    member("s_a", "u_tran", "member", "pending");
    member("s_b", "u_park", "manager");
    member("s_b", ME);
    ["u_li", "u_dilnoza", "u_ivan"].forEach((id) => member("s_b", id));
    member("s_c", "u_park", "manager");

    for (const siteId of ["s_a", "s_b", "s_c"]) {
      const participants = new Set(this.memberships.filter((m) => m.siteId === siteId && m.status === "active").map((m) => m.userId));
      this.conversations.set(`${siteId}_group`, { id: `${siteId}_group`, siteId, type: "group", participants });
    }
    this.conversations.set("c_nguyen", { id: "c_nguyen", siteId: "s_a", type: "direct", participants: new Set([ME, "u_nguyen"]) });
    this.conversations.set("c_li", { id: "c_li", siteId: "s_a", type: "direct", participants: new Set([ME, "u_li"]) });

    const seedMessage = (input: {
      kind: MessageKind;
      siteId: string;
      conversationId: string | null;
      senderId: string;
      phrase: number;
      minutesAgo: number;
      recipients?: Partial<Record<string, RecipientStatus>>;
    }) => {
      const sender = this.users.get(input.senderId)!;
      const message = this.createMessage({
        kind: input.kind,
        siteId: input.siteId,
        conversationId: input.conversationId,
        senderId: input.senderId,
        text: PHRASES[input.phrase]![sender.lang],
        requiresAck: input.kind === "instruction",
        recipientIds: this.defaultRecipients(input.kind, input.siteId, input.conversationId, input.senderId),
        createdAt: minutesAgo(input.minutesAgo),
      });
      this.completeTranslations(message);
      for (const [userId, recipient] of message.recipients) {
        const status = input.recipients?.[userId] ?? "delivered";
        this.setRecipientStatus(message, userId, status, recipient);
      }
      return message;
    };

    seedMessage({ kind: "group", siteId: "s_a", conversationId: "s_a_group", senderId: "u_ivan", phrase: P.shortage, minutesAgo: 25 });
    seedMessage({ kind: "group", siteId: "s_a", conversationId: "s_a_group", senderId: ME, phrase: P.gateB, minutesAgo: 22 });
    seedMessage({ kind: "direct", siteId: "s_a", conversationId: "c_nguyen", senderId: ME, phrase: P.helmet, minutesAgo: 62 });
    seedMessage({ kind: "direct", siteId: "s_a", conversationId: "c_nguyen", senderId: "u_nguyen", phrase: P.understood, minutesAgo: 60 });
    seedMessage({ kind: "direct", siteId: "s_a", conversationId: "c_li", senderId: "u_li", phrase: P.whereToGo, minutesAgo: 8 });
    seedMessage({
      kind: "instruction", siteId: "s_a", conversationId: null, senderId: ME, phrase: P.formwork, minutesAgo: 120,
      recipients: { u_kim: "completed", u_nguyen: "acknowledged", u_li: "acknowledged", u_aziz: "delivered", u_ivan: "sent" },
    });
    seedMessage({
      kind: "instruction", siteId: "s_a", conversationId: null, senderId: ME, phrase: P.harness, minutesAgo: 60 * 26,
      recipients: { u_kim: "completed", u_nguyen: "completed", u_li: "completed", u_aziz: "completed", u_ivan: "completed" },
    });
    seedMessage({ kind: "group", siteId: "s_b", conversationId: "s_b_group", senderId: "u_park", phrase: P.lunch, minutesAgo: 95 });
    seedMessage({ kind: "instruction", siteId: "s_b", conversationId: null, senderId: "u_park", phrase: P.helmet, minutesAgo: 60 * 20, recipients: { [ME]: "completed" } });
    seedMessage({ kind: "instruction", siteId: "s_b", conversationId: null, senderId: "u_park", phrase: P.gateB, minutesAgo: 30, recipients: { [ME]: "delivered" } });

    this.lastRead.set("s_a_group", this.seq);
    this.lastRead.set("c_nguyen", this.seq);
    this.lastRead.set("s_b_group", this.seq);

    this.codes.push({
      id: "code_a", siteId: "s_a", code: "A7K92QXM", expiresAt: null, maxUses: null, useCount: 5,
      qrPayload: "syncrew://join?code=A7K92QXM", revoked: false,
    });
    this.codes.push({
      id: "code_c", siteId: "s_c", code: "SYNC2026", expiresAt: null, maxUses: null, useCount: 0,
      qrPayload: "syncrew://join?code=SYNC2026", revoked: false,
    });
  }

  // ─── 공통 ─────────────────────────────────────────

  membership(siteId: string, userId: string) {
    return this.memberships.find((m) => m.siteId === siteId && m.userId === userId);
  }

  langIn(siteId: string, userId: string): Lang {
    return this.membership(siteId, userId)?.langOverride ?? this.users.get(userId)!.lang;
  }

  private nameOf(userId: string) {
    return this.users.get(userId)?.displayName || "—";
  }

  private defaultRecipients(kind: MessageKind, siteId: string, conversationId: string | null, senderId: string) {
    if (kind === "instruction") {
      return this.memberships
        .filter((m) => m.siteId === siteId && m.status === "active" && m.userId !== senderId && m.role === "member")
        .map((m) => m.userId);
    }
    return [...this.conversations.get(conversationId!)!.participants].filter((id) => id !== senderId);
  }

  private createMessage(input: {
    kind: MessageKind;
    siteId: string;
    conversationId: string | null;
    senderId: string;
    text: string;
    requiresAck: boolean;
    recipientIds: string[];
    clientMessageId?: string;
    createdAt?: string;
    sessionId?: string | null;
  }): Message {
    const sourceLang = this.langIn(input.siteId, input.senderId);
    const recipients = new Map<string, Recipient>();
    const translations = new Map<Lang, { status: TranslationStatus; text: string | null }>();
    for (const userId of input.recipientIds) {
      const lang = this.langIn(input.siteId, userId);
      recipients.set(userId, { lang, status: "pending", deliveredAt: null, acknowledgedAt: null, completedAt: null, note: null });
      if (!translations.has(lang)) {
        translations.set(lang, lang === sourceLang ? { status: "skipped", text: input.text } : { status: "processing", text: null });
      }
    }
    const message: Message = {
      id: newId(),
      clientMessageId: input.clientMessageId ?? newId(),
      kind: input.kind,
      siteId: input.siteId,
      conversationId: input.conversationId,
      seq: this.seq++,
      senderId: input.senderId,
      sourceLang,
      originalText: input.text,
      translations,
      status: "processing",
      requiresAck: input.requiresAck,
      createdAt: input.createdAt ?? new Date().toISOString(),
      recipients,
      sessionId: input.sessionId ?? null,
    };
    this.messages.set(message.id, message);
    return message;
  }

  private completeTranslations(message: Message) {
    for (const [lang, translation] of message.translations) {
      if (translation.status === "skipped") continue;
      message.translations.set(lang, { status: "done", text: demoTranslate(message.originalText, message.sourceLang, lang) });
    }
    message.status = "done";
    for (const recipient of message.recipients.values()) if (recipient.status === "pending") recipient.status = "sent";
  }

  private setRecipientStatus(message: Message, userId: string, status: RecipientStatus, recipient = message.recipients.get(userId)!) {
    const now = message.createdAt;
    recipient.status = status;
    const order: RecipientStatus[] = ["pending", "sent", "delivered", "acknowledged", "completed"];
    const reached = (target: RecipientStatus) => order.indexOf(status) >= order.indexOf(target);
    if (reached("delivered")) recipient.deliveredAt ??= now;
    if (reached("acknowledged")) recipient.acknowledgedAt ??= now;
    if (reached("completed")) recipient.completedAt ??= now;
  }

  // ─── 조회용 변환 ───────────────────────────────────

  view(message: Message, viewerId: string): MessageView {
    const isSender = message.senderId === viewerId;
    const viewerLang = this.langIn(message.siteId, viewerId);
    const translation = message.translations.get(viewerLang);
    const text =
      isSender || viewerLang === message.sourceLang
        ? message.originalText
        : translation
          ? translation.text
          : demoTranslate(message.originalText, message.sourceLang, viewerLang);
    const view: MessageView = {
      id: message.id,
      kind: message.kind,
      siteId: message.siteId,
      conversationId: message.conversationId,
      seq: message.seq,
      senderId: message.senderId,
      senderName: this.nameOf(message.senderId),
      sourceLang: message.sourceLang,
      originalText: message.originalText,
      text,
      audioUrl: null,
      status: message.status,
      requiresAck: message.requiresAck,
      createdAt: message.createdAt,
      sessionId: message.sessionId,
    };
    if (isSender) view.translations = [...message.translations].map(([lang, t]) => ({ lang, status: t.status }));
    const mine = message.recipients.get(viewerId);
    if (mine) view.myStatus = mine.status;
    return view;
  }

  counts(message: Message): RecipientCounts {
    const counts: RecipientCounts = { pending: 0, sent: 0, delivered: 0, acknowledged: 0, completed: 0, failed: 0 };
    for (const recipient of message.recipients.values()) counts[recipient.status] += 1;
    return counts;
  }

  // ─── 현장 ─────────────────────────────────────────

  mySites(): MySite[] {
    return this.memberships
      .filter((m) => m.userId === ME)
      .map((m) => {
        const site = this.sites.get(m.siteId)!;
        return {
          ...site,
          status: "active" as const,
          role: m.role,
          membershipStatus: m.status,
          memberCount: this.memberships.filter((x) => x.siteId === m.siteId && x.status === "active").length,
        };
      });
  }

  createSite(name: string, address: string | null): MySite {
    const id = `s_${newId().slice(0, 8)}`;
    this.sites.set(id, { id, name, address });
    this.memberships.push({ siteId: id, userId: ME, role: "manager", status: "active", langOverride: null });
    this.conversations.set(`${id}_group`, { id: `${id}_group`, siteId: id, type: "group", participants: new Set([ME]) });
    this.createCode(id);
    return this.mySites().find((site) => site.id === id)!;
  }

  createCode(siteId: string): JoinCode {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let index = 0; index < 8; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    const entry: Code = {
      id: newId(), siteId, code, expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      maxUses: null, useCount: 0, qrPayload: `syncrew://join?code=${code}`, revoked: false,
    };
    this.codes.push(entry);
    return entry;
  }

  join(code: string) {
    const entry = this.codes.find((c) => c.code === code.toUpperCase() && !c.revoked);
    if (!entry) return { error: "INVALID_JOIN_CODE" as const };
    const existing = this.membership(entry.siteId, ME);
    if (existing?.status === "active") return { error: "ALREADY_MEMBER" as const };
    if (existing) existing.status = "pending";
    else this.memberships.push({ siteId: entry.siteId, userId: ME, role: "member", status: "pending", langOverride: null });
    entry.useCount += 1;
    const site = this.sites.get(entry.siteId)!;

    // 데모: 4초 뒤 관리자가 승인
    later(4000, () => {
      const membership = this.membership(entry.siteId, ME);
      if (membership?.status !== "pending") return;
      membership.status = "active";
      this.conversations.get(`${entry.siteId}_group`)?.participants.add(ME);
      mockBus.emit("membership:changed", { siteId: entry.siteId, userId: ME, role: "member", status: "active" });
    });
    return { result: { siteId: site.id, siteName: site.name, status: "pending" as const } };
  }

  members(siteId: string): Member[] {
    return this.memberships
      .filter((m) => m.siteId === siteId && (m.status === "active" || m.status === "pending"))
      .map((m) => {
        const user = this.users.get(m.userId)!;
        return {
          userId: m.userId,
          displayName: this.nameOf(m.userId),
          role: m.role,
          status: m.status,
          lang: m.langOverride ?? user.lang,
          online: user.online,
          device: user.online ? (user.device ?? null) : null,
        };
      });
  }

  updateMember(
    siteId: string,
    userId: string,
    action: { action: "approve" | "reject" | "remove" } | { langOverride: Lang | null } | { role: SiteRole },
  ) {
    const membership = this.membership(siteId, userId)!;
    const group = this.conversations.get(`${siteId}_group`)!;
    if ("role" in action) {
      membership.role = action.role;
    } else if ("langOverride" in action) {
      membership.langOverride = action.langOverride;
    } else if (action.action === "approve") {
      membership.status = "active";
      group.participants.add(userId);
    } else {
      membership.status = action.action === "reject" ? "rejected" : "removed";
      group.participants.delete(userId);
    }
    mockBus.emit("membership:changed", { siteId, userId, role: membership.role, status: membership.status });
  }

  // ─── 대화 ─────────────────────────────────────────

  conversationsFor(siteId: string): ConversationSummary[] {
    return [...this.conversations.values()]
      .filter((c) => c.siteId === siteId && c.participants.has(ME))
      .map((c) => this.summary(c))
      .sort((a, b) => (a.type === "group" ? -1 : b.type === "group" ? 1 : (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? "")));
  }

  summary(c: Conversation): ConversationSummary {
    const messages = this.messagesOf(c.id);
    const last = messages.at(-1);
    const peerId = c.type === "direct" ? [...c.participants].find((id) => id !== ME)! : null;
    const lastRead = this.lastRead.get(c.id) ?? 0;
    return {
      id: c.id,
      type: c.type,
      title: peerId ? this.nameOf(peerId) : this.sites.get(c.siteId)!.name,
      ...(peerId ? { peer: { userId: peerId, displayName: this.nameOf(peerId), lang: this.langIn(c.siteId, peerId) } } : {}),
      participantCount: c.participants.size,
      ...(last ? { lastMessage: { text: this.view(last, ME).text ?? "…", senderName: this.nameOf(last.senderId), createdAt: last.createdAt } } : {}),
      unreadCount: messages.filter((m) => m.senderId !== ME && m.seq > lastRead).length,
    };
  }

  messagesOf(conversationId: string) {
    return [...this.messages.values()].filter((m) => m.conversationId === conversationId).sort((a, b) => a.seq - b.seq);
  }

  openDirect(siteId: string, userId: string): ConversationSummary {
    const existing = [...this.conversations.values()].find(
      (c) => c.siteId === siteId && c.type === "direct" && c.participants.has(ME) && c.participants.has(userId),
    );
    if (existing) return this.summary(existing);
    const conversation: Conversation = { id: newId(), siteId, type: "direct", participants: new Set([ME, userId]) };
    this.conversations.set(conversation.id, conversation);
    return this.summary(conversation);
  }

  /** 내 메시지 전송: 통역 → 전달 → (데모) 상대 응답 */
  send(conversationId: string, clientMessageId: string, text: string, sessionId: string | null = null) {
    const duplicate = [...this.messages.values()].find((m) => m.clientMessageId === clientMessageId);
    if (duplicate) return duplicate;
    const conversation = this.conversations.get(conversationId)!;
    const message = this.createMessage({
      kind: conversation.type,
      siteId: conversation.siteId,
      conversationId,
      senderId: ME,
      text,
      requiresAck: false,
      recipientIds: this.defaultRecipients(conversation.type, conversation.siteId, conversationId, ME),
      clientMessageId,
      sessionId,
    });
    this.lastRead.set(conversationId, message.seq);
    this.process(message, 900);

    // 데모: 상대방(그룹이면 접속 중인 한 명)이 응답
    const responders = [...conversation.participants].filter((id) => id !== ME && this.users.get(id)!.online);
    const responder = responders[Math.floor(Math.random() * responders.length)];
    if (responder) later(2600, () => this.receive(conversationId, responder, P.understood, sessionId));
    return message;
  }

  /** 다른 사람이 보낸 메시지가 나에게 도착 */
  private receive(conversationId: string, senderId: string, phrase: number, sessionId: string | null = null) {
    const conversation = this.conversations.get(conversationId)!;
    if (!conversation.participants.has(ME)) return;
    // 통화가 그 사이 끝났으면 통화 발화로 오지 않는다
    if (sessionId && this.sessions.get(sessionId)?.status !== "active") return;
    const message = this.createMessage({
      kind: conversation.type,
      siteId: conversation.siteId,
      conversationId,
      senderId,
      text: PHRASES[phrase]![this.langIn(conversation.siteId, senderId)],
      requiresAck: false,
      recipientIds: this.defaultRecipients(conversation.type, conversation.siteId, conversationId, senderId),
      sessionId,
    });
    this.completeTranslations(message);
    mockBus.emit("message:new", { message: this.view(message, ME) });
  }

  private process(message: Message, delayMs: number) {
    mockBus.emit("message:status", { messageId: message.id, status: "processing", translations: this.translationList(message) });
    later(delayMs, () => {
      this.completeTranslations(message);
      mockBus.emit("message:status", {
        messageId: message.id,
        status: message.status,
        translations: this.translationList(message),
        recipients: this.counts(message),
      });
    });
  }

  private translationList(message: Message) {
    return [...message.translations].map(([lang, t]) => ({ lang, status: t.status, ...(t.text ? { text: t.text } : {}) }));
  }

  markRead(conversationId: string) {
    const last = this.messagesOf(conversationId).at(-1);
    if (last) this.lastRead.set(conversationId, last.seq);
  }

  // ─── 일괄 지시 ─────────────────────────────────────

  createInstruction(siteId: string, clientMessageId: string, text: string, userIds: string[], requiresAck: boolean, sessionId: string | null = null) {
    const duplicate = [...this.messages.values()].find((m) => m.clientMessageId === clientMessageId);
    if (duplicate) return duplicate;
    const message = this.createMessage({
      kind: "instruction", siteId, conversationId: null, senderId: ME, text, requiresAck, recipientIds: userIds, clientMessageId, sessionId,
    });
    this.process(message, 1100);

    // 데모: 작업자들이 차례로 수신 → 확인 → 일부 완료
    userIds.forEach((userId, index) => {
      const step = (ms: number, status: RecipientStatus) =>
        later(ms, () => {
          this.setRecipientStatus(message, userId, status);
          message.recipients.get(userId)![status === "delivered" ? "deliveredAt" : status === "acknowledged" ? "acknowledgedAt" : "completedAt"] = new Date().toISOString();
          mockBus.emit("instruction:recipient", { messageId: message.id, userId, status });
        });
      // 접속 중인 작업자만 단말 수신 확인. 실시간 지시(확인 응답 없음)는 수신까지만.
      if (!this.users.get(userId)?.online) return;
      step(1600 + index * 500, "delivered");
      if (!requiresAck) return;
      if (index % 3 !== 2) step(3500 + index * 900, "acknowledged");
      if (index === 0) step(8000, "completed");
    });
    return message;
  }

  instructionSummary(message: Message): InstructionSummary {
    return {
      id: message.id,
      sessionId: message.sessionId,
      senderName: this.nameOf(message.senderId),
      text: message.originalText,
      sourceLang: message.sourceLang,
      status: message.status,
      requiresAck: message.requiresAck,
      createdAt: message.createdAt,
      total: message.recipients.size,
      counts: this.counts(message),
    };
  }

  instructions(siteId: string): InstructionSummary[] {
    return [...this.messages.values()]
      .filter((m) => m.kind === "instruction" && m.siteId === siteId && m.senderId === ME)
      .sort((a, b) => b.seq - a.seq)
      .map((m) => this.instructionSummary(m));
  }

  instructionDetail(messageId: string): InstructionDetail {
    const message = this.messages.get(messageId)!;
    return {
      ...this.instructionSummary(message),
      recipients: [...message.recipients].map(([userId, r]) => ({
        userId,
        displayName: this.nameOf(userId),
        lang: r.lang,
        status: r.status,
        deliveredAt: r.deliveredAt,
        acknowledgedAt: r.acknowledgedAt,
        completedAt: r.completedAt,
        responseNote: r.note,
      })),
      translations: [...message.translations].map(([lang, t]) => ({ lang, status: t.status, text: t.text })),
    };
  }

  inbox(siteId: string): InboxItem[] {
    return [...this.messages.values()]
      .filter((m) => m.kind === "instruction" && m.siteId === siteId && m.recipients.has(ME))
      .sort((a, b) => b.seq - a.seq)
      .map((m) => {
        const mine = m.recipients.get(ME)!;
        return { ...this.view(m, ME), myStatus: mine.status, acknowledgedAt: mine.acknowledgedAt, completedAt: mine.completedAt };
      });
  }

  respond(messageId: string, status: "acknowledged" | "completed", note?: string) {
    const message = this.messages.get(messageId)!;
    const mine = message.recipients.get(ME)!;
    const now = new Date().toISOString();
    if (status === "acknowledged" && mine.status !== "completed") {
      mine.status = "acknowledged";
      mine.acknowledgedAt ??= now;
      mine.deliveredAt ??= now;
    }
    if (status === "completed") {
      mine.status = "completed";
      mine.completedAt = now;
      mine.acknowledgedAt ??= now;
      mine.deliveredAt ??= now;
      if (note) mine.note = note;
    }
  }

  // ─── 실시간 통역 세션 ───────────────────────────────

  sessionView(session: Session): LiveSession {
    return {
      id: session.id,
      siteId: session.siteId,
      mode: session.mode,
      status: session.status,
      conversationId: session.conversationId,
      startedBy: session.startedBy,
      startedByName: this.nameOf(session.startedBy),
      createdAt: session.createdAt,
      answeredAt: session.answeredAt,
      endedAt: session.endedAt,
      endReason: session.endReason,
      participants: session.participants.map(({ userId, role }) => {
        const user = this.users.get(userId)!;
        return {
          userId,
          displayName: this.nameOf(userId),
          lang: this.langIn(session.siteId, userId),
          role,
          online: user.online,
          device: user.online ? (user.device ?? null) : null,
          joinedAt: session.answeredAt,
          leftAt: session.endedAt,
        };
      }),
    };
  }

  private publishSession(session: Session) {
    mockBus.emit("session:updated", { session: this.sessionView(session) });
  }

  private openSession(mode: Session["mode"]) {
    return [...this.sessions.values()].find((s) => s.mode === mode && s.status !== "ended" && s.participants.some((p) => p.userId === ME));
  }

  /** 1:1 통화 걸기. 데모: 접속 중인 상대는 1.5초 뒤 받는다. */
  startCall(siteId: string, userId: string) {
    if (!this.users.get(userId)?.online) return { error: "CONFLICT" as const };
    if (this.openSession("call")) return { error: "BUSY" as const };
    const conversation = this.openDirect(siteId, userId);
    const session: Session = {
      id: newId(), siteId, mode: "call", status: "ringing", conversationId: conversation.id, startedBy: ME,
      createdAt: new Date().toISOString(), answeredAt: null, endedAt: null, endReason: null,
      participants: [{ userId: ME, role: "caller" }, { userId, role: "callee" }],
    };
    this.sessions.set(session.id, session);
    later(1500, () => {
      if (session.status !== "ringing") return;
      session.status = "active";
      session.answeredAt = new Date().toISOString();
      this.publishSession(session);
    });
    return { session: this.sessionView(session) };
  }

  /** 관리자 일괄 지시 시작 */
  startBroadcast(siteId: string, userIds: string[]) {
    if (this.membership(siteId, ME)?.role !== "manager") return { error: "FORBIDDEN" as const };
    if (userIds.length === 0) return { error: "CONFLICT" as const };
    if (this.openSession("broadcast")) return { error: "BUSY" as const };
    const now = new Date().toISOString();
    const session: Session = {
      id: newId(), siteId, mode: "broadcast", status: "active", conversationId: null, startedBy: ME,
      createdAt: now, answeredAt: now, endedAt: null, endReason: null,
      participants: [{ userId: ME, role: "speaker" }, ...userIds.map((userId) => ({ userId, role: "listener" as const }))],
    };
    this.sessions.set(session.id, session);
    return { session: this.sessionView(session) };
  }

  endSession(sessionId: string, reason: SessionEndReason = "hangup") {
    const session = this.sessions.get(sessionId)!;
    if (session.status !== "ended") {
      session.endReason = session.status === "ringing" ? "cancelled" : reason;
      session.status = "ended";
      session.endedAt = new Date().toISOString();
      this.publishSession(session);
    }
    return this.sessionView(session);
  }

  /** 세션 발화: 통화는 1:1 메시지, 일괄 지시는 수신 대상 전원에게 지시 */
  utterance(sessionId: string, clientMessageId: string, text: string) {
    const session = this.sessions.get(sessionId)!;
    if (session.status !== "active") return { error: "CONFLICT" as const };
    if (session.mode === "call") return { message: this.send(session.conversationId!, clientMessageId, text, sessionId) };
    const listeners = session.participants.filter((p) => p.role === "listener").map((p) => p.userId);
    return { message: this.createInstruction(session.siteId, clientMessageId, text, listeners, false, sessionId) };
  }

  /**
   * 데모: 현장 관리자가 나에게 실시간 일괄 지시를 시작해 두 번 말하고 끝낸다 (구성원 화면 확인용).
   * 실제 서버에서는 관리자 앱이 POST /broadcasts 와 발화를 보낸다.
   */
  simulateIncomingBroadcast(siteId: string) {
    const manager = this.memberships.find((m) => m.siteId === siteId && m.role === "manager" && m.userId !== ME && m.status === "active");
    if (!manager) return false;
    const listeners = this.memberships.filter((m) => m.siteId === siteId && m.status === "active" && m.role === "member").map((m) => m.userId);
    const now = new Date().toISOString();
    const session: Session = {
      id: newId(), siteId, mode: "broadcast", status: "active", conversationId: null, startedBy: manager.userId,
      createdAt: now, answeredAt: now, endedAt: null, endReason: null,
      participants: [{ userId: manager.userId, role: "speaker" }, ...listeners.map((userId) => ({ userId, role: "listener" as const }))],
    };
    this.sessions.set(session.id, session);
    mockBus.emit("session:invite", { session: this.sessionView(session) });
    const speak = (phrase: number) => {
      if (session.status !== "active") return;
      const message = this.createMessage({
        kind: "instruction", siteId, conversationId: null, senderId: manager.userId,
        text: PHRASES[phrase]![this.langIn(siteId, manager.userId)], requiresAck: false, recipientIds: listeners, sessionId: session.id,
      });
      this.completeTranslations(message);
      mockBus.emit("message:new", { message: this.view(message, ME) });
    };
    later(1500, () => speak(P.helmet));
    later(4500, () => speak(P.gateB));
    later(8000, () => this.endSession(session.id));
    return true;
  }

  sessionMessages(sessionId: string) {
    return [...this.messages.values()].filter((m) => m.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
  }

  sessionsOf(siteId: string, mode?: Session["mode"]) {
    return [...this.sessions.values()]
      .filter((s) => s.siteId === siteId && (!mode || s.mode === mode) && s.participants.some((p) => p.userId === ME))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markDelivered(messageIds: string[]) {
    for (const id of messageIds) {
      const mine = this.messages.get(id)?.recipients.get(ME);
      if (mine && (mine.status === "sent" || mine.status === "pending")) {
        mine.status = "delivered";
        mine.deliveredAt = new Date().toISOString();
      }
    }
  }
}

export const mockDb = new MockDb();
