// 겹침 재현 (2026-10-27): 문장을 짧은 간격으로 이어 말해 "앞 번역이 나오는 중에 다음 말이 끝나는" 상황을 만들고,
// 턴마다 원문 ↔ 번역이 같은 문장끼리 짝지어지는지(한 칸 밀림·예전 말 끼어듦이 없는지) 본다.
// 시드니 실기기에서 "예전에 했던 말이 다시 전달" — 원인은 자동 응답이 거절(conversation_already_has_active_response)되며 짝이 밀린 것.
// 실제 통화 코드(RealtimeStreamEngine)를 그대로 쓴다. 음성: macOS say(Yuna).
// 비용: 서버와 같은 BudgetGuard. --max-usd(기본 0.3) 를 넘기면 멈춘다. 문장 하나 약 $0.01.
//
// 사용 (server 폴더, 먼저 npm run db:start):
//   npx tsx scripts/stream-overlap.ts --dry-run
//   npx tsx scripts/stream-overlap.ts [--target vi] [--gap-ms 700] [--long] [--max-usd 0.3]
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/config/env";
import { decodeToPcm } from "../src/engine/audio/codec";
import { BudgetGuard } from "../src/engine/budget/budgetGuard";
import { buildPricingTable } from "../src/engine/budget/pricing";
import { PrismaUsageStore } from "../src/engine/budget/prismaUsageStore";
import { DomainProcessor } from "../src/engine/domain/domainProcessor";
import { createPrismaClient } from "../src/lib/prisma";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";
import type { Lang } from "../src/shared/languages";
import type { TurnEnd } from "../src/streaming/engine";
import { RealtimeStreamEngine } from "../src/streaming/realtimeStream";

const RATE = 24_000;
const FRAME_MS = 100;
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const DRY = process.argv.includes("--dry-run");
const MAX_USD = Number(arg("--max-usd") ?? "0.3");
const TARGET = (arg("--target") ?? "vi") as Lang;
/** 문장 사이 무음 (서버 VAD 말 끝 판정보다 조금 길게 — 앞 번역이 끝나기 전에 다음 말이 끝난다) */
const GAP_MS = Number(arg("--gap-ms") ?? "700");
const audioDir = path.resolve("stream-measure-output", "overlap-audio");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** --long: 긴 지시 바로 뒤에 짧은 말 (긴 번역이 나오는 중에 다음 말이 끝나 겹침이 확실히 생긴다) */
const LONG = process.argv.includes("--long");
/** 서로 뜻이 뚜렷이 다른 짧은 지시 (번역에 앞 문장이 섞이면 바로 보이게) */
const SHORT_SENTENCES = [
  "물 가져와.",
  "삼 층으로 올라가.",
  "작업 끝났어.",
  "안전모 써.",
  "트럭이 들어온다.",
  "점심 먹으러 가자.",
];
const LONG_SENTENCES = [
  "비계 위에서는 반드시 안전고리를 걸고 작업하고, 자재는 오늘 오후 두 시까지 비 문으로 들여오세요.",
  "물 가져와.",
  "크레인이 움직이는 동안에는 그 아래로 절대 지나가지 말고, 신호수의 손짓을 끝까지 확인하세요.",
  "작업 끝났어.",
  "삼 층 거푸집을 내일 아침 일곱 시까지 모두 해체하고, 남은 못은 한곳에 모아 두세요.",
  "안전모 써.",
];
const SENTENCES = LONG ? LONG_SENTENCES : SHORT_SENTENCES;

async function prepare(index: number, text: string): Promise<Int16Array> {
  const aiff = path.join(audioDir, `${LONG ? "l" : "s"}${index}.aiff`);
  if (!existsSync(aiff)) execFileSync("say", ["-v", "Yuna", "-o", aiff, text]);
  const decoded = await decodeToPcm(aiff, RATE);
  return new Int16Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length);
}

