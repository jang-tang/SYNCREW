// 현장 용어 통역 정확도·지연 측정 (2026-10-24, docs/field-accuracy.md): 문장 200개(scripts/field-accuracy-sentences.json)를
// 실제 통화 코드(RealtimeStreamEngine, 스트리밍 용어집·받아쓰기 keywords·말 없는 턴 버리기 포함)로 ko→대상 언어 통역하고
// 문장마다 원문 전사·번역·지연을 남긴다. 채점(뜻 맞음 여부)은 결과 파일을 보고 따로 한다 (docs/field-accuracy.md 2절).
// 음성: macOS say(Yuna) 한국어 문장을 100ms 조각으로 실시간 속도로 보내고, 문장 뒤 무음 1.5초 (stream-turn-terms.ts 와 같다).
// 지연 = 마지막 말소리(파일 끝 무음 제외)가 든 조각을 보낸 뒤 → 첫 번역 음성이 서버에 도착할 때까지 (서버 VAD 무음 판정 0.5초 포함,
//   휴대폰 네트워크·재생 시간은 빠짐).
// 비용: 서버와 같은 BudgetGuard(openai_usage). --max-usd(기본 2.5)를 넘기면 다음 문장을 시작하지 않는다.
//
// 사용 (server 폴더에서, 먼저 npm run db:start):
//   npx tsx scripts/field-accuracy.ts --dry-run                       # 음성 만들기·문장 수만 (비용 0)
//   npx tsx scripts/field-accuracy.ts --target vi [--from s050] [--limit 5] [--max-usd 2.5]   # --from: 그 문장부터 (중간에 멈춘 뒤 이어서)
// 결과: stream-measure-output/field-accuracy-<대상>-<시각>.jsonl (문장마다 한 줄, git 제외)
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadEnv } from "../src/config/env";
import { decodeToPcm } from "../src/engine/audio/codec";
import { BudgetGuard } from "../src/engine/budget/budgetGuard";
import { buildPricingTable } from "../src/engine/budget/pricing";
import { PrismaUsageStore } from "../src/engine/budget/prismaUsageStore";
import { DomainProcessor } from "../src/engine/domain/domainProcessor";
import { createPrismaClient } from "../src/lib/prisma";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";
import type { Lang } from "../src/shared/languages";
import type { ContextLine, StreamConnection, TurnEnd } from "../src/streaming/engine";
import { RealtimeStreamEngine } from "../src/streaming/realtimeStream";

const RATE = 24_000;
const FRAME_MS = 100;
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;
const TRAILING_SILENCE_MS = 1_500;
const TURN_TIMEOUT_MS = 15_000;

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const DRY = process.argv.includes("--dry-run");
const MAX_USD = Number(arg("--max-usd") ?? "2.5");
const TARGET = (arg("--target") ?? "vi") as Lang;
const LIMIT = Number(arg("--limit") ?? "0");
const FROM = arg("--from");
const outDir = path.resolve("stream-measure-output");
const audioDir = path.join(outDir, "field-accuracy-audio");
const now = () => performance.timeOrigin + performance.now();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Sentence = { id: string; cat: "slang" | "term" | "number"; text: string; terms: string[]; meaning?: string };

async function prepare(s: Sentence): Promise<Int16Array> {
  const aiff = path.join(audioDir, `${s.id}.aiff`);
  if (!existsSync(aiff)) execFileSync("say", ["-v", "Yuna", "-o", aiff, s.text]);
  const decoded = await decodeToPcm(aiff, RATE);
  return new Int16Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length);
}

