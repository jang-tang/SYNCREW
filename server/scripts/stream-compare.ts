// 글자 기반 통역 비교 (2026-10-28, docs/streaming-plan.md 4-4절): 같은 문장을 지금 방식(audio)과 글자 방식(text)으로 말해
// ① 말 끝 → 첫 통역 음성 지연(P50·P90) ② 화면 원문과 통역에 쓴 글자가 같은지 ③ 예측 적중·긴 말 나누기 ④ 비용 을 비교한다.
// 실제 통화 코드(RealtimeStreamEngine)를 그대로 쓴다. 음성: macOS say(Yuna).
//
// 장면
//   normal: 짧은 지시 6개, 문장 사이 무음 900ms (말 끝 판정 350ms 보다 길다 → 문장마다 턴 1개)
//   fast  : 긴 지시 3개를 무음 200ms 로 이어 말함 (빠르게 이어 말하기 → 지금 방식은 한 턴으로 뭉친다)
// 비용: 서버와 같은 BudgetGuard. --max-usd(기본 0.6)를 넘기면 멈춘다. 문장 하나 약 $0.01.
//
// 사용 (server 폴더, 먼저 npm run db:start):
//   npx tsx scripts/stream-compare.ts --dry-run
//   npx tsx scripts/stream-compare.ts [--target vi] [--modes audio,text] [--scenes normal,fast] [--max-usd 0.6]
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
const MAX_USD = Number(arg("--max-usd") ?? "0.6");
const TARGET = (arg("--target") ?? "vi") as Lang;
const MODES = (arg("--modes") ?? "audio,text").split(",") as ("audio" | "text")[];
const SCENES = (arg("--scenes") ?? "normal,fast").split(",") as SceneName[];
const audioDir = path.resolve("stream-measure-output", "compare-audio");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SceneName = "normal" | "fast";
const SCENE: Record<SceneName, { gapMs: number; sentences: string[] }> = {
  normal: {
    gapMs: 900,
    sentences: ["물 가져와.", "삼 층으로 올라가.", "작업 끝났어.", "안전모 써.", "트럭이 들어온다.", "점심 먹으러 가자."],
  },
  fast: {
    gapMs: 200,
    sentences: [
      "비계 위에서는 반드시 안전고리를 걸고 작업하세요.",
      "자재는 오늘 오후 두 시까지 비 문으로 들여오세요.",
      "크레인이 움직이는 동안에는 그 아래로 지나가지 마세요.",
    ],
  },
};

async function prepare(scene: SceneName, index: number, text: string): Promise<Int16Array> {
  const aiff = path.join(audioDir, `${scene}${index}.aiff`);
  if (!existsSync(aiff)) execFileSync("say", ["-v", "Yuna", "-o", aiff, text]);
  const decoded = await decodeToPcm(aiff, RATE);
  return new Int16Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length);
}

const pct = (values: number[], p: number) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};
const sec = (ms: number) => (Number.isNaN(ms) ? "-" : `${(ms / 1000).toFixed(2)}초`);

type Turn = { id: string; firstAudioAt: number | null; partial: string; result: TurnEnd | null };

async function main() {
  mkdirSync(audioDir, { recursive: true });
  const audio = Object.fromEntries(
    await Promise.all(SCENES.map(async (scene) => [scene, await Promise.all(SCENE[scene].sentences.map((text, i) => prepare(scene, i, text)))] as const)),
  ) as Record<SceneName, Int16Array[]>;
  const sentenceCount = SCENES.reduce((sum, scene) => sum + SCENE[scene].sentences.length, 0) * MODES.length;
  console.log(`ko→${TARGET} 방식 ${MODES.join("·")} × 장면 ${SCENES.join("·")} = 문장 ${sentenceCount}개, 예상 약 $${(sentenceCount * 0.012).toFixed(2)}, 상한 $${MAX_USD}`);
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
  const start = await budget.status();
  if (start.remainingUsd < MAX_USD) throw new Error(`남은 한도 $${start.remainingUsd.toFixed(4)} < 상한 $${MAX_USD}`);

  const summary: string[] = [];
  for (const scene of SCENES) {
    for (const mode of MODES) {
      const spent = (await budget.status()).spentUsd;
      if (spent - start.spentUsd > MAX_USD) {
        console.log(`상한 $${MAX_USD} 에 닿아 멈춤`);
        break;
      }
      summary.push(await run(scene, mode, audio[scene], env, budget, glossary));
      const after = await budget.status();
      summary[summary.length - 1] += ` · 비용 $${(after.spentUsd - spent).toFixed(4)}`;
    }
  }
  const end = await budget.status();
  console.log("\n=== 요약 ===");
  for (const line of summary) console.log(line);
  console.log(`이번 실행 비용 $${(end.spentUsd - start.spentUsd).toFixed(4)}, 누적 $${end.spentUsd.toFixed(4)}`);
  await prisma.$disconnect();
}

