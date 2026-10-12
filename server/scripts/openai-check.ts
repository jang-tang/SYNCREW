// 실제 OpenAI 통역 왕복 확인 (5개 언어 품질·단계별 지연·실제 비용).
// 한국어 음성(macOS say) → STT → 4개 언어 번역(음성 포함) → 그 번역 음성을 작업자 발화로 다시 STT → 한국어 번역(텍스트).
// 모든 호출은 서버와 같은 BudgetGuard(openai_usage 테이블, OPENAI_BUDGET_USD)를 거친다. 실행 전 `npm run db:start`.
// 사용: npx tsx scripts/openai-check.ts [--out 디렉터리] [--targets vi,zh,uz,ru] [--reuse]
//   --reuse: 이전 실행이 남긴 ko-to-<언어>.wav 가 있으면 한국어→작업자 언어 번역을 건너뛰고 그 음성을 쓴다 (비용 절약)
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/config/env";
import type { Lang } from "../src/shared/languages";
import { decodeToPcm, durationSeconds, encodeWav } from "../src/engine/audio/codec";
import { BudgetGuard } from "../src/engine/budget/budgetGuard";
import { buildPricingTable, estimateCostUsd, type UsageTokens } from "../src/engine/budget/pricing";
import { PrismaUsageStore } from "../src/engine/budget/prismaUsageStore";
import { DomainProcessor } from "../src/engine/domain/domainProcessor";
import { OpenAiStt } from "../src/engine/stt/openAiStt";
import { RealtimeTranslator } from "../src/engine/translation/realtimeTranslator";
import { createPrismaClient } from "../src/lib/prisma";
import { STT_PROMPT } from "../src/messaging/pipeline";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";

const KOREAN = "안전모 착용하고 2번 프레스 기계 비상정지 버튼을 확인하세요.";
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const TARGETS = (arg("--targets") ?? "vi,zh,uz,ru").split(",") as Lang[];
const REUSE = process.argv.includes("--reuse");
const outDir = path.resolve(arg("--out") ?? "openai-check-output");

async function main() {
  const env = loadEnv();
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 없습니다.");
  mkdirSync(outDir, { recursive: true });

  const pricing = buildPricingTable(env.OPENAI_PRICING_JSON);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), pricing, {
    limitUsd: env.OPENAI_BUDGET_USD,
    period: env.OPENAI_BUDGET_PERIOD,
  });
  const before = await budget.status();
  console.log(
    `한도 $${before.limitUsd} (${before.period}), 사용 $${before.spentUsd.toFixed(4)}, 남음 $${before.remainingUsd.toFixed(4)}`,
  );

  const domain = new DomainProcessor(await createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH).load());
  const stt = new OpenAiStt(env.OPENAI_API_KEY, env.STT_MODEL, budget);
  const translator = new RealtimeTranslator({
    apiKey: env.OPENAI_API_KEY,
    model: env.TRANSLATION_MODEL,
    voice: env.TRANSLATION_VOICE,
    reasoning: env.TRANSLATION_REASONING,
    budget,
  });

  const cost = (model: string, usage: UsageTokens) => estimateCostUsd(pricing, model, usage);
  const rows: Record<string, unknown>[] = [];
  const record = (row: Record<string, unknown>) => {
    rows.push(row);
    console.log(JSON.stringify(row));
  };
  const timed = async <T>(task: () => Promise<T>) => {
    const start = performance.now();
    const value = await task();
    return { value, ms: Math.round(performance.now() - start) };
  };

  // 1) 관리자 한국어 발화
  const koAiff = path.join(outDir, "ko-source.aiff");
  execFileSync("say", ["-v", "Yuna", "-o", koAiff, KOREAN]);
  const koPcm = await decodeToPcm(koAiff);
  const koStt = await timed(() => stt.transcribe({ audio: koPcm, lang: "ko", prompt: STT_PROMPT }));
  record({
    step: "STT ko",
    seconds: durationSeconds(koPcm).toFixed(1),
    ms: koStt.ms,
    text: koStt.value.text,
    usd: cost(env.STT_MODEL, koStt.value.usage),
    usage: koStt.value.usage,
  });
  const koDomain = domain.process(koStt.value.text, "ko");

  for (const target of TARGETS) {
    const wavPath = path.join(outDir, `ko-to-${target}.wav`);
    if (!(REUSE && existsSync(wavPath))) {
      // 2) 한국어 → 작업자 언어 (음성 포함, 실제 기본 설정과 같음)
      const out = await timed(() =>
        translator.translate({
          text: koDomain.correctedText,
          sourceLang: "ko",
          targetLang: target,
          context: domain.buildContext(koDomain, target),
          withAudio: true,
        }),
      );
      const audio = out.value.audio;
      const audioSeconds = audio ? audio.data.length / 2 / audio.sampleRate : 0;
      record({
        step: `번역 ko→${target} (음성)`,
        ms: out.ms,
        audioSeconds: audioSeconds.toFixed(1),
        text: out.value.text,
        usd: cost(out.value.model, out.value.usage),
        usage: out.value.usage,
      });
      if (!audio) continue;
      writeFileSync(wavPath, encodeWav(audio.data, audio.sampleRate));
    } else {
      record({ step: `번역 ko→${target}`, reused: wavPath });
    }

    // 3) 그 음성을 작업자 발화로 보고 STT (우즈베크어 인식 지원 여부 포함)
    const pcm = await decodeToPcm(wavPath);
    const heard = await timed(() => stt.transcribe({ audio: pcm, lang: target, prompt: STT_PROMPT }));
    record({
      step: `STT ${target}`,
      ms: heard.ms,
      text: heard.value.text,
      usd: cost(env.STT_MODEL, heard.value.usage),
      usage: heard.value.usage,
    });

    // 4) 작업자 언어 → 한국어 (텍스트만, 비용 절약)
    const workerDomain = domain.process(heard.value.text, target);
    const back = await timed(() =>
      translator.translate({
        text: workerDomain.correctedText,
        sourceLang: target,
        targetLang: "ko",
        context: domain.buildContext(workerDomain, "ko"),
        withAudio: false,
      }),
    );
    record({
      step: `번역 ${target}→ko (텍스트)`,
      ms: back.ms,
      text: back.value.text,
      usd: cost(back.value.model, back.value.usage),
      usage: back.value.usage,
    });
  }

  const after = await budget.status();
  const total = after.spentUsd - before.spentUsd;
  console.log(
    `이번 실행 비용(기록 기준) $${total.toFixed(4)}, 누적 $${after.spentUsd.toFixed(4)} / 한도 $${after.limitUsd}`,
  );
  writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ source: KOREAN, rows, totalUsd: total }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