async function main() {
  mkdirSync(audioDir, { recursive: true });
  const all = (JSON.parse(readFileSync(path.resolve("scripts/field-accuracy-sentences.json"), "utf8")) as { sentences: Sentence[] }).sentences;
  const start = FROM ? all.findIndex((s) => s.id === FROM) : 0;
  if (start < 0) throw new Error(`--from ${FROM}: 그런 문장이 없습니다`);
  const sentences = LIMIT > 0 ? all.slice(start, start + LIMIT) : all.slice(start);
  const env = loadEnv();
  const dataset = await createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH).load();
  const glossary = new DomainProcessor(dataset).streamGlossary("ko", TARGET);

  const audio = new Map<string, Int16Array>();
  for (const s of sentences) audio.set(s.id, await prepare(s));
  const speechSeconds = [...audio.values()].reduce((sum, pcm) => sum + pcm.length / RATE, 0);
  console.log(`ko→${TARGET} ${sentences.length}문장, 말 ${speechSeconds.toFixed(0)}초, 예상 비용 약 $${(sentences.length * 0.011).toFixed(2)}, 이번 실행 상한 $${MAX_USD}`);
  if (DRY) return console.log("--dry-run: OpenAI 를 호출하지 않았습니다.");
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 가 없습니다.");

  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), buildPricingTable(env.OPENAI_PRICING_JSON), {
    limitUsd: env.OPENAI_BUDGET_USD,
    period: env.OPENAI_BUDGET_PERIOD,
  });
  const before = await budget.status();
  console.log(`한도 $${before.limitUsd}, 사용 $${before.spentUsd.toFixed(4)}, 남음 $${before.remainingUsd.toFixed(4)}`);
  const file = path.join(outDir, `field-accuracy-${TARGET}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

  let current: { turnId: string | null; firstAudioAt: number | null; delta: string; original: string; resolve: (end: TurnEnd) => void } | null = null;
  let connection: StreamConnection | null = null;
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
    log: (message, detail) => console.log(`  [엔진] ${message}`, detail ?? ""),
  });
  const open = () =>
    engine.open({
      sourceLang: "ko",
      targetLang: TARGET,
      glossary,
      events: {
        turnStart: (turnId) => {
          if (current && current.turnId === null) current.turnId = turnId;
        },
        audio: (turnId) => {
          if (current?.turnId === turnId && current.firstAudioAt === null) current.firstAudioAt = now();
        },
        translationDelta: (turnId, text) => {
          if (current?.turnId === turnId) current.delta += text;
        },
        originalDelta: (_turnId, text) => {
          if (current) current.original += text;
        },
        original: () => undefined,
        turnEnd: (turnId, result) => {
          if (current?.turnId === turnId || (current && current.turnId === null)) current.resolve(result);
        },
        closed: (reason) => {
          console.log(`  [엔진] 연결 끝남: ${reason}`);
          connection = null;
        },
      },
    });

  const history: ContextLine[] = [];
  try {
    for (const s of sentences) {
      const spent = (await budget.status()).spentUsd - before.spentUsd;
      if (spent >= MAX_USD) {
        console.log(`이번 실행 상한 $${MAX_USD} 도달 ($${spent.toFixed(4)}) — ${s.id} 부터 멈춤`);
        break;
      }
      if (!connection) {
        connection = await open();
        if (history.length) connection.setContext(history.slice(-2));
      }
      const pcm = audio.get(s.id)!;
      const done = new Promise<TurnEnd>((resolve) => {
        current = { turnId: null, firstAudioAt: null, delta: "", original: "", resolve };
      });
      let speechEndAt = 0;
      // 말 끝 = 마지막으로 소리가 있는 표본 (say 파일 끝의 무음은 말로 치지 않는다)
      let lastVoiced = pcm.length - 1;
      while (lastVoiced > 0 && Math.abs(pcm[lastVoiced]!) < 300) lastVoiced -= 1;
      const voicedEndFrame = Math.floor(lastVoiced / FRAME_SAMPLES);
      const frames = Math.ceil(pcm.length / FRAME_SAMPLES);
      const silenceFrames = TRAILING_SILENCE_MS / FRAME_MS;
      const t0 = now();
      for (let i = 0; i < frames + silenceFrames; i += 1) {
        const frame = new Int16Array(FRAME_SAMPLES);
        if (i < frames) frame.set(pcm.subarray(i * FRAME_SAMPLES, (i + 1) * FRAME_SAMPLES));
        connection?.append(Buffer.from(frame.buffer));
        if (i === voicedEndFrame) speechEndAt = now();
        await wait(Math.max(0, t0 + (i + 1) * FRAME_MS - now()));
      }
      const result = await Promise.race([done, wait(TURN_TIMEOUT_MS).then(() => null)]);
      const turn = current!;
      const translation = result?.status === "done" ? result.translation : turn.delta;
      const original = (result?.status === "done" ? result.original : null) ?? turn.original;
      const row = {
        id: s.id,
        cat: s.cat,
        text: s.text,
        terms: s.terms,
        meaning: s.meaning,
        target: TARGET,
        status: result ? (result.status === "done" ? "done" : `failed:${result.code}`) : "timeout",
        original,
        translation,
        /** 원문 전사에 용어·은어가 그대로 받아써진 수 (띄어쓰기 무시) */
        termsHeard: s.terms.filter((t) => original.replace(/\s+/g, "").includes(t.replace(/\s+/g, ""))).length,
        speechMs: Math.round((pcm.length / RATE) * 1000),
        firstAudioMs: turn.firstAudioAt ? Math.round(turn.firstAudioAt - speechEndAt) : null,
      };
      appendFileSync(file, `${JSON.stringify(row)}\n`);
      console.log(`${s.id} ${row.status} 첫음성 ${row.firstAudioMs ?? "-"}ms 원문 "${original}" → "${translation}"`);
      if (result?.status === "done" && original) {
        history.push({ original, translation });
        connection?.setContext(history.slice(-2));
      }
      await wait(500);
    }
  } finally {
    (connection as StreamConnection | null)?.close();
    const after = await budget.status();
    console.log(`\n이번 실행 비용 $${(after.spentUsd - before.spentUsd).toFixed(4)}, 누적 $${after.spentUsd.toFixed(4)}`);
    console.log(`결과: ${file}`);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
