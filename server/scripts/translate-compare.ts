// 번역 전용 모델(gpt-realtime-translate) 측정 — 지금 스트리밍(gpt-realtime-2.1, S0 측정)과 비교하기 위한 것.
// S0(stream-measure.ts)과 같은 macOS 합성 음성 문장을 실시간 속도로 흘려 보내고, 모든 이벤트 시각을 기록한다.
//   - 세션 1개 = 출력 언어 1개 (/v1/realtime/translations). 지시문·용어집은 넣을 수 없다 (모델 제약)
//   - 동시통역이라 "턴"이 없다 → 문장 사이에 무음 3초를 두고, 출력은 시각 기준으로 가장 최근 문장에 붙인다
//   - 비용: 음성 길이 기준 $0.034/분 (공식). 보낸 음성(무음 포함) 길이로 계산해 openai_usage 에 기록한다
//     (BudgetGuard 는 토큰 단가표를 쓰므로, 이 모델은 "1토큰 = 1ms" 로 단가를 맞춰 기록 — 아래 PRICE_PER_MS)
//     입력 받아쓰기(gpt-realtime-whisper) 단가는 공개 자료에서 확인하지 못해 gpt-4o-mini-transcribe 단가로 추정 기록
// 사용: npx tsx scripts/translate-compare.ts --dry-run   (비용 0: 음성 준비·계획·예상 비용)
//       npx tsx scripts/translate-compare.ts [--max-usd 0.06]  (실행 전 npm run db:start)
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { loadEnv } from "../src/config/env";
import type { Lang } from "../src/shared/languages";
import { decodeToPcm, encodeWav } from "../src/engine/audio/codec";
import { BudgetGuard } from "../src/engine/budget/budgetGuard";
import { buildPricingTable, estimateCostUsd } from "../src/engine/budget/pricing";
import { PrismaUsageStore } from "../src/engine/budget/prismaUsageStore";
import { DomainProcessor } from "../src/engine/domain/domainProcessor";
import { RealtimeTranslator } from "../src/engine/translation/realtimeTranslator";
import { createPrismaClient } from "../src/lib/prisma";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";

const MODEL = "gpt-realtime-translate";
const URL = `wss://api.openai.com/v1/realtime/translations?model=${MODEL}`;
const RATE = 24_000;
const FRAME_MS = 100;
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;
const GAP_MS = 3_000; // 문장 사이 무음
const TAIL_MS = 5_000; // 마지막 문장 뒤 무음 (출력이 끝날 때까지 최대)
const USD_PER_MIN = 0.034;
/** BudgetGuard 단가표용: 1토큰 = 1ms 로 보고 $/1M토큰 = $0.034/분 */
const PRICE_PER_MS = (USD_PER_MIN / 60_000) * 1_000_000;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes("--dry-run");
const MAX_USD = Number(arg("--max-usd") ?? "0.06");
const outDir = path.resolve(arg("--out") ?? "translate-compare-output");

type Clip = { id: string; lang: Lang; voice: string | null; text: string; trap?: boolean };
// S0 와 같은 문장 (stream-measure.ts). uz1 은 macOS 음성이 없어 gpt-realtime-2.1 로 만든 우즈베크어 음성
const KO: Clip[] = [
  { id: "ko1", lang: "ko", voice: "Yuna", text: "안전모 착용하고 2번 프레스 기계 비상정지 버튼을 확인하세요." },
  { id: "ko2", lang: "ko", voice: "Yuna", text: "자재는 B문으로 들이고 지게차 동선을 비워 두세요." },
  { id: "ko3", lang: "ko", voice: "Yuna", text: "오후 3시까지 3층 거푸집 해체를 끝내세요." },
  { id: "ko4", lang: "ko", voice: "Yuna", text: "비계 위에서는 안전고리를 꼭 거세요." },
  { id: "trap1", lang: "ko", voice: "Yuna", text: "오늘 작업은 몇 시에 끝나요?", trap: true },
];
const TO_KO: Clip[] = [
  { id: "vi1", lang: "vi", voice: "Linh", text: "Tôi đã kiểm tra nút dừng khẩn cấp, máy số hai vẫn bình thường." },
  { id: "zh1", lang: "zh", voice: "Tingting", text: "三楼的模板已经拆完了，下一步做什么？", trap: true },
  { id: "ru1", lang: "ru", voice: "Milena", text: "У меня закончились перчатки, где взять новые?", trap: true },
  { id: "uz1", lang: "uz", voice: null, text: "(오후 3시까지 3층 거푸집 해체를 끝내세요 → 우즈베크어 음성)" },
];
const PLANS: { id: string; target: Lang; clips: Clip[] }[] = [
  { id: "T1", target: "vi", clips: KO },
  { id: "T2", target: "ko", clips: TO_KO },
];

