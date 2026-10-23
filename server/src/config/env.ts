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
  /**
   * 스트리밍 전사 전용 세션(STREAM_LIVE_TRANSCRIPTION=on)의 받아쓰기 모델 (2026-10-20). 기본 gpt-live-transcribe: VAD 없이 연속 전사라
   * 말하는 도중(말 시작 약 1초 뒤)부터 원문 조각이 온다. $0.017/분. gpt-4o-transcribe 로 두면 예전처럼 server_vad + 말 끝 뒤 조각 ($0.006/분).
   * 발화 단위 STT 와 전사 세션 실패 시 번역 세션 전사는 그대로 STT_MODEL 을 쓴다
   */
  STREAM_STT_MODEL: z.string().default("gpt-live-transcribe"),
  TRANSLATION_MODEL: z.string().default("gpt-realtime-2.1"),
  /** openai: 실제 호출 / fake: 키 없이 개발·앱 연동 확인용 가짜 엔진 (비용 없음) */
  ENGINE: z.enum(["openai", "fake"]).default("openai"),
  /** 번역 음성 생성 (off면 텍스트만, 앱은 기기 TTS로 읽음) */
  TRANSLATION_AUDIO: z.enum(["on", "off"]).default("on"),
  TRANSLATION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  /** 추론 강도. 2026-10-24 minimal 을 시험했다가 은어 정확도가 4–5%p 떨어져 low 로 되돌림 (docs/field-accuracy.md 9·10절) */
  TRANSLATION_REASONING: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  TRANSLATION_VOICE: z.string().default("marin"),
  /** 1:1 통화 스트리밍 통역 (docs/streaming-plan.md). off 면 앱은 발화 단위 방식만 쓴다 */
  STREAMING: z.enum(["on", "off"]).default("on"),
  /** 동시에 여는 스트리밍 엔진 연결 수 (화자 × 대상 언어). 넘으면 발화 단위 방식 */
  STREAM_MAX_SESSIONS: z.coerce.number().int().min(1).max(64).default(4),
  /** OpenAI server_vad 말 끝 무음 (ms). S0 실측 기준 500 → 2026-10-24 350 (지연 약 0.24초 단축, docs/field-accuracy.md 8절). 사람 목소리로 문장이 잘리는지 실기기 확인 전 */
  STREAM_VAD_SILENCE_MS: z.coerce.number().int().min(200).max(2000).default(350),
  /**
   * 스트리밍 전사 전용 세션 (2026-10-19): on 이면 화자 스트림마다 OpenAI 전사 세션(intent=transcription)을 하나 더 열어
   * 원문 조각(original_partial)을 번역 응답과 따로, 말 끝 직후(0.1–0.4초)에 받는다. 번역 세션의 입력 전사는 끈다(받아쓰기 2번 청구 방지).
   * off 면 예전처럼 번역 세션이 전사까지 한다(원문이 0.5–1.5초 늦고 빠지기도 했다)
   */
  STREAM_LIVE_TRANSCRIPTION: z.enum(["on", "off"]).default("on"),
  /** 1 이면 스트리밍 엔진의 OpenAI 이벤트(조각 제외)를 세션 종류와 함께 info 로 남긴다 (원문 누락 진단용) */
  STREAM_DEBUG: z.enum(["0", "1"]).default("0"),
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
