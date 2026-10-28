import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Namespace, type Socket } from "socket.io";
import { z } from "zod";
import { UUID } from "../access/membership";
import type { AuthIdentity } from "../auth/verifier";
import type { AppContext } from "../context";
import type { DomainEvents } from "../events/domainEvents";
import { StreamHub, type StreamEmitter, type StreamHubOptions } from "../streaming/streamHub";
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
const deviceInput = z.object({
  audioRoute: z.enum(["bluetooth", "wired", "builtin", "unknown"]),
  inputName: z.string().trim().max(80).nullable(),
  micPermission: z.enum(["granted", "denied", "undetermined"]),
});
const streamOpenInput = z.object({
  sessionId: z.string().regex(UUID),
  format: z.object({ encoding: z.literal("pcm16"), sampleRate: z.union([z.literal(16000), z.literal(24000)]), channels: z.literal(1) }),
});
const streamIdInput = z.object({ streamId: z.string().regex(UUID) });
const streamPlayingInput = z.object({ streamId: z.string().regex(UUID), playing: z.boolean() });
/** 100ms 조각 기준 여유 있게 (24kHz 0.5초) */
const MAX_FRAME_BYTES = 24_000;

/** Socket.IO 바이너리는 Node 에서 Buffer, 브라우저·RN 에서는 ArrayBuffer·TypedArray 로 온다 */
function toBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/** 모든 서버 발행 이벤트에 붙는 중복 제거용 id 와 시각 */
const envelope = () => ({ eventId: randomUUID(), at: new Date().toISOString() });

export type RealtimeGateway = {
  io: Server;
  events: DomainEvents;
  streams: StreamHub;
  /** 클라이언트에게 REST로 다시 맞추라고 알린다 (서버 상태 불일치·복구 후) */
  requireSync(target: { userId: string } | "all", siteId?: string): void;
  close(): Promise<void>;
};

