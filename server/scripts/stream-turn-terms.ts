// 스트리밍 "턴 용어" 실험 (2026-10-24, docs/field-terms.md 8·9절): 말하는 도중 전사 조각에서 이번 턴 은어를 찾아 번역에 넣으면
// 미리 넣는 용어집(은어 60개)에 없는 은어도 맞게 번역되는지, 지연은 얼마나 느는지 잰다.
// 실제 통화 코드(RealtimeStreamEngine)를 그대로 쓰고 turnTerms 방식만 바꿔 같은 문장을 돌린다:
//   off    — 지금 동작 (미리 넣는 용어집만)
//   update — 전사 조각에서 용어를 찾는 즉시 session.update (자동 응답 그대로, 지연 없음 — 말 끝 전에 도착해야 반영)
//   create — 자동 응답을 끄고 말 끝에 response.create + 턴 용어 (서버 ↔ OpenAI 한 번 오가는 만큼 늦음)
// 음성: macOS say(Yuna)로 만든 한국어 문장을 100ms 조각으로 실시간 속도로 보내고, 문장 뒤 무음 1.5초.
// 비용: 서버와 같은 BudgetGuard(openai_usage) 를 거친다. --max-usd(기본 0.6)를 넘기면 다음 방식을 시작하지 않는다.
//
// 사용 (server 폴더에서, 먼저 npm run db:start):
//   npx tsx scripts/stream-turn-terms.ts --dry-run            # 음성·문장·용어 감지만 (비용 0)
//   npx tsx scripts/stream-turn-terms.ts [--modes off,update,create] [--target zh] [--max-usd 0.6]
// 결과: stream-measure-output/turn-terms-<시각>.json (git 제외)
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
import { RealtimeStreamEngine, type TurnTermsMode } from "../src/streaming/realtimeStream";

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
const MAX_USD = Number(arg("--max-usd") ?? "0.6");
const TARGET = (arg("--target") ?? "zh") as Lang;
const MODES = (arg("--modes") ?? "off,update,create").split(",") as TurnTermsMode[];
const outDir = path.resolve("stream-measure-output");
const now = () => performance.timeOrigin + performance.now();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 문장과 맞게 번역됐는지 볼 중국어 표현 (묶음마다 하나라도 있으면 맞음). preloaded = 미리 넣는 용어집에 있는 대조군 */
type Case = { id: string; text: string; slang: string[]; expect: string[][]; preloaded?: boolean };
const CASES: Case[] = [
  { id: "t1", text: "호리가다 끝나면 바로 우메모도시 들어갑니다", slang: ["호리가다", "우메모도시"], expect: [["挖", "基坑", "土方"], ["回填"]] },
  { id: "t2", text: "오늘 데스라 몇 명인지 반장한테 보고하세요", slang: ["데스라"], expect: [["出勤", "出工", "上工", "到岗", "到场", "作业人数", "出面"]] },
  { id: "t3", text: "계단은 오도리바까지만 시아게 해 주세요", slang: ["오도리바", "시아게"], expect: [["平台"], ["收尾", "饰面", "收口", "抹面", "面层", "完工", "精加工", "装修"]] },
  { id: "t4", text: "자재가 없어서 오후는 전부 데마찌입니다", slang: ["데마찌"], expect: [["待工", "停工", "待命", "等待", "待料", "窝工"]] },
  { id: "t5", text: "야리가다 다시 확인하고 먹 놓으세요", slang: ["야리가다"], expect: [["龙门板", "基准", "定位桩", "控制桩", "水平桩", "龙门桩"]] },
  { id: "t6", text: "이거 아다라시로 바꿔 와", slang: ["아다라시"], expect: [["新"]] },
  { id: "t7", text: "타일은 이모메지로 붙이세요", slang: ["이모메지"], expect: [["通缝", "对缝", "直缝"]] },
  { id: "t8", text: "삼 층 슬래브에 사뽀도 더 세워", slang: ["사뽀도"], expect: [["支撑", "支柱", "顶撑", "立杆", "支顶"]], preloaded: true },
  { id: "t9", text: "빠루 좀 가져와", slang: ["빠루"], expect: [["撬"]], preloaded: true },
];

type Row = {
  mode: TurnTermsMode;
  id: string;
  text: string;
  original: string | null;
  translation: string;
  status: string;
  ok: boolean;
  /** 원문 자막(전사)에 은어가 그대로 받아써진 수 / 문장의 은어 수 (띄어쓰기 무시) */
  slangHeard: number;
  slangTotal: number;
  /** 마지막 말소리 조각을 보낸 뒤 → 번역 시작 / 첫 번역 음성 (ms) */
  turnStartMs: number | null;
  firstAudioMs: number | null;
  /** 턴 용어: update 는 말 끝 전에 보낸 것, create 는 말 끝에 넣은 것 */
  termsApplied: string;
  /** atMs: 말 끝 기준 (음수 = 말하는 도중) */
  termsEvents: { type: string; terms: string; partial: string; atMs: number }[];
};

