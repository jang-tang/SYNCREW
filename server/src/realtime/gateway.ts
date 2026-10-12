import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Namespace, type Socket } from "socket.io";
import { z } from "zod";
import { UUID } from "../access/membership";
import type { AuthIdentity } from "../auth/verifier";
import type { AppContext } from "../context";
import type { DomainEvents } from "../events/domainEvents";
import {
  REALTIME_NAMESPACE,
  type AckResult,
  type ClientToServerEvents,
  type ServerEventName,
  type ServerEventPayload,
  type ServerToClientEvents,
} from "../shared/realtime";

// Socket.IO 실시간 연결 (docs/realtime-protocol.md)
// - 클라이언트는 방 이름을 지정하지 않는다. 서버가 DB 권한을 확인하고 방에 넣는다.
// - 개인 대상 알림은 user:{id}, 현장 공지는 site:{id}, 관리자 알림은 site:{id}:managers

type SocketData = { identity: AuthIdentity; sites: Set<string> };
type RtNamespace = Namespace<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type RtSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  site: (siteId: string) => `site:${siteId}`,
  managers: (siteId: string) => `site:${siteId}:managers`,
};

const siteInput = z.object({ siteId: z.string().regex(UUID) });
const receiptInput = z.object({ messageIds: z.array(z.string().regex(UUID)).min(1).max(100) });

/** 모든 서버 발행 이벤트에 붙는 중복 제거용 id 와 시각 */
const envelope = () => ({ eventId: randomUUID(), at: new Date().toISOString() });

export type RealtimeGateway = {
  io: Server;
  events: DomainEvents;
  /** 클라이언트에게 REST로 다시 맞추라고 알린다 (서버 상태 불일치·복구 후) */
  requireSync(target: { userId: string } | "all", siteId?: string): void;
  close(): Promise<void>;
};