export function attachRealtime(
  server: HttpServer,
  context: AppContext,
  options: { stream?: Partial<StreamHubOptions> } = {},
): RealtimeGateway {
  const { prisma, logger, presence, devices } = context;
  // 네이티브 앱은 CORS 와 무관하지만, 웹(e2e·개발) 접속을 위해 허용한다. 로컬 호스팅 전제.
  // ping: 휴대폰 LTE 가 조용히 끊기면(터널·기지국 이동) 서버와 앱 모두 pingInterval + pingTimeout 뒤에야 알아챈다.
  //   기본 25s + 20s = 45초 동안 말이 죽은 연결로 들어가므로 10s + 10s = 20초로 줄인다 (ping 1개는 수 바이트, RTT 150ms 의 60배 여유).
  //   앱(engine.io-client)도 핸드셰이크로 같은 값을 받아 서버 침묵을 같은 시간 안에 알아챈다. 측정: docs/perf-network-2026-10-20.md
  // perMessageDeflate: Socket.IO 4 기본값이 꺼짐(PCM 압축은 CPU 낭비) — 명시해 둔다
  const io = new Server(server, { serveClient: false, cors: { origin: true }, pingInterval: 10_000, pingTimeout: 10_000, perMessageDeflate: false });
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

  // 스트리밍 통역: 음성 조각은 듣는 사람 개인 방으로만 보낸다 (봉투 없이, 빈도가 높으므로)
  const streamEmitter: StreamEmitter = {
    toUser(userId: string, event: string, payload: object) {
      (nsp.to(rooms.user(userId)).emit as (event: string, payload: object) => boolean)(event, payload);
    },
    fallback(userId, payload) {
      emit(rooms.user(userId), "stream:fallback", payload);
    },
  };
  const streams = new StreamHub(context, context.streamEngine, streamEmitter, {
    enabled: context.env.STREAMING === "on",
    maxStreams: context.env.STREAM_MAX_SESSIONS,
    mineCaption: context.env.STREAM_MINE_CAPTION,
    ...options.stream,
  });
  context.streams = streams;

  const activeSiteIds = async (userId: string) =>
    (await prisma.siteMembership.findMany({ where: { userId, status: "active" }, select: { siteId: true } })).map((m) => m.siteId);

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

    if (presence.connect(userId)) {
      void broadcastPresence(userId, true).catch((err) => logger.warn({ err }, "presence 알림 실패"));
      // 통화·일괄 지시 중에 다시 연결되면 연결 끊김 유예를 푼다.
      void context.sessions.userOnline(userId).catch((err) => logger.warn({ err }, "세션 재연결 처리 실패"));
    }

    socket.on("site:subscribe", async (payload, ack) => {
      const parsed = siteInput.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, code: "VALIDATION_ERROR" });
      const { siteId } = parsed.data;
      const findMembership = () => prisma.siteMembership.findUnique({ where: { siteId_userId: { siteId, userId } } });
      const membership = await findMembership();
      // 비멤버에게는 현장 존재 여부를 알리지 않는다 (REST 와 같은 404 의미)
      if (!membership || membership.status !== "active") return reply(ack, { ok: false, code: "NOT_FOUND" });
      const joined = [rooms.site(siteId), ...(membership.role === "manager" ? [rooms.managers(siteId)] : [])];
      await socket.join(joined);
      // 확인과 참여 사이에 제외·관리자 해제가 커밋되면 membershipChanged 의 socketsLeave 가 참여보다 먼저 돌아 아무것도 빼지 못한다.
      // 그래서 참여한 뒤 한 번 더 읽어, 더 이상 맞지 않는 방에서 나온다.
      // 이 재확인이 보지 못한 변경은 재확인(=참여 뒤) 이후에 커밋되므로, 커밋 후 발행되는 membershipChanged 가 소켓을 뺀다.
      const current = await findMembership();
      if (!current || current.status !== "active") {
        for (const room of joined) await socket.leave(room);
        return reply(ack, { ok: false, code: "NOT_FOUND" });
      }
      if (membership.role === "manager" && current.role !== "manager") await socket.leave(rooms.managers(siteId));
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
        const targets = await prisma.messageRecipient.findMany({
          where: { userId, messageId: { in: parsed.data.messageIds }, status: "sent" },
          select: { messageId: true, message: { select: { kind: true, siteId: true } } },
        });
        const { count } = await prisma.messageRecipient.updateMany({
          where: { userId, messageId: { in: targets.map((t) => t.messageId) }, status: "sent" },
          data: { status: "delivered", deliveredAt: new Date() },
        });
        reply(ack, { ok: true, updated: count });
        // 지시는 관리자에게 수신 상태를 알린다.
        for (const target of targets) {
          if (target.message.kind === "instruction") {
            context.events.instructionRecipient({ siteId: target.message.siteId, messageId: target.messageId, userId, status: "delivered" });
          }
        }
      } catch (err) {
        logger.warn({ err }, "수신 확인 반영 실패");
        reply(ack, { ok: false, code: "INTERNAL_ERROR" });
      }
    });

    // 오디오 장치 상태 (헤드셋 연결·마이크 권한): 저장하고 현장·세션 참여자에게 알린다.
    socket.on("device:status", async (payload, ack) => {
      const parsed = deviceInput.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, code: "VALIDATION_ERROR" });
      devices.set(userId, parsed.data);
      reply(ack, { ok: true });
      try {
        const siteIds = await activeSiteIds(userId);
        context.events.deviceChanged({ siteIds, userId, device: parsed.data });
        await context.sessions.deviceChanged(userId);
      } catch (err) {
        logger.warn({ err }, "장치 상태 알림 실패");
      }
    });

    // ─── 스트리밍 통역 (1:1 통화) ───
    socket.on("stream:open", async (payload, ack) => {
      const parsed = streamOpenInput.safeParse(payload);
      const respond = (result: Parameters<typeof ack>[0]) => typeof ack === "function" && ack(result);
      if (!parsed.success) return respond({ ok: false, code: "VALIDATION_ERROR" });
      try {
        respond(await streams.open(userId, socket.id, parsed.data.sessionId, parsed.data.format));
      } catch (err) {
        logger.warn({ err }, "스트림 열기 실패");
        respond({ ok: false, code: "ENGINE_UNAVAILABLE" });
      }
    });

    socket.on("stream:audio", (payload) => {
      const streamId = (payload as { streamId?: unknown })?.streamId;
      const seq = (payload as { seq?: unknown })?.seq;
      const pcm = toBuffer((payload as { pcm?: unknown })?.pcm);
      if (typeof streamId !== "string" || !Number.isInteger(seq) || !pcm || pcm.length === 0 || pcm.length > MAX_FRAME_BYTES) return;
      streams.audio(userId, streamId, seq as number, pcm.length % 2 === 0 ? pcm : pcm.subarray(0, pcm.length - 1));
    });

    socket.on("stream:pause", (payload) => {
      const parsed = streamIdInput.safeParse(payload);
      if (parsed.success) streams.pause(userId, parsed.data.streamId);
    });

    socket.on("stream:playing", (payload) => {
      const parsed = streamPlayingInput.safeParse(payload);
      if (parsed.success) streams.playing(userId, parsed.data.streamId, parsed.data.playing);
    });

    socket.on("stream:close", (payload, ack) => {
      const parsed = streamIdInput.safeParse(payload);
      if (!parsed.success) return reply(ack, { ok: false, code: "VALIDATION_ERROR" });
      reply(ack, streams.close(userId, parsed.data.streamId) ? { ok: true } : { ok: false, code: "NOT_FOUND" });
    });

    socket.on("disconnect", () => {
      clearTimeout(expiryTimer);
      streams.closeSocket(socket.id);
      if (presence.disconnect(userId)) {
        devices.delete(userId);
        void broadcastPresence(userId, false).catch((err) => logger.warn({ err }, "presence 알림 실패"));
        void context.sessions.userOffline(userId).catch((err) => logger.warn({ err }, "세션 연결 끊김 처리 실패"));
      }
    });
  });

  // ─── 도메인 이벤트 → 실시간 알림 ─────────────────

  const events: DomainEvents = {
    membershipChanged({ siteId, userId, role, status }) {
      emit([rooms.user(userId), rooms.managers(siteId)], "membership:changed", { siteId, userId, role, status });
      // 제외·거절되면 그 사용자의 모든 연결을 현장 방에서 즉시 뺀다 (이후 현장 알림 차단)
      if (status === "removed" || status === "rejected") {
        nsp.in(rooms.user(userId)).socketsLeave([rooms.site(siteId), rooms.managers(siteId)]);
      } else if (status === "active") {
        // 관리자 지정·해제: 관리자 알림 방(가입 요청·지시 수신 상태)에 넣거나 뺀다
        if (role === "manager") nsp.in(rooms.user(userId)).socketsJoin(rooms.managers(siteId));
        else nsp.in(rooms.user(userId)).socketsLeave(rooms.managers(siteId));
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
    instructionRecipient({ siteId, messageId, userId, status }) {
      emit(rooms.managers(siteId), "instruction:recipient", { messageId, userId, status });
    },
    sessionInvite({ userId, session }) {
      emit(rooms.user(userId), "session:invite", { session });
    },
    sessionUpdated({ userIds, session }) {
      // 주의: nsp.to([]) 는 전체 전송이 되므로 빈 대상은 보내지 않는다.
      if (userIds.length > 0) emit(userIds.map(rooms.user), "session:updated", { session });
    },
    groupUpdated({ siteId, session }) {
      emit(rooms.site(siteId), "group:updated", { siteId, session });
    },
    deviceChanged({ siteIds, userId, device }) {
      for (const siteId of siteIds) emit(rooms.site(siteId), "device:changed", { siteId, userId, device });
    },
  };

  return {
    io,
    events,
    streams,
    requireSync(target, siteId) {
      const payload = siteId ? { siteId } : {};
      // 주의: nsp.to([]) 는 전체 전송이 되므로 전체 대상은 nsp.emit 으로만 보낸다.
      if (target === "all") nsp.emit("sync:required", { ...payload, ...envelope() });
      else emit(rooms.user(target.userId), "sync:required", payload);
    },
    close: () =>
      new Promise<void>((resolve) => {
        streams.dispose();
        void io.close(() => resolve());
      }),
  };
}
