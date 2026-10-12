import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";

/** 음성 업로드 최대 크기 (≈30초 m4a) */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 8 } });

/** multipart 의 audio 필드를 메모리로 받는다. JSON 요청은 그대로 통과한다. */
export const audioUpload: RequestHandler = (req, res, next) => {
  upload.single("audio")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "음성 파일은 2MB 이하여야 합니다." : `업로드 오류: ${error.code}`;
      return next(new AppError("VALIDATION_ERROR", message));
    }
    next(error as Error | undefined);
  });
};

const limiters = new WeakMap<AppContext, RequestHandler>();

/** 메시지·발화·지시 전송: 사용자당 1분 N회 (모든 전송 경로가 한도를 함께 쓴다) */
export function sendLimiter(context: AppContext): RequestHandler {
  const existing = limiters.get(context);
  if (existing) return existing;
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: context.limits.messagesPerMinute,
    keyGenerator: (req) => req.auth!.userId,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.")),
  });
  limiters.set(context, limiter);
  return limiter;
}