export function attachRealtime(server: HttpServer, context: AppContext): RealtimeGateway {
  const { prisma, logger, presence } = context;
  // 네이티브 앱은 CORS 와 무관하지만, 웹(e2e·개발) 접속을 위해 허용한다. 로컬 호스팅 전제.
  const io = new Server(server, { serveClient: false, cors: { origin: true } });
  const nsp: RtNamespace = io.of(REALTIME_NAMESPACE);

  const emit = <E extends ServerEventName>(target: string | string[], event: E, payload: Omit<ServerEventPayload<E>, "eventId" | "at">) => {
    (nsp.to(target).emit as (event: E, payload: ServerEventPayload<E>) => boolean)(event, {
      ...payload,
      ...envelope(),
    } as ServerEventPayload<E>);
  };

  const reply = (ack: unknown, result: AckResult) => {
    if (typeof ack === "function") ack(result);
  };

  /** 사용자가 속한 현장들에 접속 상태 변화를 알린다 */
  async function broadcastPresence(userId: string, online: boolean) {
    const memberships = await prisma.siteMembership.findMany({ where: { userId, status: "active" }, select: { siteId: true } });
    if (memberships.length === 0) return;
    emit(memberships.map((m) => rooms.site(m.siteId)), "presence:changed", { userId, online });
  }

  // ─── 연결 인증 ───────────────────────────────────

  nsp.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    try {
      if (typeof token !== "string" || !token) throw new Error("no token");
      socket.data.identity = await context.verifier.verify(token);
      socket.data.sites = new Set();
      next();
    } catch {
      const error = new Error("UNAUTHORIZED") as Error & { data?: unknown };
      error.data = { code: "UNAUTHORIZED" };
      next(error);
    }
  });

  nsp.on("connection", (socket: RtSocket) => {
    const { userId, expiresAt } = socket.data.identity;
    void socket.join(rooms.user(userId));

    // 토큰이 만료되면 알리고 연결을 끊는다. 앱은 토큰을 갱신해 다시 연결한다.
    let expiryTimer: NodeJS.Timeout | undefined;
    if (expiresAt) {
      expiryTimer = setTimeout(() => {
        socket.emit("auth:expired", envelope());
        socket.disconnect(true);
      }, Math.max(0, expiresAt * 1000 - Date.now()));
    }

    if (presence.connect(userId)) void broadcastPresence(userId, true).catch((err) => logger.warn({ err }, "presence 알림 실패"));

    socket.on("site:subscribe", async (payload, ack) => {
      const parsed = siteInput.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, code: "VALIDATION_ERROR" });
      const { siteId } = parsed.data;
      const membership = await prisma.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId } } });
      // 비멤버에게는 현장 존재 여부를 알리지 않는다 (REST 와 같은 404 의미)
      if (!membership || membership.status !== "active") return reply(ack, { ok: false, code: "NOT_FOUND" });
      const joined = [rooms.site(siteId), ...(membership.role === "manager" ? [rooms.managers(siteId)] : [])];
      await socket.join(joined);
      socket.data.sites.add(siteId);
      reply(ack, { ok: true });
    });

    socket.on("site:unsubscribe", async (payload, ack) => {
      const parsed = siteInput.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, code: "VALIDATION_ERROR" });
      const { siteId } = parsed.data;
      await socket.leave(rooms.site(siteId));
      await socket.leave(rooms.managers(siteId));
      socket.data.sites.delete(siteId);
      reply(ack, { ok: true });
    });

    // 단말 수신 확인: 본인이 수신자인 행만 sent → delivered (멱등)
    socket.on("receipt:delivered", async (payload, ack) => {
      const parsed = receiptInput.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, code: "VALIDATION_ERROR" });
      try {
        const { count } = await prisma.messageRecipient.updateMany({
          where: { userId, messageId: { in: parsed.data.messageIds }, status: "sent" },
          data: { status: "delivered", deliveredAt: new Date() },
        });
        reply(ack, { ok: true, updated: count });
      } catch (err) {
        logger.warn({ err }, "수신 확인 반영 실패");
        reply(ack, { ok: false, code: "INTERNAL_ERROR" });
      }
    });

    socket.on("disconnect", () => {
      clearTimeout(expiryTimer);
      if (presence.disconnect(userId)) void broadcastPresence(userId, false).catch((err) => logger.warn({ err }, "presence 알림 실패"));
    });
  });

  // ─── 도메인 이벤트 → 실시간 알림 ─────────────────

  const events: DomainEvents = {
    membershipChanged({ siteId, userId, role, status }) {
      emit([rooms.user(userId), rooms.managers(siteId)], "membership:changed", { siteId, userId, role, status });
      // 제외·거절되면 그 사용자의 모든 연결을 현장 방에서 즉시 뺀다 (이후 현장 알림 차단)
      if (status === "removed" || status === "rejected") {
        nsp.in(rooms.user(userId)).socketsLeave([rooms.site(siteId), rooms.managers(siteId)]);
      }
    },
    joinRequested({ siteId, userId, displayName, lang }) {
      emit(rooms.managers(siteId), "join:requested", { siteId, userId, displayName, lang });
    },
    // 메시지는 사람마다 언어가 달라 현장 방이 아니라 수신자 개인 방으로 보낸다.
    messageNew({ userId, message }) {
      emit(rooms.user(userId), "message:new", { message });
    },
    messageStatus({ userId, ...status }) {
      emit(rooms.user(userId), "message:status", status);
    },
  };

  return {
    io,
    events,
    requireSync(target, siteId) {
      const payload = siteId ? { siteId } : {};
      // 주의: nsp.to([]) 는 전체 전송이 되므로 전체 대상은 nsp.emit 으로만 보낸다.
      if (target === "all") nsp.emit("sync:required", { ...payload, ...envelope() });
      else emit(rooms.user(target.userId), "sync:required", payload);
    },
    close: () =>
      new Promise<void>((resolve) => {
        void io.close(() => resolve());
      }),
  };
}