function trimSilence(pcm: Int16Array): Int16Array {
  const loud = (frame: number) => {
    let peak = 0;
    for (let i = frame * FRAME_SAMPLES; i < Math.min(pcm.length, (frame + 1) * FRAME_SAMPLES); i++) peak = Math.max(peak, Math.abs(pcm[i] ?? 0));
    return peak > 328;
  };
  const frames = Math.ceil(pcm.length / FRAME_SAMPLES);
  let first = 0;
  while (first < frames && !loud(first)) first++;
  let last = frames - 1;
  while (last > first && !loud(last)) last--;
  return pcm.subarray(first * FRAME_SAMPLES, Math.min(pcm.length, (last + 1) * FRAME_SAMPLES));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = loadEnv();
  mkdirSync(outDir, { recursive: true });
  const pricing = { ...buildPricingTable(env.OPENAI_PRICING_JSON), [MODEL]: { inputText: 0, outputText: 0, inputAudio: PRICE_PER_MS, outputAudio: 0, cachedInput: 0 } };
  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), pricing, { limitUsd: env.OPENAI_BUDGET_USD, period: env.OPENAI_BUDGET_PERIOD });

  // ─── 음성 준비 ───
  const audio = new Map<string, Int16Array>();
  let uzCost = 0;
  for (const clip of [...KO, ...TO_KO]) {
    const wav = path.join(outDir, `${clip.id}.wav`);
    if (clip.voice) {
      const aiff = path.join(outDir, `${clip.id}.aiff`);
      execFileSync("say", ["-v", clip.voice, "-o", aiff, clip.text]);
      const decoded = await decodeToPcm(aiff, RATE);
      audio.set(clip.id, trimSilence(decoded.data));
    } else if (existsSync(wav)) {
      audio.set(clip.id, trimSilence((await decodeToPcm(wav, RATE)).data));
    } else if (!DRY) {
      // 우즈베크어 음성 만들기 (gpt-realtime-2.1, 텍스트 → 우즈베크어 음성 1회)
      const domain = new DomainProcessor(await createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH).load());
      const translator = new RealtimeTranslator({ apiKey: env.OPENAI_API_KEY!, model: env.TRANSLATION_MODEL, voice: env.TRANSLATION_VOICE, reasoning: env.TRANSLATION_REASONING, budget });
      const source = "오후 3시까지 3층 거푸집 해체를 끝내세요.";
      const out = await translator.translate({ text: source, sourceLang: "ko", targetLang: "uz", context: domain.buildContext(domain.process(source, "ko"), "uz"), withAudio: true });
      uzCost = estimateCostUsd(pricing, out.model, out.usage);
      clip.text = out.text;
      const pcm = new Int16Array(out.audio!.data.buffer, out.audio!.data.byteOffset, out.audio!.data.length / 2);
      writeFileSync(wav, encodeWav(pcm, out.audio!.sampleRate));
      audio.set(clip.id, trimSilence((await decodeToPcm(wav, RATE)).data));
      console.log(`우즈베크어 음성 생성: "${out.text}" ($${uzCost.toFixed(4)})`);
    }
  }

  // ─── 계획·예상 비용 ───
  const planSeconds = PLANS.map((p) => p.clips.reduce((s, c) => s + (audio.get(c.id)?.length ?? RATE * 3.5) / RATE + GAP_MS / 1000, 0) + TAIL_MS / 1000);
  const totalSeconds = planSeconds.reduce((a, b) => a + b, 0);
  const estimate = (totalSeconds / 60) * USD_PER_MIN + (totalSeconds / 60) * 0.003 + 0.007;
  console.log(`계획: ${PLANS.map((p, i) => `${p.id} →${p.target} ${p.clips.length}문장 ${planSeconds[i]!.toFixed(0)}초`).join(", ")}`);
  console.log(`보낼 음성(무음 포함) 약 ${totalSeconds.toFixed(0)}초 → 예상 약 $${estimate.toFixed(3)} (번역 $0.034/분 + 받아쓰기 추정 + 우즈베크어 음성 생성)`);
  if (DRY) {
    console.log("--dry-run: OpenAI 를 호출하지 않았습니다.");
    await prisma.$disconnect();
    return;
  }
  if (estimate > MAX_USD) throw new Error(`예상 비용 $${estimate.toFixed(3)} 이 상한 $${MAX_USD} 를 넘습니다.`);
  const before = await budget.status();
  console.log(`한도 $${before.limitUsd}, 사용 $${before.spentUsd.toFixed(4)}`);

  const rows: Record<string, unknown>[] = [];
  const eventLog: { plan: string; t: number; type: string; detail?: string }[] = [];

  for (const plan of PLANS) {
    const reservation = await budget.reserve(budget.estimate(MODEL, { inputAudioTokens: Math.ceil(planSeconds[PLANS.indexOf(plan)]! * 1000) }));
    const ws = new WebSocket(URL, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
    const t0 = performance.now();
    const now = () => Math.round(performance.now() - t0);
    const outputs: { t: number; kind: "audio" | "text" | "source"; text?: string; bytes?: number }[] = [];
    const types = new Map<string, number>();
    let closed: string | null = null;
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString()) as { type: string; delta?: string; error?: { message?: string } ; [k: string]: unknown };
      types.set(e.type, (types.get(e.type) ?? 0) + 1);
      const t = now();
      if (e.type === "session.output_audio.delta") outputs.push({ t, kind: "audio", bytes: Buffer.from(String(e.delta ?? ""), "base64").length });
      else if (e.type === "session.output_transcript.delta") outputs.push({ t, kind: "text", text: String(e.delta ?? "") });
      else if (e.type === "session.input_transcript.delta") outputs.push({ t, kind: "source", text: String(e.delta ?? "") });
      else eventLog.push({ plan: plan.id, t, type: e.type, detail: JSON.stringify(e).slice(0, 300) });
      if (e.type === "error") console.log(`  [${plan.id}] 오류: ${e.error?.message}`);
    });
    ws.on("close", (code) => (closed = `code ${code}`));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.send(JSON.stringify({
      type: "session.update",
      session: { audio: { input: { transcription: { model: "gpt-realtime-whisper" }, noise_reduction: { type: "near_field" } }, output: { language: plan.target } } },
    }));
    await sleep(800);

    // 실시간 속도로: 문장 → 무음 3초 → 다음 문장 … → 무음 (출력이 2초간 없으면 일찍 끝)
    const silence = Buffer.alloc(FRAME_SAMPLES * 2);
    const marks: { id: string; start: number; end: number }[] = [];
    const frames: { buf: Buffer; clip?: string; last?: boolean }[] = [];
    for (const clip of plan.clips) {
      const pcm = audio.get(clip.id)!;
      const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const count = Math.ceil(buf.length / (FRAME_SAMPLES * 2));
      for (let i = 0; i < count; i++) frames.push({ buf: buf.subarray(i * FRAME_SAMPLES * 2, (i + 1) * FRAME_SAMPLES * 2), clip: clip.id, last: i === count - 1 });
      for (let i = 0; i < GAP_MS / FRAME_MS; i++) frames.push({ buf: silence });
    }
    for (let i = 0; i < TAIL_MS / FRAME_MS; i++) frames.push({ buf: silence });
    const start = performance.now();
    let sentMs = 0;
    for (const [i, frame] of frames.entries()) {
      const due = start + i * FRAME_MS;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      if (closed) break;
      if (frame.clip && !marks.find((m) => m.id === frame.clip)) marks.push({ id: frame.clip, start: now(), end: 0 });
      ws.send(JSON.stringify({ type: "session.input_audio_buffer.append", audio: frame.buf.toString("base64") }));
      sentMs += FRAME_MS;
      if (frame.last) marks.find((m) => m.id === frame.clip)!.end = now();
      // 꼬리 무음 구간에서 출력이 2초 넘게 없으면 끝
      const inTail = i >= frames.length - TAIL_MS / FRAME_MS;
      const lastOut = outputs.at(-1)?.t ?? 0;
      if (inTail && now() - lastOut > 2_000 && i > frames.length - TAIL_MS / FRAME_MS + 20) break;
    }
    await sleep(500);
    ws.close();
    await budget.commit(reservation, { inputAudioTokens: sentMs, kind: "translate", model: MODEL });
    const sttReservation = await budget.reserve(budget.estimate("gpt-4o-mini-transcribe", { inputAudioTokens: Math.ceil((sentMs / 1000) * 40) }));
    await budget.commit(sttReservation, { inputAudioTokens: Math.ceil((sentMs / 1000) * 40), kind: "stt", model: "gpt-4o-mini-transcribe" });

    // 출력 → 문장 배정: 그 문장 시작 이후 ~ 다음 문장 시작 전 (마지막은 끝까지)
    for (const [index, mark] of marks.entries()) {
      const next = marks[index + 1]?.start ?? Infinity;
      const mine = outputs.filter((o) => o.t >= mark.start && o.t < next);
      const audioOut = mine.filter((o) => o.kind === "audio");
      const clip = plan.clips.find((c) => c.id === mark.id)!;
      const row = {
        plan: plan.id,
        target: plan.target,
        clip: clip.id,
        trap: !!clip.trap,
        source: clip.text,
        speechSeconds: Number(((mark.end - mark.start) / 1000).toFixed(2)),
        firstAudioFromSpeechStartMs: audioOut[0] ? audioOut[0].t - mark.start : null,
        firstAudioFromSpeechEndMs: audioOut[0] ? audioOut[0].t - mark.end : null,
        lastAudioFromSpeechEndMs: audioOut.at(-1) ? audioOut.at(-1)!.t - mark.end : null,
        outputAudioSeconds: Number((audioOut.reduce((s, o) => s + (o.bytes ?? 0), 0) / 2 / RATE).toFixed(2)),
        translation: mine.filter((o) => o.kind === "text").map((o) => o.text).join("").trim(),
        sourceTranscript: mine.filter((o) => o.kind === "source").map((o) => o.text).join("").trim(),
      };
      rows.push(row);
      console.log(`  ${plan.id} ${clip.id}${clip.trap ? "(함정)" : ""} →${plan.target}: 말 ${row.speechSeconds}s, 첫 소리 말 시작+${row.firstAudioFromSpeechStartMs}ms / 말 끝${row.firstAudioFromSpeechEndMs! >= 0 ? "+" : ""}${row.firstAudioFromSpeechEndMs}ms, 마지막 소리 말 끝+${row.lastAudioFromSpeechEndMs}ms`);
      console.log(`     번역: ${row.translation}`);
      console.log(`     원문 받아쓰기: ${row.sourceTranscript}`);
    }
    console.log(`  [${plan.id}] 보낸 음성 ${(sentMs / 1000).toFixed(1)}초, 이벤트: ${JSON.stringify(Object.fromEntries(types))}${closed ? `, 연결 ${closed}` : ""}`);
  }

  const after = await budget.status();
  console.log(`\n이번 실행 기록 비용 $${(after.spentUsd - before.spentUsd).toFixed(4)} (우즈베크어 음성 생성 포함), 누적 $${after.spentUsd.toFixed(4)} / 한도 $${after.limitUsd}`);
  writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ model: MODEL, rows, eventLog }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
