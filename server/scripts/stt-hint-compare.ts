// 받아쓰기 힌트·모델 비교: 같은 음성을 받아쓰기 모델(기본 .env STT_MODEL, --model 로 바꿈)로 (a) 기본 안내 (b) 현장 용어 힌트 로 받아써 비교한다.
// 2026-10-14 결과: docs/streaming-plan.md 5-2절 (모델을 gpt-4o-transcribe 로 바꾸고 용어 힌트는 쓰지 않기로 함).
// 음성: S0 측정·번역 모델 비교에 쓴 문장 (macOS 합성 음성, uz1 은 translate-compare-output 의 생성 음성이 있으면 사용).
// 모든 호출은 BudgetGuard 를 거친다. 사용: npx tsx scripts/stt-hint-compare.ts [--dry-run]  (실행 전 npm run db:start)
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/config/env";
import type { Lang } from "../src/shared/languages";
import { decodeToPcm } from "../src/engine/audio/codec";
import { BudgetGuard } from "../src/engine/budget/budgetGuard";
import { buildPricingTable, estimateCostUsd } from "../src/engine/budget/pricing";
import { PrismaUsageStore } from "../src/engine/budget/prismaUsageStore";
import { BASE_TRANSCRIPTION_PROMPT, createTranscriptionPrompts } from "../src/engine/domain/transcriptionHints";
import { OpenAiStt } from "../src/engine/stt/openAiStt";
import { createPrismaClient } from "../src/lib/prisma";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";

const DRY = process.argv.includes("--dry-run");
const modelIndex = process.argv.indexOf("--model");
/** 비교할 받아쓰기 모델 (기본: .env STT_MODEL). gpt-4o-transcribe 단가는 공식 가격표로 확인하지 못해 추정값으로 기록 */
const MODEL_OVERRIDE = modelIndex > 0 ? process.argv[modelIndex + 1] : undefined;
const ESTIMATED_PRICES = {};
const outDir = path.resolve("stt-hint-output");
const clips: { id: string; lang: Lang; voice: string | null; text: string }[] = [
  { id: "ko1", lang: "ko", voice: "Yuna", text: "안전모 착용하고 2번 프레스 기계 비상정지 버튼을 확인하세요." },
  { id: "ko2", lang: "ko", voice: "Yuna", text: "자재는 B문으로 들이고 지게차 동선을 비워 두세요." },
  { id: "ko3", lang: "ko", voice: "Yuna", text: "오후 3시까지 3층 거푸집 해체를 끝내세요." },
  { id: "ko4", lang: "ko", voice: "Yuna", text: "비계 위에서는 안전고리를 꼭 거세요." },
  { id: "ko5", lang: "ko", voice: "Yuna", text: "아시바 해체 전에 데스라 먼저 확인해." },
  { id: "vi1", lang: "vi", voice: "Linh", text: "Tôi đã kiểm tra nút dừng khẩn cấp, máy số hai vẫn bình thường." },
  { id: "zh1", lang: "zh", voice: "Tingting", text: "三楼的模板已经拆完了，下一步做什么？" },
  { id: "ru1", lang: "ru", voice: "Milena", text: "У меня закончились перчатки, где взять новые?" },
  { id: "uz1", lang: "uz", voice: null, text: "Soat 15:00 ga qadar 3-qavatdagi qolipni demontaj qilishni tugating." },
];

async function main() {
  const env = loadEnv();
  mkdirSync(outDir, { recursive: true });
  const dataset = await createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH).load();
  const prompts = createTranscriptionPrompts(dataset);
  for (const lang of ["ko", "vi", "zh", "ru", "uz"] as Lang[]) console.log(`[${lang} 힌트 ${prompts(lang).length}자] ${prompts(lang).slice(0, 160)}…`);

  const audio = new Map<string, Awaited<ReturnType<typeof decodeToPcm>>>();
  for (const clip of clips) {
    const uzWav = path.resolve("translate-compare-output/uz1.wav");
    if (!clip.voice) {
      if (existsSync(uzWav)) audio.set(clip.id, await decodeToPcm(uzWav));
      continue;
    }
    const aiff = path.join(outDir, `${clip.id}.aiff`);
    execFileSync("say", ["-v", clip.voice, "-o", aiff, clip.text]);
    audio.set(clip.id, await decodeToPcm(aiff));
  }
  const seconds = [...audio.values()].reduce((s, a) => s + a.data.length / a.sampleRate, 0);
  console.log(`음성 ${audio.size}개 ${seconds.toFixed(1)}초 × 2가지 힌트 → 예상 약 $${((seconds * 2) / 60 * 0.004 + 0.002).toFixed(4)}`);
  if (DRY) return;

  const pricing = { ...ESTIMATED_PRICES, ...buildPricingTable(env.OPENAI_PRICING_JSON) };
  const model = MODEL_OVERRIDE ?? env.STT_MODEL;
  console.log(`받아쓰기 모델: ${model}`);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), pricing, { limitUsd: env.OPENAI_BUDGET_USD, period: env.OPENAI_BUDGET_PERIOD });
  const before = await budget.status();
  const stt = new OpenAiStt(env.OPENAI_API_KEY!, model, budget);
  const rows = [];
  for (const clip of clips) {
    const pcm = audio.get(clip.id);
    if (!pcm) continue;
    const base = await stt.transcribe({ audio: pcm, lang: clip.lang, prompt: BASE_TRANSCRIPTION_PROMPT });
    const hinted = await stt.transcribe({ audio: pcm, lang: clip.lang, prompt: prompts(clip.lang) });
    rows.push({ id: clip.id, expected: clip.text, base: base.text, hinted: hinted.text, usd: estimateCostUsd(pricing, model, base.usage) + estimateCostUsd(pricing, model, hinted.usage) });
    console.log(`\n${clip.id} 정답: ${clip.text}\n   지금 힌트: ${base.text}\n   용어 힌트: ${hinted.text}`);
  }
  const after = await budget.status();
  console.log(`\n이번 실행 기록 비용 $${(after.spentUsd - before.spentUsd).toFixed(4)}, 누적 $${after.spentUsd.toFixed(4)} / 한도 $${after.limitUsd}`);
  writeFileSync(path.join(outDir, `result-${model}.json`), JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
