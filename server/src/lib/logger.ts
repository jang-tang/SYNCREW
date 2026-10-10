import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    // 토큰과 API 키는 로그에 남기지 않는다.
    redact: {
      paths: ["req.headers.authorization", "*.apiKey", "*.OPENAI_API_KEY", "*.SUPABASE_SECRET_KEY"],
      censor: "[REDACTED]",
    },
  });
}