function judge(c: Case, translation: string): boolean {
  return c.expect.every((group) => group.some((word) => translation.includes(word)));
}

async function prepare(c: Case): Promise<Int16Array> {
  const aiff = path.join(outDir, `turn-terms-${c.id}.aiff`);
  execFileSync("say", ["-v", "Yuna", "-o", aiff, c.text]);
  const decoded = await decodeToPcm(aiff, RATE);
  return new Int16Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const env = loadEnv();
  const dataset = await createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH).load();
  const domain = new DomainProcessor(dataset);
  const glossary = domain.streamGlossary("ko", TARGET);
  const preloaded = new Set([...(glossary.slang ?? []).map((s) => s.source), ...glossary.terms.map((t) => t.source)]);
  const findTurnTerms = (partial: string) => domain.buildContext(domain.process(partial, "ko"), TARGET).terms;

  const audio = new Map<string, Int16Array>();
  for (const c of CASES) {
    audio.set(c.id, await prepare(c));
    const inList = c.slang.map((s) => `${s}${preloaded.has(s) ? "(미리)" : ""}`).join(", ");
    console.log(`${c.id} ${(audio.get(c.id)!.length / RATE).toFixed(1)}초 "${c.text}" — 은어 ${inList} — 감지: ${findTurnTerms(c.text).map((t) => t.source).join(", ")}`);
  }
  const speechSeconds = [...audio.values()].reduce((sum, pcm) => sum + pcm.length / RATE, 0);
  console.log(`방식 ${MODES.join(", ")} × ${CASES.length}문장 = ${MODES.length * CASES.length}턴, 말 ${speechSeconds.toFixed(0)}초 × ${MODES.length}`);
  console.log(`예상 비용 약 $${(MODES.length * CASES.length * 0.012).toFixed(2)} (턴당 약 $0.01 + 전사), 이번 실행 상한 $${MAX_USD}`);
  if (DRY) return console.log("--dry-run: OpenAI 를 호출하지 않았습니다.");
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 가 없습니다.");

  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), buildPricingTable(env.OPENAI_PRICING_JSON), {
    limitUsd: env.OPENAI_BUDGET_USD,
    period: env.OPENAI_BUDGET_PERIOD,
  });
  const before = await budget.status();
  console.log(`한도 $${before.limitUsd}, 사용 $${before.spentUsd.toFixed(4)}, 남음 $${before.remainingUsd.toFixed(4)}`);
  const rows: Row[] = [];

  try {
    for (const mode of MODES) {
      const spent = (await budget.status()).spentUsd - before.spentUsd;
      if (spent >= MAX_USD) {
        console.log(`이번 실행 상한 $${MAX_USD} 도달 ($${spent.toFixed(4)}) — ${mode} 부터 멈춤`);
        break;
      }
      // 턴마다: 이벤트 시각·턴 용어 기록
      let current: { turnId: string | null; startAt: number | null; firstAudioAt: number | null; delta: string; resolve: (end: TurnEnd) => void } | null = null;
      const termsEvents: { type: string; terms: string; partial: string; at: number }[] = [];
      let speechEndAt = 0;
      const engine = new RealtimeStreamEngine({
        apiKey: env.OPENAI_API_KEY,
        model: env.TRANSLATION_MODEL,
        transcribeModel: env.STT_MODEL,
        streamTranscribeModel: env.STREAM_STT_MODEL,
        voice: env.TRANSLATION_VOICE,
        reasoning: env.TRANSLATION_REASONING,
        silenceMs: env.STREAM_VAD_SILENCE_MS,
        liveTranscription: true,
        turnTerms: mode,
        budget,
        log: (message, detail) => console.log(`  [엔진] ${message}`, detail ?? ""),
        trace: (_session, type, detail) => {
          if (type.startsWith("turnTerms.")) {
            termsEvents.push({ type, terms: String(detail.terms ?? ""), partial: String(detail.partial ?? ""), at: now() });
          }
        },
      });
      let connection: StreamConnection;
      try {
        connection = await engine.open({
          sourceLang: "ko",
          targetLang: TARGET,
          glossary,
          turnTerms: findTurnTerms,
          events: {
            turnStart: (turnId) => {
              if (current && current.turnId === null) {
                current.turnId = turnId;
                current.startAt = now();
              }
            },
            audio: (turnId) => {
              if (current?.turnId === turnId && current.firstAudioAt === null) current.firstAudioAt = now();
            },
            translationDelta: (turnId, text) => {
              if (current?.turnId === turnId) current.delta += text;
            },
            originalDelta: () => undefined,
            original: () => undefined,
            turnEnd: (turnId, result) => {
              if (current?.turnId === turnId) current.resolve(result);
            },
            closed: (reason) => console.log(`  [엔진] 연결 끝남: ${reason}`),
          },
        });
      } catch (error) {
        console.log(`${mode}: 세션 열기 실패 — ${(error as Error).message}`);
        continue;
      }
      console.log(`\n=== ${mode} ===`);
      const history: ContextLine[] = [];
      for (const c of CASES) {
        const pcm = audio.get(c.id)!;
        termsEvents.length = 0;
        const done = new Promise<TurnEnd>((resolve) => {
          current = { turnId: null, startAt: null, firstAudioAt: null, delta: "", resolve };
        });
        // 실시간 속도로 말소리 → 무음
        const frames = Math.ceil(pcm.length / FRAME_SAMPLES);
        const silenceFrames = TRAILING_SILENCE_MS / FRAME_MS;
        const t0 = now();
        for (let i = 0; i < frames + silenceFrames; i += 1) {
          const frame = new Int16Array(FRAME_SAMPLES);
          if (i < frames) frame.set(pcm.subarray(i * FRAME_SAMPLES, (i + 1) * FRAME_SAMPLES));
          connection.append(Buffer.from(frame.buffer));
          if (i === frames - 1) speechEndAt = now();
          const next = t0 + (i + 1) * FRAME_MS;
          await wait(Math.max(0, next - now()));
        }
        const result = await Promise.race([done, wait(TURN_TIMEOUT_MS).then(() => null)]);
        const turn = current!;
        const translation = result?.status === "done" ? result.translation : turn.delta;
        const original = result?.status === "done" ? result.original : null;
        // update 는 번역 시작(response.created) 전에 보낸 것만 반영된 것으로 본다
        const startAt = turn.startAt ?? Infinity;
        const applied = termsEvents.filter((e) => (mode === "update" ? e.type === "turnTerms.update" && e.at < startAt : e.type === "turnTerms.create"));
        const row: Row = {
          mode,
          id: c.id,
          text: c.text,
          original,
          translation,
          status: result?.status ?? "timeout",
          ok: judge(c, translation),
          slangHeard: c.slang.filter((s) => (original ?? "").replace(/\s+/g, "").includes(s)).length,
          slangTotal: c.slang.length,
          turnStartMs: turn.startAt ? Math.round(turn.startAt - speechEndAt) : null,
          firstAudioMs: turn.firstAudioAt ? Math.round(turn.firstAudioAt - speechEndAt) : null,
          termsApplied: applied.at(-1)?.terms ?? "",
          termsEvents: termsEvents.map(({ at, ...rest }) => ({ ...rest, atMs: Math.round(at - speechEndAt) })),
        };
        rows.push(row);
        console.log(
          `${c.id} ${row.ok ? "맞음" : "틀림"} 자막 은어 ${row.slangHeard}/${row.slangTotal} 첫음성 ${row.firstAudioMs ?? "-"}ms 용어[${row.termsApplied}] 원문 "${original ?? ""}" → "${translation}"`,
        );
        if (original && result?.status === "done") {
          history.push({ original, translation });
          connection.setContext(history.slice(-2));
        }
        await wait(500);
      }
      connection.close();
    }
  } finally {
    const after = await budget.status();
    console.log(`\n이번 실행 비용 $${(after.spentUsd - before.spentUsd).toFixed(4)}, 누적 $${after.spentUsd.toFixed(4)}`);
    const file = path.join(outDir, `turn-terms-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ target: TARGET, modes: MODES, cost: after.spentUsd - before.spentUsd, rows }, null, 2));
    console.log(`결과: ${file}`);
    // 요약: 방식별 맞음 수 (미리 넣는 용어집 밖 / 안), 첫 음성 지연 중앙값
    for (const mode of MODES) {
      const own = rows.filter((r) => r.mode === mode);
      if (own.length === 0) continue;
      const outside = own.filter((r) => !CASES.find((c) => c.id === r.id)!.preloaded);
      const inside = own.filter((r) => CASES.find((c) => c.id === r.id)!.preloaded);
      const delays = own.map((r) => r.firstAudioMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
      const median = delays.length ? delays[Math.floor(delays.length / 2)] : null;
      const heard = own.reduce((n, r) => n + r.slangHeard, 0);
      const total = own.reduce((n, r) => n + r.slangTotal, 0);
      console.log(
        `${mode}: 목록 밖 은어 ${outside.filter((r) => r.ok).length}/${outside.length}, 목록 안 ${inside.filter((r) => r.ok).length}/${inside.length}, 자막 은어 ${heard}/${total}, 첫 음성 중앙값 ${median ?? "-"}ms`,
      );
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
