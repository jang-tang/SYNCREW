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
  // 동시 엔진 연결(통역 레인) 상한. 현장 전체 연결은 말하는 사람마다 다른 언어 수만큼 연다 — 3명·3개 언어면 6개 (2026-10-27 4 → 8)
  STREAM_MAX_SESSIONS: z.coerce.number().int().min(1).max(64).default(8),
  /** OpenAI server_vad 말 끝 무음 (ms). S0 실측 기준 500 → 2026-10-24 350 (지연 약 0.24초 단축, docs/field-accuracy.md 8절). 사람 목소리로 문장이 잘리는지 실기기 확인 전 */
  STREAM_VAD_SILENCE_MS: z.coerce.number().int().min(200).max(2000).default(350),
  /**
   * 스트리밍 전사 전용 세션 (2026-10-19): on 이면 화자 스트림마다 OpenAI 전사 세션(intent=transcription)을 하나 더 열어
   * 원문 조각(original_partial)을 번역 응답과 따로, 말 끝 직후(0.1–0.4초)에 받는다. 번역 세션의 입력 전사는 끈다(받아쓰기 2번 청구 방지).
   * off 면 예전처럼 번역 세션이 전사까지 한다(원문이 0.5–1.5초 늦고 빠지기도 했다)
   */
  STREAM_LIVE_TRANSCRIPTION: z.enum(["on", "off"]).default("on"),
  /**
   * 스트리밍 통역 입력 (2026-10-28, docs/streaming-plan.md 4-4절). audio = 번역 모델이 음성을 직접 듣는다(예전 그대로),
   * text = 전사 세션의 원문 글자만 넣어 통역 → 말한 사람 화면의 원문과 통역이 같은 글자. STREAM_LIVE_TRANSCRIPTION=on + gpt-live-transcribe 일 때만
   */
  STREAM_TRANSLATE_FROM: z.enum(["audio", "text"]).default("audio"),
  /** text 방식: 임시 자막으로 미리 요청하고 확정 원문과 같을 때만 내보낸다 (확정을 기다리는 시간과 통역 생성이 겹침) */
  STREAM_SPECULATIVE: z.enum(["on", "off"]).default("on"),
  /** text 방식 긴 말 나누기: 한 턴이 이 길이(ms)를 넘으면 STREAM_SEGMENT_PAUSE_MS 쉼에서도 턴을 나눈다. 0 이면 나누지 않는다 */
  STREAM_SEGMENT_AFTER_MS: z.coerce.number().int().min(0).max(60_000).default(4_000),
  STREAM_SEGMENT_PAUSE_MS: z.coerce.number().int().min(80).max(2_000).default(200),
  /**
   * 확정 자막 (2026-10-28, docs/streaming-plan.md 4-5절): on 이면 말 끝마다 그 턴 음성을 STT_MODEL(gpt-4o-transcribe)로 다시 받아써
   * 화면·기록 원문으로 쓴다. 말하는 도중 자막은 그대로 gpt-live-transcribe. 통역은 그대로 음성을 직접 듣는다. off 면 예전 그대로
   */
  STREAM_FINAL_STT: z.enum(["on", "off"]).default("off"),
  /** 확정 자막 방식: fallback = 전사 세션 완성본이 비었을 때만 채움(10-28 실측 권장), replace = 언제나 확정 자막으로 */
  STREAM_FINAL_STT_MODE: z.enum(["fallback", "replace"]).default("fallback"),
  /**
   * 말한 사람의 "내 말" 자막·기록 원문 (2026-10-28, docs/streaming-plan.md 4-6절): transcript = 받아쓰기(예전 그대로),
   * back = 통역문을 말한 사람 언어로 되돌린 글 (말하는 도중 흐린 자막은 받아쓰기 그대로). 현장 전체 연결은 먼저 통역이 끝난 언어 기준
   */
  STREAM_MINE_CAPTION: z.enum(["transcript", "back"]).default("transcript"),
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
