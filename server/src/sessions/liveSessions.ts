import type { AppContext } from "../context";
import type { LiveSession as SessionRow, LiveSessionParticipant } from "../generated/prisma/client";
import { AppError } from "../lib/errors";
import { ensureDirectConversation, siteLangs } from "../messaging/conversations";
import type {
  InstructionTarget,
  LiveSession,
  SessionEndReason,
  SessionMode,
  SessionRole,
  SessionStatus,
} from "../shared/api";

// 실시간 통역 세션 (docs/live-interpretation.md)
//   call      : 1:1 통역 통화. 울림(ringing) → 수락 → 통화 중(active) → 종료. 발화는 두 사람의 1:1 대화에 저장
//   broadcast : 관리자 일괄 지시. 시작하면 바로 active, 관리자(speaker)의 발화가 수신 대상(listener)들에게 지시로 전달
// 상태 변경은 REST, 알림은 Socket.IO(session:invite / session:updated).
// 연결 감시: 참여자의 실시간 연결이 모두 끊기면 '오프라인'으로 알리고, 유예 시간 안에 돌아오지 않으면 종료한다.

export type SessionTimings = {
  /** 통화를 받지 않으면 부재중으로 끝내는 시간 */
  ringTimeoutMs: number;
  /** 연결이 끊긴 참여자를 기다리는 시간 */
  disconnectGraceMs: number;
};

export const DEFAULT_SESSION_TIMINGS: SessionTimings = { ringTimeoutMs: 30_000, disconnectGraceMs: 20_000 };

const OPEN: SessionStatus[] = ["ringing", "active"];

type FullRow = SessionRow & { participants: LiveSessionParticipant[] };

export class LiveSessionService {
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();
  /** `${sessionId}:${userId}` → 연결 끊김 유예 타이머 */
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  readonly timings: SessionTimings;

  constructor(
    private readonly ctx: AppContext,
    timings: Partial<SessionTimings> = {},
  ) {
    this.timings = { ...DEFAULT_SESSION_TIMINGS, ...timings };
  }

  // ─── 조회 ─────────────────────────────────────────

  private loadRow(sessionId: string): Promise<FullRow | null> {
    return this.ctx.prisma.liveSession.findUnique({ where: { id: sessionId }, include: { participants: true } });
  }

