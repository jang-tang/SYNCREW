// 서버와 프론트엔드가 함께 쓰는 REST 응답 계약. 외부 패키지를 import하지 않는다.

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "OPENAI_NOT_CONFIGURED",
  "BUDGET_EXCEEDED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string };
};

export type HealthResponse = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  openai: "configured" | "not_configured";
  dataset: { name: string; version: string; lexicon: number; phrases: number };
  /** 개발 환경에서만 포함된다. */
  budget?: { limitUsd: number; spentUsd: number; remainingUsd: number; period: "month" | "total" };
};
