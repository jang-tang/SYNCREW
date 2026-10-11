import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody, ErrorCode } from "../shared/api";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROFILE_REQUIRED: 404,
  ALREADY_MEMBER: 409,
  INVALID_JOIN_CODE: 404,
  OPENAI_NOT_CONFIGURED: 503,
  BUDGET_EXCEEDED: 402,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS_BY_CODE[code];
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError("NOT_FOUND", `${req.method} ${req.path} 경로가 없습니다.`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new AppError(
      "VALIDATION_ERROR",
      err.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`).join("; "),
    );
  } else {
    req.log?.error({ err }, "처리되지 않은 오류");
    appError = new AppError("INTERNAL_ERROR", "서버 오류가 발생했습니다.");
  }

  const body: ApiErrorBody = { error: { code: appError.code, message: appError.message } };
  res.status(appError.status).json(body);
};
