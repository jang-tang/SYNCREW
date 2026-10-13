import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "postgresql:// 형식이어야 합니다"),

  OPENAI_API_KEY: optionalString,
  OPENAI_BUDGET_USD: z.coerce.number().positive().default(5),
  OPENAI_BUDGET_PERIOD: z.enum(["month", "total"]).default("month"),
  OPENAI_PRICING_JSON: optionalString,
  /** 받아쓰기 모델. 2026-10-14 비교 측정으로 gpt-4o-transcribe 로 바꿈 (현장 용어·숫자 정확도, docs/streaming-plan.md 5-2절) */
  STT_MODEL: z.string().default("gpt-4o-transcribe"),
  TRANSLATION_MODEL: z.string().default("gpt-realtime-2.1"),
  /** openai: 실제 호출 / fake: 키 없이 개발·앱 연동 확인용 가짜 엔진 (비용 없음) */
  ENGINE: z.enum(["openai", "fake"]).default("openai"),
  /** 번역 음성 생성 (off면 텍스트만, 앱은 기기 TTS로 읽음) */
  TRANSLATION_AUDIO: z.enum(["on", "off"]).default("on"),
  TRANSLATION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  TRANSLATION_REASONING: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  TRANSLATION_VOICE: z.string().default("marin"),
  /** 1:1 통화 스트리밍 통역 (docs/streaming-plan.md). off 면 앱은 발화 단위 방식만 쓴다 */
  STREAMING: z.enum(["on", "off"]).default("on"),
  /** 동시에 여는 스트리밍 엔진 연결 수 (화자 × 대상 언어). 넘으면 발화 단위 방식 */
  STREAM_MAX_SESSIONS: z.coerce.number().int().min(1).max(64).default(4),
  /** OpenAI server_vad 말 끝 무음 (ms). S0 실측 기준 500, S6에서 300–400 실험 */
  STREAM_VAD_SILENCE_MS: z.coerce.number().int().min(200).max(2000).default(500),
  /** 업로드 음성·번역 음성 저장 위치 */
  STORAGE_DIR: z.string().default("./storage"),
  /** 음성 URL 서명 키. 비우면 서버 시작마다 새로 만든다 (재시작 후 이전 URL 무효 → 앱이 목록을 다시 받음) */
  AUDIO_URL_SECRET: optionalString,

  // Supabase는 인증에만 쓴다. Phase 2에서 JWT 검증에 사용 (그때 필수로 전환).
  SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  SUPABASE_JWKS_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  SUPABASE_SECRET_KEY: optionalString,

  AUDIO_PREPROCESSOR: z.string().default("passthrough"),
  /** 스트리밍 통화용 노이즈 필터 (조각 단위, src/plugins/streamAudioFilter.ts) */
  STREAM_AUDIO_FILTER: z.string().default("passthrough"),
  DATASET_ADAPTER: z.string().default("legacy-workplace"),
  DATASET_PATH: z.string().default("./data/legacy-workplace"),
  RETENTION_POLICY: z.string().default("noop"),
  RETENTION_RUN_AT: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 형식이어야 합니다")
    .default("03:00"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`환경 변수가 올바르지 않습니다 (.env 확인):\n${details}`);
  }
  return parsed.data;
}
