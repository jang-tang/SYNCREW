// 확정 자막 정확도 (2026-10-28, docs/streaming-plan.md 4-5절): 현장 용어가 든 문장을 말해 턴마다
//   ① 지금 자막(전사 세션 gpt-live-transcribe 완성본) ② 확정 자막(그 턴 음성을 STT_MODEL=gpt-4o-transcribe 로 다시 받아쓴 것)
// 을 정답 문장과 비교한다 (글자 오류율 CER: 공백·문장부호 빼고 편집 거리 ÷ 정답 글자 수). 확정 자막이 뜨는 시각도 잰다.
// 통역은 지금 방식(음성을 직접 들음) 그대로. 실제 통화 코드(RealtimeStreamEngine + OpenAiStt)를 쓴다. 음성: macOS say(Yuna).
// 비용: 서버와 같은 BudgetGuard, --max-usd(기본 0.4) 를 넘기면 멈춘다. 문장 하나 약 $0.01 (대부분 통역).
//
// 사용 (server 폴더, 먼저 npm run db:start):
//   npx tsx scripts/stream-subtitle.ts --dry-run
//   npx tsx scripts/stream-subtitle.ts [--rounds 2] [--target vi] [--max-usd 0.4]
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
import { OpenAiStt } from "../src/engine/stt/openAiStt";
import { createPrismaClient } from "../src/lib/prisma";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";
import type { Lang } from "../src/shared/languages";
import { RealtimeStreamEngine } from "../src/streaming/realtimeStream";

const RATE = 24_000;
const FRAME_MS = 100;
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;
const GAP_MS = 1_200;

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const DRY = process.argv.includes("--dry-run");
const MAX_USD = Number(arg("--max-usd") ?? "0.4");
const TARGET = (arg("--target") ?? "vi") as Lang;
const ROUNDS = Number(arg("--rounds") ?? "2");
const audioDir = path.resolve("stream-measure-output", "subtitle-audio");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 현장 용어·숫자·은어가 든 지시 (정답 = 이 글자) */
const SENTENCES = [
  "비계 위에서는 반드시 안전고리를 거세요.",
  "자재는 오후 두 시까지 비 문으로 들여오세요.",
  "삼 층 거푸집을 내일 아침까지 해체하세요.",
  "크레인 아래로 지나가지 마세요.",
  "이 번 프레스 기계 비상정지 버튼을 확인하세요.",
  "아시바 올라가기 전에 안전대 착용해.",
  "공구리 치기 전에 철근 간격 다시 봐.",
  "점심 먹으러 가자.",
  "지게차 동선 비워 두세요.",
  "오늘 작업은 다섯 시에 끝납니다.",
];

async function prepare(index: number, text: string): Promise<Int16Array> {
  const aiff = path.join(audioDir, `s${index}.aiff`);
  if (!existsSync(aiff)) execFileSync("say", ["-v", "Yuna", "-o", aiff, text]);
  const decoded = await decodeToPcm(aiff, RATE);
  return new Int16Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length);
}

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** 글자 오류율: 공백·문장부호를 뺀 편집 거리 ÷ 정답 글자 수 */
export function cer(truth: string, hypothesis: string): number {
  const a = [...norm(truth)];
  const b = [...norm(hypothesis)];
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]! / a.length;
}

const pct = (values: number[], p: number) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};
const mean = (values: number[]) => (values.length === 0 ? NaN : values.reduce((x, y) => x + y, 0) / values.length);

