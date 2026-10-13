import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";

/** 음성 업로드 최대 크기 (≈30초 m4a) */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/**
 * 받을 수 있는 음성 형식 → 저장 확장자. 앱은 휴대폰 audio/mp4(m4a), 웹 audio/webm 을 보낸다.
 * "audio/webm;codecs=opus" 처럼 붙는 매개변수는 무시한다. 목록 밖이면 업로드 단계에서 거절한다.
 */
export const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/3gpp": "3gp",
};

export const baseMime = (mimetype: string) => mimetype.split(";")[0]!.trim().toLowerCase();

class UnsupportedAudioError extends Error {}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 8 },
  fileFilter: (_req, file, callback) => {
    if (AUDIO_EXTENSIONS[baseMime(file.mimetype)]) callback(null, true);
    else callback(new UnsupportedAudioError(file.mimetype));
  },
});

/** multipart 의 audio 필드를 메모리로 받는다. JSON 요청은 그대로 통과한다. */
export const audioUpload: RequestHandler = (req, res, next) => {
  upload.single("audio")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "음성 파일은 2MB 이하여야 합니다." : `업로드 오류: ${error.code}`;
      return next(new AppError("VALIDATION_ERROR", message));
    }
    if (error instanceof UnsupportedAudioError) {
      return next(new AppError("VALIDATION_ERROR", `지원하지 않는 음성 형식입니다: ${error.message}`));
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