  /** 앱과 공유하는 형식으로 (이름·현장 언어·접속·장치 상태 포함) */
  async view(row: FullRow): Promise<LiveSession> {
    const { prisma, presence, devices } = this.ctx;
    const userIds = row.participants.map((p) => p.userId);
    const [profiles, langs] = await Promise.all([
      prisma.profile.findMany({ where: { id: { in: [...userIds, row.startedBy] } }, select: { id: true, displayName: true } }),
      siteLangs(prisma, row.siteId, userIds),
    ]);
    const nameOf = new Map(profiles.map((p) => [p.id, p.displayName]));
    const order: SessionRole[] = ["caller", "speaker", "callee", "listener"];
    return {
      id: row.id,
      siteId: row.siteId,
      mode: row.mode as SessionMode,
      status: row.status as SessionStatus,
      conversationId: row.conversationId,
      startedBy: row.startedBy,
      startedByName: nameOf.get(row.startedBy) ?? "",
      createdAt: row.createdAt.toISOString(),
      answeredAt: row.answeredAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      endReason: (row.endReason as SessionEndReason | null) ?? null,
      participants: row.participants
        .map((p) => {
          const online = presence.isOnline(p.userId);
          return {
            userId: p.userId,
            displayName: nameOf.get(p.userId) ?? "",
            lang: langs.get(p.userId) ?? "ko",
            role: p.role as SessionRole,
            online,
            device: online ? devices.get(p.userId) : null,
            joinedAt: p.joinedAt?.toISOString() ?? null,
            leftAt: p.leftAt?.toISOString() ?? null,
          };
        })
        .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.displayName.localeCompare(b.displayName)),
    };
  }

  /** 참여자(현장 활성 멤버)만 조회할 수 있다. 아니면 존재 여부를 알리지 않도록 404 */
  async get(sessionId: string, userId: string): Promise<LiveSession> {
    return this.view(await this.requireParticipant(sessionId, userId));
  }

  /** 내가 참여 중인(울림·진행 중) 세션 — 앱 재시작·재연결 후 복원용 */
  async openFor(siteId: string, userId: string): Promise<LiveSession[]> {
    const rows = await this.ctx.prisma.liveSession.findMany({
      where: { siteId, status: { in: OPEN }, participants: { some: { userId, leftAt: null } } },
      include: { participants: true },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(rows.map((row) => this.view(row)));
  }

  /** 이미 울림·진행 중인 세션에 있는 사람이면 BUSY */
  private async assertFree(userIds: string[], mode: SessionMode, message: string) {
    const busy = await this.ctx.prisma.liveSessionParticipant.findFirst({
      where: { userId: { in: userIds }, leftAt: null, session: { status: { in: OPEN }, mode } },
    });
    if (busy) throw new AppError("BUSY", message);
  }

  // ─── 알림 ─────────────────────────────────────────

  private async publish(sessionId: string, invite?: string[]): Promise<LiveSession> {
    const row = (await this.loadRow(sessionId))!;
    const session = await this.view(row);
    const inviteSet = new Set(invite ?? []);
    for (const userId of inviteSet) this.ctx.events.sessionInvite({ userId, session });
    const others = row.participants.map((p) => p.userId).filter((id) => !inviteSet.has(id));
    if (others.length > 0) this.ctx.events.sessionUpdated({ userIds: others, session });
    return session;
  }

  // ─── 1:1 통화 ─────────────────────────────────────

  /** connect: 울림 없이 바로 연결 (C2 "연결" 방식). 빼면 울림 → 받기 */
  async startCall(siteId: string, callerId: string, calleeId: string, options: { connect?: boolean } = {}): Promise<LiveSession> {
    const { prisma, presence } = this.ctx;
    if (calleeId === callerId) throw new AppError("VALIDATION_ERROR", "자기 자신에게는 통화할 수 없습니다.");
    const callee = await prisma.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId: calleeId } } });
    if (!callee || callee.status !== "active") throw new AppError("NOT_FOUND", "멤버를 찾을 수 없습니다.");
    if (!presence.isOnline(calleeId)) throw new AppError("CONFLICT", "상대가 앱에 접속해 있지 않습니다.");
    await this.assertFree([callerId], "call", "이미 통화 중입니다.");
    await this.assertFree([calleeId], "call", "상대가 다른 통화 중입니다.");

    const { conversation } = await ensureDirectConversation(prisma, siteId, callerId, calleeId);
    const now = new Date();
    if (options.connect) {
      const row = await prisma.liveSession.create({
        data: {
          siteId,
          mode: "call",
          status: "active",
          answeredAt: now,
          conversationId: conversation.id,
          startedBy: callerId,
          participants: { create: [{ userId: callerId, role: "caller", joinedAt: now }, { userId: calleeId, role: "callee", joinedAt: now }] },
        },
      });
      return this.publish(row.id, [calleeId]);
    }
    const row = await prisma.liveSession.create({
      data: {
        siteId,
        mode: "call",
        status: "ringing",
        conversationId: conversation.id,
        startedBy: callerId,
        participants: { create: [{ userId: callerId, role: "caller", joinedAt: now }, { userId: calleeId, role: "callee" }] },
      },
    });
    this.ringTimers.set(
      row.id,
      setTimeout(() => void this.finish(row.id, "missed", null).catch((err) => this.ctx.logger.warn({ err }, "부재중 처리 실패")), this.timings.ringTimeoutMs),
    );
    return this.publish(row.id, [calleeId]);
  }

  /**
   * 연결 전환 (C2): 지금 1:1 연결(통화 중·울림)을 끝내고 다른 사람과 바로 연결한다.
   * 새 상대를 먼저 확인해서(같은 현장 활성 멤버·접속 중·다른 연결 없음) 안 되면 지금 연결은 그대로 둔다.
   * 앱이 끊기·걸기를 따로 보내면 그 사이 틈에 상태가 꼬였다 (10-26 C1 실기기) → 서버가 한 번에 한다.
   */
  async switchCall(sessionId: string, userId: string, targetId: string): Promise<LiveSession> {
    const { prisma, presence } = this.ctx;
    const row = await this.requireParticipant(sessionId, userId);
    if (row.mode !== "call" || row.status === "ended") throw new AppError("CONFLICT", "진행 중인 1:1 연결이 아닙니다.");
    if (targetId === userId) throw new AppError("VALIDATION_ERROR", "자기 자신과는 연결할 수 없습니다.");
    if (row.participants.some((p) => p.userId === targetId && !p.leftAt)) return this.view(row);
    const target = await prisma.siteMembership.findUnique({ where: { siteId_userId: { siteId: row.siteId, userId: targetId } } });
    if (!target || target.status !== "active") throw new AppError("NOT_FOUND", "멤버를 찾을 수 없습니다.");
    if (!presence.isOnline(targetId)) throw new AppError("CONFLICT", "상대가 앱에 접속해 있지 않습니다.");
    await this.assertFree([targetId], "call", "상대가 다른 통화 중입니다.");
    await this.finish(sessionId, "hangup", userId);
    return this.startCall(row.siteId, userId, targetId, { connect: true });
  }

  async accept(sessionId: string, userId: string): Promise<LiveSession> {
    const row = await this.requireParticipant(sessionId, userId);
    if (row.mode !== "call" || row.participants.find((p) => p.userId === userId)?.role !== "callee") {
      throw new AppError("FORBIDDEN", "받은 통화만 수락할 수 있습니다.");
    }
    const now = new Date();
    // 조건부 갱신: 이미 끝났거나(부재중·취소) 수락된 통화는 바꾸지 않는다.
    const { count } = await this.ctx.prisma.liveSession.updateMany({
      where: { id: sessionId, status: "ringing" },
      data: { status: "active", answeredAt: now },
    });
    if (count === 0) throw new AppError("CONFLICT", "이미 끝났거나 연결된 통화입니다.");
    this.clearRing(sessionId);
    await this.ctx.prisma.liveSessionParticipant.update({
      where: { sessionId_userId: { sessionId, userId } },
      data: { joinedAt: now },
    });
    return this.publish(sessionId);
  }

  async decline(sessionId: string, userId: string): Promise<LiveSession> {
    const row = await this.requireParticipant(sessionId, userId);
    if (row.mode !== "call" || row.participants.find((p) => p.userId === userId)?.role !== "callee") {
      throw new AppError("FORBIDDEN", "받은 통화만 거절할 수 있습니다.");
    }
    if (row.status !== "ringing") throw new AppError("CONFLICT", "이미 끝났거나 연결된 통화입니다.");
    return this.finish(sessionId, "declined", userId);
  }

  /** 끊기: 울리는 중에 건 사람이 끊으면 취소, 통화 중이면 종료. 일괄 지시는 관리자만 끝낼 수 있다. */
  async end(sessionId: string, userId: string): Promise<LiveSession> {
    const row = await this.requireParticipant(sessionId, userId);
    if (row.status === "ended") return this.view(row);
    const role = row.participants.find((p) => p.userId === userId)!.role;
    if (row.mode === "broadcast" && role !== "speaker") throw new AppError("FORBIDDEN", "일괄 지시는 관리자만 끝낼 수 있습니다.");
    const reason: SessionEndReason = row.status === "ringing" ? (role === "caller" ? "cancelled" : "declined") : "hangup";
    return this.finish(sessionId, reason, userId);
  }

  // ─── 일괄 지시 ─────────────────────────────────────

  /**
   * 관리자 일괄 지시 시작. 대상: 'all' = 관리자를 뺀 현장 구성원(role member) 전체, 또는 선택한 활성 멤버.
   * 접속하지 않은 대상도 포함한다 (발화는 지시 기록으로 남고, 접속하면 받은 지시에서 확인).
   */
  async startBroadcast(siteId: string, speakerId: string, target: InstructionTarget): Promise<LiveSession> {
    const { prisma } = this.ctx;
    const members = await prisma.siteMembership.findMany({ where: { siteId, status: "active", userId: { not: speakerId } } });
    let listenerIds: string[];
    if (target === "all") {
      listenerIds = members.filter((m) => m.role === "member").map((m) => m.userId);
    } else {
      const allowed = new Set(members.map((m) => m.userId));
      const unknown = target.userIds.filter((id) => !allowed.has(id));
      if (unknown.length > 0) throw new AppError("VALIDATION_ERROR", "현장 구성원이 아닌 대상이 있습니다.");
      listenerIds = [...new Set(target.userIds)];
    }
    if (listenerIds.length === 0) throw new AppError("CONFLICT", "지시를 받을 구성원이 없습니다.");
    await this.assertFree([speakerId], "broadcast", "이미 일괄 지시 중입니다.");

    const now = new Date();
    const row = await prisma.liveSession.create({
      data: {
        siteId,
        mode: "broadcast",
        status: "active",
        startedBy: speakerId,
        answeredAt: now,
        participants: {
          create: [
            { userId: speakerId, role: "speaker", joinedAt: now },
            ...listenerIds.map((userId) => ({ userId, role: "listener", joinedAt: now })),
          ],
        },
      },
    });
    return this.publish(row.id, listenerIds);
  }

  // ─── 발화 대상 ─────────────────────────────────────

  /**
   * 세션 발화를 보낼 수 있는지 확인하고, 메시지 생성에 필요한 정보를 돌려준다.
   * call: 통화 중인 두 사람 모두 / broadcast: 관리자(speaker)만
   */
  async utteranceTarget(sessionId: string, senderId: string) {
    const { row, siteRole } = await this.loadAsParticipant(sessionId, senderId);
    if (row.status !== "active") throw new AppError("CONFLICT", "진행 중인 세션이 아닙니다.");
    const me = row.participants.find((p) => p.userId === senderId)!;
    // 일괄 지시는 시작할 때의 speaker 이면서 지금도 현장 관리자여야 한다 (시작 뒤 관리자에서 해제되면 더 말할 수 없다)
    if (row.mode === "broadcast" && (me.role !== "speaker" || siteRole !== "manager")) {
      throw new AppError("FORBIDDEN", "일괄 지시는 관리자만 말할 수 있습니다.");
    }
    const recipientIds = row.participants.filter((p) => p.userId !== senderId && !p.leftAt).map((p) => p.userId);
    return {
      siteId: row.siteId,
      kind: row.mode === "call" ? ("direct" as const) : ("instruction" as const),
      conversationId: row.mode === "call" ? row.conversationId : null,
      recipientIds,
    };
  }

  // ─── 종료 · 연결 감시 ───────────────────────────────

  private async requireParticipant(sessionId: string, userId: string): Promise<FullRow> {
    return (await this.loadAsParticipant(sessionId, userId)).row;
  }

  /** requireParticipant 와 같은 확인 + 지금의 현장 역할 (세션 참여 역할과 별개) */
  private async loadAsParticipant(sessionId: string, userId: string): Promise<{ row: FullRow; siteRole: string }> {
    const row = await this.loadRow(sessionId);
    const participant = row?.participants.find((p) => p.userId === userId);
    if (!row || !participant) throw new AppError("NOT_FOUND", "세션을 찾을 수 없습니다.");
    const membership = await this.ctx.prisma.siteMembership.findUnique({ where: { siteId_userId: { siteId: row.siteId, userId } } });
    if (membership?.status !== "active") throw new AppError("NOT_FOUND", "세션을 찾을 수 없습니다.");
    return { row, siteRole: membership.role };
  }

  private async finish(sessionId: string, reason: SessionEndReason, endedBy: string | null): Promise<LiveSession> {
    const now = new Date();
    const { count } = await this.ctx.prisma.liveSession.updateMany({
      where: { id: sessionId, status: { in: OPEN } },
      data: { status: "ended", endReason: reason, endedBy, endedAt: now },
    });
    this.clearRing(sessionId);
    // 스트리밍 통역 연결도 닫는다 (OpenAI 세션 비용이 계속 나가지 않게)
    this.ctx.streams?.closeSession(sessionId);
    for (const [key, timer] of this.graceTimers) {
      if (key.startsWith(`${sessionId}:`)) {
        clearTimeout(timer);
        this.graceTimers.delete(key);
      }
    }
    if (count === 0) return this.view((await this.loadRow(sessionId))!);
    await this.ctx.prisma.liveSessionParticipant.updateMany({ where: { sessionId, leftAt: null }, data: { leftAt: now } });
    this.ctx.logger.info({ sessionId, reason }, "통역 세션 종료");
    return this.publish(sessionId);
  }

  private clearRing(sessionId: string) {
    clearTimeout(this.ringTimers.get(sessionId));
    this.ringTimers.delete(sessionId);
  }

  /** 사용자의 마지막 실시간 연결이 끊겼을 때 (gateway) */
  async userOffline(userId: string): Promise<void> {
    const rows = await this.ctx.prisma.liveSession.findMany({
      where: { status: { in: OPEN }, participants: { some: { userId, leftAt: null } } },
      include: { participants: true },
    });
    for (const row of rows) {
      const role = row.participants.find((p) => p.userId === userId)!.role;
      // 통화 상대 또는 일괄 지시 관리자가 끊기면 유예 후 종료. 지시 수신자가 끊기면 상태만 알린다.
      const ends = row.mode === "call" || role === "speaker";
      if (ends) {
        const key = `${row.id}:${userId}`;
        clearTimeout(this.graceTimers.get(key));
        this.graceTimers.set(
          key,
          setTimeout(() => {
            this.graceTimers.delete(key);
            const reason: SessionEndReason = row.status === "ringing" && role === "caller" ? "cancelled" : "connection_lost";
            void this.finish(row.id, reason, null).catch((err) => this.ctx.logger.warn({ err }, "연결 끊김 종료 실패"));
          }, this.timings.disconnectGraceMs),
        );
      }
      await this.publish(row.id);
    }
  }

  /** 다시 연결됐을 때: 유예 타이머를 풀고 상태를 알린다 */
  async userOnline(userId: string): Promise<void> {
    const rows = await this.ctx.prisma.liveSession.findMany({
      where: { status: { in: OPEN }, participants: { some: { userId, leftAt: null } } },
      select: { id: true },
    });
    for (const { id } of rows) {
      const key = `${id}:${userId}`;
      clearTimeout(this.graceTimers.get(key));
      this.graceTimers.delete(key);
      await this.publish(id);
    }
  }

  /** 참여자의 장치 상태가 바뀌면 같은 세션 참여자에게 알린다 */
  async deviceChanged(userId: string): Promise<void> {
    await this.userOnline(userId);
  }

  /** 현장에서 제외되면 그 사람이 있는 세션을 끝내거나(통화·관리자) 수신 대상에서 뺀다 */
  async memberRemoved(siteId: string, userId: string): Promise<void> {
    const rows = await this.ctx.prisma.liveSession.findMany({
      where: { siteId, status: { in: OPEN }, participants: { some: { userId, leftAt: null } } },
      include: { participants: true },
    });
    for (const row of rows) {
      const role = row.participants.find((p) => p.userId === userId)!.role;
      if (row.mode === "call" || role === "speaker") {
        await this.finish(row.id, "removed", null);
      } else {
        await this.ctx.prisma.liveSessionParticipant.update({
          where: { sessionId_userId: { sessionId: row.id, userId } },
          data: { leftAt: new Date() },
        });
        await this.publish(row.id);
      }
    }
  }

  /** 서버 시작 시: 이전 실행에서 열린 채 남은 세션을 연결 끊김으로 닫는다 (실시간 연결이 모두 끊겼으므로) */
  async closeStale(scope: { siteIds?: string[] } = {}): Promise<number> {
    const now = new Date();
    const { count } = await this.ctx.prisma.liveSession.updateMany({
      // scope 는 테스트용 (같은 DB 를 쓰는 다른 테스트 파일의 세션을 건드리지 않게). 서버 시작 때는 전체
      where: { status: { in: OPEN }, ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}) },
      data: { status: "ended", endReason: "connection_lost", endedAt: now },
    });
    return count;
  }

  /** 종료 시 타이머 정리 (테스트·서버 종료) */
  dispose(): void {
    for (const timer of [...this.ringTimers.values(), ...this.graceTimers.values()]) clearTimeout(timer);
    this.ringTimers.clear();
    this.graceTimers.clear();
  }
}