async function main() {
  mkdirSync(audioDir, { recursive: true });
  const audio = await Promise.all(SENTENCES.map((text, i) => prepare(i, text)));
  console.log(`ko→${TARGET} 문장 ${SENTENCES.length}개 × ${ROUNDS}회 = ${SENTENCES.length * ROUNDS}턴, 예상 약 $${(SENTENCES.length * ROUNDS * 0.01).toFixed(2)}, 상한 $${MAX_USD}`);
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

  type Row = { truth: string; live: string; final: string | null; why: string; finalAfterEnd: number | null };
  const rows: Row[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    if ((await budget.status()).spentUsd - start.spentUsd > MAX_USD) {
      console.log(`상한 $${MAX_USD} 에 닿아 멈춤`);
      break;
    }
    console.log(`\n--- ${round}회차 ---`);
    // 턴 순서대로: 확정 자막 trace(live·final) 와 화면에 원문이 올라간 시각
    const finals: { live: string; final: string | null; why: string }[] = [];
    const shownAt: number[] = [];
    const engine = new RealtimeStreamEngine({
      apiKey: env.OPENAI_API_KEY,
      model: env.TRANSLATION_MODEL,
      transcribeModel: env.STT_MODEL,
      streamTranscribeModel: env.STREAM_STT_MODEL,
      voice: env.TRANSLATION_VOICE,
      reasoning: env.TRANSLATION_REASONING,
      silenceMs: env.STREAM_VAD_SILENCE_MS,
      liveTranscription: true,
      finalStt: new OpenAiStt(env.OPENAI_API_KEY, env.STT_MODEL, budget),
      budget,
      log: (message, detail) => console.log(`  [엔진] ${message}`, detail ?? ""),
      trace: (_session, type, detail) => {
        if (type === "finalStt") finals.push({ live: String(detail["live"] ?? ""), final: (detail["final"] as string | null) ?? null, why: String(detail["why"]) });
      },
    });
    const t0 = performance.now();
    const connection = await engine.open({
      sourceLang: "ko",
      targetLang: TARGET,
      glossary,
      events: {
        turnStart: () => undefined,
        audio: () => undefined,
        translationDelta: () => undefined,
        originalDelta: () => undefined,
        original: () => shownAt.push(performance.now() - t0),
        turnEnd: () => undefined,
        closed: (reason) => console.log(`  [엔진] 연결 끝남: ${reason}`),
      },
    });
    const ends: number[] = [];
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
      for (const pcm of audio) {
        await send(pcm);
        ends.push(performance.now() - t0);
        await send(silence(GAP_MS));
      }
      await send(silence(1500));
      const until = performance.now() + 10_000;
      while (finals.length < SENTENCES.length && performance.now() < until) await wait(200);
    } finally {
      connection.close();
    }
    if (finals.length !== SENTENCES.length) console.log(`  ⚠ 턴 수 ${finals.length} ≠ 문장 수 ${SENTENCES.length} (아래 짝은 순서대로)`);
    SENTENCES.forEach((truth, k) => {
      const f = finals[k];
      const row: Row = { truth, live: f?.live ?? "", final: f?.final ?? null, why: f?.why ?? "없음", finalAfterEnd: shownAt[k] !== undefined ? shownAt[k]! - ends[k]! : null };
      rows.push(row);
      console.log(`  정답 "${truth}"\n    지금 "${row.live}" (CER ${(cer(truth, row.live) * 100).toFixed(0)}%)\n    확정 "${row.final ?? `(${row.why})`}" (CER ${row.final === null ? "-" : (cer(truth, row.final) * 100).toFixed(0) + "%"})`);
    });
  }

  const liveCer = rows.map((r) => cer(r.truth, r.live));
  const finalCer = rows.filter((r) => r.final !== null).map((r) => cer(r.truth, r.final!));
  const shown = rows.flatMap((r) => (r.finalAfterEnd === null ? [] : [r.finalAfterEnd]));
  const exactLive = rows.filter((r) => cer(r.truth, r.live) === 0).length;
  const exactFinal = rows.filter((r) => r.final !== null && cer(r.truth, r.final) === 0).length;
  const end = await budget.status();
  console.log("\n=== 요약 ===");
  console.log(`턴 ${rows.length} · 확정 자막 받음 ${finalCer.length}`);
  console.log(`글자 오류율 평균: 지금 자막 ${(mean(liveCer) * 100).toFixed(1)}% · 확정 자막 ${(mean(finalCer) * 100).toFixed(1)}%`);
  console.log(`정답과 똑같은 문장: 지금 ${exactLive}/${rows.length} · 확정 ${exactFinal}/${rows.length}`);
  console.log(`문장 끝 → 화면 원문(확정) P50 ${(pct(shown, 50) / 1000).toFixed(2)}초 · P90 ${(pct(shown, 90) / 1000).toFixed(2)}초`);
  console.log(`이번 실행 비용 $${(end.spentUsd - start.spentUsd).toFixed(4)}, 누적 $${end.spentUsd.toFixed(4)}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