async function run(
  scene: SceneName,
  mode: "audio" | "text",
  pcms: Int16Array[],
  env: ReturnType<typeof loadEnv>,
  budget: BudgetGuard,
  glossary: ReturnType<DomainProcessor["streamGlossary"]>,
): Promise<string> {
  console.log(`\n--- ${scene} / ${mode} ---`);
  const turns = new Map<string, Turn>();
  const order: Turn[] = [];
  const traces = { miss: 0, cut: 0 };
  const turnOf = (id: string) => {
    let turn = turns.get(id);
    if (!turn) {
      turn = { id, firstAudioAt: null, partial: "", result: null };
      turns.set(id, turn);
    }
    return turn;
  };
  const engine = new RealtimeStreamEngine({
    apiKey: env.OPENAI_API_KEY!,
    model: env.TRANSLATION_MODEL,
    transcribeModel: env.STT_MODEL,
    streamTranscribeModel: env.STREAM_STT_MODEL,
    voice: env.TRANSLATION_VOICE,
    reasoning: env.TRANSLATION_REASONING,
    silenceMs: env.STREAM_VAD_SILENCE_MS,
    liveTranscription: true,
    translateFrom: mode,
    speculative: env.STREAM_SPECULATIVE === "on",
    segmentAfterMs: env.STREAM_SEGMENT_AFTER_MS,
    segmentPauseMs: env.STREAM_SEGMENT_PAUSE_MS,
    budget,
    log: (message, detail) => console.log(`  [엔진] ${message}`, detail ?? ""),
    trace: (_session, type) => {
      if (type === "speculation.miss") traces.miss += 1;
      if (type === "segment.cut") traces.cut += 1;
    },
  });
  const t0 = performance.now();
  const connection = await engine.open({
    sourceLang: "ko",
    targetLang: TARGET,
    glossary,
    events: {
      turnStart: (id) => order.push(turnOf(id)),
      audio: (id) => {
        const turn = turnOf(id);
        turn.firstAudioAt ??= performance.now() - t0;
      },
      translationDelta: () => undefined,
      // 말하는 도중 임시 자막 (말한 사람 화면에 실시간으로 뜨는 글자)
      originalDelta: (id, text) => {
        turnOf(id).partial += text;
      },
      original: () => undefined,
      turnEnd: (id, result) => {
        turnOf(id).result = result;
      },
      closed: (reason) => console.log(`  [엔진] 연결 끝남: ${reason}`),
    },
  });
  const sentenceEnds: number[] = [];
  let speechStart = 0;
  try {
    const startAt = performance.now();
    let sent = 0;
    const send = async (pcm: Int16Array) => {
      for (let i = 0; i < pcm.length; i += FRAME_SAMPLES) {
        const frame = new Int16Array(FRAME_SAMPLES);
        frame.set(pcm.subarray(i, i + FRAME_SAMPLES));
        connection.append(Buffer.from(frame.buffer));
        sent += 1;
        await wait(Math.max(0, startAt + sent * FRAME_MS - performance.now()));
      }
    };
    const silence = (ms: number) => new Int16Array((RATE * ms) / 1000);
    await send(silence(500));
    speechStart = performance.now() - t0;
    for (const pcm of pcms) {
      await send(pcm);
      sentenceEnds.push(performance.now() - t0);
      await send(silence(SCENE[scene].gapMs));
    }
    await send(silence(1500));
    const until = performance.now() + 20_000;
    while (order.some((turn) => turn.result === null) || order.length === 0) {
      if (performance.now() > until) break;
      await wait(200);
    }
  } finally {
    connection.close();
  }

  for (const turn of order) {
    const r = turn.result;
    const heard = turn.firstAudioAt === null ? "-" : sec(turn.firstAudioAt - speechStart);
    if (r?.status === "done") console.log(`  [말 시작 +${heard}] 임시 "${turn.partial}" / 확정 "${r.original ?? ""}" → "${r.translation}"`);
    else console.log(`  [말 시작 +${heard}] (실패 ${r?.status === "failed" ? r.code : "끝나지 않음"})`);
  }
  const done = order.filter((t) => t.result?.status === "done");
  const firstHeard = order.find((t) => t.firstAudioAt !== null)?.firstAudioAt ?? NaN;
  if (scene === "normal") {
    // 문장마다 턴 1개일 때: k 번째 턴의 첫 통역 음성 − k 번째 문장 끝
    const lat = order.slice(0, sentenceEnds.length).flatMap((turn, k) => (turn.firstAudioAt === null ? [] : [turn.firstAudioAt - sentenceEnds[k]!]));
    return `${scene}/${mode}: 턴 ${order.length}(완료 ${done.length}) · 말 끝→첫 통역 음성 P50 ${sec(pct(lat, 50))} P90 ${sec(pct(lat, 90))} · 예측 빗나감 ${traces.miss} · 나눔 ${traces.cut}`;
  }
  return `${scene}/${mode}: 턴 ${order.length}(완료 ${done.length}) · 말 시작→첫 통역 음성 ${sec(firstHeard - speechStart)} · 첫 문장 끝→첫 통역 음성 ${sec(firstHeard - sentenceEnds[0]!)} · 마지막 문장 끝→첫 통역 음성 ${sec(firstHeard - sentenceEnds.at(-1)!)} · 예측 빗나감 ${traces.miss} · 나눔 ${traces.cut}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
