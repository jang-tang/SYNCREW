import { Router } from "express";
import { z } from "zod";
import { requireMembership, UUID } from "../../access/membership";
import type { AppContext } from "../../context";
import { audioUpload, sendLimiter } from "../../http/upload";
import { AppError } from "../../lib/errors";
import { visibleTo } from "../../messaging/conversations";
import { createMessage } from "../../messaging/createMessage";
import { fullMessage, toMessageViews } from "../../messaging/views";
import type { LiveSession } from "../../shared/api";

// 실시간 통역 세션 API (docs/live-interpretation.md, docs/api-specification.md 11절)

const callInput = z.object({ userId: z.string().regex(UUID), connect: z.boolean().optional() });
const switchInput = z.object({ userId: z.string().regex(UUID) });
const targetSchema = z.union([z.literal("all"), z.object({ userIds: z.array(z.string().regex(UUID)).min(1).max(200) })]);
const broadcastInput = z.object({ target: targetSchema });
const clientMessageId = z.string().trim().min(1).max(64);
const utteranceText = z.object({ clientMessageId, text: z.string().trim().min(1).max(1000) });
const utteranceAudio = z.object({ clientMessageId });
const historyQuery = z.object({
  mode: z.enum(["call", "broadcast"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const idParam = (value: unknown) => {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw new AppError("NOT_FOUND", "세션을 찾을 수 없습니다.");
  return id;
};

export function sessionsRouter(context: AppContext): Router {
  const router = Router();
  const { prisma } = context;
  const member = requireMembership(context);
  const manager = requireMembership(context, "manager");
  const limiter = sendLimiter(context);
  const sessions = () => context.sessions;

  /** 1:1 통역 통화 걸기 → 상대에게 session:invite */
  router.post("/sites/:siteId/calls", member, async (req, res) => {
    const { userId, connect } = callInput.parse(req.body);
    res.status(201).json(await sessions().startCall(req.membership!.siteId, req.auth!.userId, userId, { connect }));
  });

  /** 관리자 일괄 지시 시작 → 대상자들에게 session:invite (관리자만, 구성원은 403) */
  router.post("/sites/:siteId/broadcasts", manager, async (req, res) => {
    const { target } = broadcastInput.parse(req.body);
    res.status(201).json(await sessions().startBroadcast(req.membership!.siteId, req.auth!.userId, target));
  });

  /** 내가 참여 중인 울림·진행 중 세션 (앱 재시작·재연결 후 복원) */
  router.get("/sites/:siteId/sessions/open", member, async (req, res) => {
    res.json(await sessions().openFor(req.membership!.siteId, req.auth!.userId));
  });

  /** 세션 기록: 내가 참여한 최근 세션 */
  router.get("/sites/:siteId/sessions", member, async (req, res) => {
    const { mode, limit } = historyQuery.parse(req.query);
    const rows = await prisma.liveSession.findMany({
      where: { siteId: req.membership!.siteId, ...(mode ? { mode } : {}), participants: { some: { userId: req.auth!.userId } } },
      include: { participants: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const list: LiveSession[] = await Promise.all(rows.map((row) => sessions().view(row)));
    res.json(list);
  });

  router.get("/sessions/:sessionId", async (req, res) => {
    res.json(await sessions().get(idParam(req.params["sessionId"]), req.auth!.userId));
  });

  router.post("/sessions/:sessionId/accept", async (req, res) => {
    res.json(await sessions().accept(idParam(req.params["sessionId"]), req.auth!.userId));
  });

  router.post("/sessions/:sessionId/decline", async (req, res) => {
    res.json(await sessions().decline(idParam(req.params["sessionId"]), req.auth!.userId));
  });

  /** 연결 전환 (C2): 지금 1:1 연결을 끝내고 다른 사람과 바로 연결 → 새 세션 */
  router.post("/sessions/:sessionId/switch", async (req, res) => {
    const { userId } = switchInput.parse(req.body);
    res.status(201).json(await sessions().switchCall(idParam(req.params["sessionId"]), req.auth!.userId, userId));
  });

  router.post("/sessions/:sessionId/end", async (req, res) => {
    res.json(await sessions().end(idParam(req.params["sessionId"]), req.auth!.userId));
  });

  /**
   * 세션 발화 1건: multipart 음성(앱이 말이 끝난 것을 감지해 문장 단위로 보낸다) 또는 JSON 텍스트.
   * 통화 → 상대에게 1:1 메시지, 일괄 지시 → 수신 대상 전원에게 지시 메시지 (언어별 1회 번역)
   */
  router.post("/sessions/:sessionId/utterances", limiter, audioUpload, async (req, res) => {
    const sessionId = idParam(req.params["sessionId"]);
    const senderId = req.auth!.userId;
    const target = await sessions().utteranceTarget(sessionId, senderId);
    const file = req.file;
    const input = file ? { ...utteranceAudio.parse(req.body), text: null } : utteranceText.parse(req.body);
    const result = await createMessage(context, {
      ...target,
      senderId,
      clientMessageId: input.clientMessageId,
      text: input.text,
      ...(file ? { audio: { buffer: file.buffer, mimetype: file.mimetype } } : {}),
      requiresAck: false,
      sessionId,
    });
    res.status(result.httpStatus).json(result.body);
  });

  /** 세션 대화 기록: 이 세션의 발화 중 내가 보냈거나 받은 것 (내 언어 기준) */
  router.get("/sessions/:sessionId/messages", async (req, res) => {
    const sessionId = idParam(req.params["sessionId"]);
    const userId = req.auth!.userId;
    await sessions().get(sessionId, userId);
    const rows = await prisma.message.findMany({
      where: { sessionId, ...visibleTo(userId) },
      orderBy: { seq: "asc" },
      take: 500,
      include: fullMessage,
    });
    res.json(await toMessageViews(prisma, context.audioUrls, rows, userId));
  });

  return router;
}
