import { createSupabaseVerifier } from "./auth/verifier";
import type { Env } from "./config/env";
import type { AppContext } from "./context";
import { noopEvents } from "./events/domainEvents";
import { PresenceRegistry } from "./realtime/presence";
import { BudgetGuard } from "./engine/budget/budgetGuard";
import { buildPricingTable } from "./engine/budget/pricing";
import { PrismaUsageStore } from "./engine/budget/prismaUsageStore";
import { DomainProcessor } from "./engine/domain/domainProcessor";
import type { Logger } from "./lib/logger";
import { createPrismaClient } from "./lib/prisma";
import { createAudioPreprocessor } from "./plugins/audioPreprocessor";
import { createDatasetAdapter } from "./plugins/datasetAdapter";
import { FakeStt, FakeTranslator } from "./engine/fake";
import { OpenAiStt } from "./engine/stt/openAiStt";
import type { SttProvider } from "./engine/stt/sttProvider";
import { RealtimeTranslator } from "./engine/translation/realtimeTranslator";
import type { Translator } from "./engine/translation/translator";
import { AudioUrlSigner } from "./messaging/audioUrls";
import { MessagePipeline, type PipelineOptions } from "./messaging/pipeline";
import { FileStorage } from "./messaging/storage";

export type ContextOverrides = Partial<Pick<AppContext, "verifier" | "events" | "limits" | "stt" | "translator">> & {
  pipeline?: Partial<PipelineOptions>;
};

/** 환경 변수로부터 서버 의존성을 만든다. 설정 오류는 시작 시점에 바로 실패시킨다. */
export async function createContext(
  env: Env,
  logger: Logger,
  overrides: ContextOverrides = {},
): Promise<AppContext> {
  let verifier = overrides.verifier;
  if (!verifier) {
    if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL이 없습니다. 로그인 토큰을 검증할 수 없습니다 (.env 확인).");
    verifier = createSupabaseVerifier(env.SUPABASE_URL, env.SUPABASE_JWKS_URL);
  }

  const pricing = buildPricingTable(env.OPENAI_PRICING_JSON);
  for (const model of [env.STT_MODEL, env.TRANSLATION_MODEL]) {
    if (!pricing[model]) {
      throw new Error(`모델 단가가 없습니다: ${model}. OPENAI_PRICING_JSON에 추가하세요.`);
    }
  }

  const adapter = createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH);
  const domain = new DomainProcessor(await adapter.load());

  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), pricing, {
    limitUsd: env.OPENAI_BUDGET_USD,
    period: env.OPENAI_BUDGET_PERIOD,
  });

  // 통역 엔진: ENGINE=fake 면 가짜 엔진, 아니면 OpenAI 키가 있을 때만 실제 엔진
  let stt: SttProvider | null = null;
  let translator: Translator | null = null;
  if (env.ENGINE === "fake") {
    stt = new FakeStt({ delayMs: 300 });
    translator = new FakeTranslator({ delayMs: 600 });
  } else if (env.OPENAI_API_KEY) {
    stt = new OpenAiStt(env.OPENAI_API_KEY, env.STT_MODEL, budget);
    translator = new RealtimeTranslator({
      apiKey: env.OPENAI_API_KEY,
      model: env.TRANSLATION_MODEL,
      voice: env.TRANSLATION_VOICE,
      reasoning: env.TRANSLATION_REASONING,
      budget,
    });
  }

  const context = {
    env,
    logger,
    prisma,
    budget,
    domain,
    audioPreprocessor: createAudioPreprocessor(env.AUDIO_PREPROCESSOR),
    verifier,
    events: overrides.events ?? noopEvents,
    limits: overrides.limits ?? { joinPerMinute: 5, messagesPerMinute: 30 },
    presence: new PresenceRegistry(),
    stt: overrides.stt !== undefined ? overrides.stt : stt,
    translator: overrides.translator !== undefined ? overrides.translator : translator,
    storage: new FileStorage(env.STORAGE_DIR),
    audioUrls: new AudioUrlSigner(env.AUDIO_URL_SECRET),
  } as Omit<AppContext, "pipeline"> as AppContext;
  context.pipeline = new MessagePipeline(context, {
    concurrency: env.TRANSLATION_CONCURRENCY,
    withAudio: env.TRANSLATION_AUDIO === "on",
    ...overrides.pipeline,
  });
  return context;
}