async function main() {
  mkdirSync(audioDir, { recursive: true });
  const audio = await Promise.all(SENTENCES.map((text, i) => prepare(i, text)));
  console.log(`ko→${TARGET} ${SENTENCES.length}문장을 무음 ${GAP_MS}ms 간격으로 이어 말함, 예상 약 $${(SENTENCES.length * 0.011).toFixed(2)}, 상한 $${MAX_USD}`);
  if (DRY) return console.log("--dry-run: OpenAI 를 호출하지 않았습니다.");
  const env = loadEnv();
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 가 없습니다.");
  const dataset = await createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH).load();
  const glossary = new DomainProcessor(dataset).streamGlossary("ko", TARGET);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), buildPricingTable(env.OPENAI_PRICING_JSON), {
    limitUsd: env.OPENAI_BUDGET_USD,
    period: env.OPENAI_BUDGET_PERIOD,
  });
  const before = await budget.status();
  if (before.remainingUsd < MAX_USD) throw new Error(`남은 한도 $${before.remainingUsd.toFixed(4)} < 상한 $${MAX_USD}`);

  const warnings: string[] = [];
  const ends: { turnId: string; result: TurnEnd }[] = [];
  const engine = new RealtimeStreamEngine({
    apiKey: env.OPENAI_API_KEY,
    model: env.TRANSLATION_MODEL,
    transcribeModel: env.STT_MODEL,
    streamTranscribeModel: env.STREAM_STT_MODEL,
    voice: env.TRANSLATION_VOICE,
    reasoning: env.TRANSLATION_REASONING,
    silenceMs: env.STREAM_VAD_SILENCE_MS,
    liveTranscription: true,
    budget,
    log: (message, detail) => {
      warnings.push(`${message} ${JSON.stringify(detail ?? {})}`);
      console.log(`  [엔진] ${message}`, detail ?? "");
    },
  });
  const connection = await engine.open({
    sourceLang: "ko",
    targetLang: TARGET,
    glossary,
    events: {
      turnStart: () => undefined,
      audio: () => undefined,
      translationDelta: () => undefined,
      originalDelta: () => undefined,
      original: () => undefined,
      turnEnd: (turnId, result) => ends.push({ turnId, result }),
      closed: (reason) => console.log(`  [엔진] 연결 끝남: ${reason}`),
    },
  });
  try {
    const t0 = performance.now();
    let sent = 0;
    const send = async (pcm: Int16Array) => {
      for (let i = 0; i < pcm.length; i += FRAME_SAMPLES) {
        const frame = new Int16Array(FRAME_SAMPLES);
        frame.set(pcm.subarray(i, i + FRAME_SAMPLES));
        connection.append(Buffer.from(frame.buffer));
        sent += 1;
        await wait(Math.max(0, t0 + sent * FRAME_MS - performance.now()));
      }
    };
    const silence = (ms: number) => new Int16Array((RATE * ms) / 1000);
    for (const pcm of audio) {
      await send(pcm);
      await send(silence(GAP_MS));
    }
    await send(silence(1500));
    // 남은 번역이 모두 끝날 때까지 (최대 20초)
    const until = performance.now() + 20_000;
    while (ends.length < SENTENCES.length && performance.now() < until) await wait(200);
  } finally {
    connection.close();
  }

  console.log("\n턴별 결과 (원문 → 번역):");
  for (const { result } of ends) {
    if (result.status === "done") console.log(`  "${result.original ?? ""}" → "${result.translation}"`);
    else console.log(`  (실패 ${result.code})`);
  }
  const done = ends.filter((e) => e.result.status === "done").length;
  const rejected = warnings.filter((w) => w.includes("conversation_already_has_active_response")).length;
  const after = await budget.status();
  console.log(`\n말한 문장 ${SENTENCES.length} · 번역된 턴 ${done} · 응답 거절 경고 ${rejected}`);
  console.log(`이번 실행 비용 $${(after.spentUsd - before.spentUsd).toFixed(4)}, 누적 $${after.spentUsd.toFixed(4)}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
