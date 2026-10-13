// Phase 7 S0 ①: OpenAI Realtime 스트리밍 통역 측정 (docs/streaming-plan.md 7절).
// 미리 만든 음성(macOS say)을 100ms 조각으로 "실시간 속도"로 흘려 보내고, 통화처럼 세션을 열어 둔 채 여러 턴을 측정한다.
//   - 말 끝(마지막 말소리 조각 전송) → OpenAI 말 끝 감지 / 첫 번역 음성 조각 / 첫 번역 자막 시간
//   - server_vad vs semantic_vad, 입력 음성 토큰/초, 컨텍스트 정리 유무에 따른 턴당 입력 토큰 증가
//   - 질문 문장을 번역하지 않고 답해 버리는지 (함정 문장)
// 모든 호출은 서버와 같은 BudgetGuard(openai_usage, OPENAI_BUDGET_USD)를 거치고, 이번 실행 상한(--max-usd)을 넘기 전에 멈춘다.
// 사용: npx tsx scripts/stream-measure.ts --dry-run          (비용 0: 음성 준비·계획·예상 비용만)
//       npx tsx scripts/stream-measure.ts [--max-usd 0.2] [--only S1,S4a]   (실제 호출, 실행 전 npm run db:start)
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { loadEnv } from "../src/config/env";
import type { Lang } from "../src/shared/languages";
import { decodeToPcm, encodeWav } from "../src/engine/audio/codec";
import { BudgetGuard } from "../src/engine/budget/budgetGuard";
import { buildPricingTable, estimateCostUsd, type UsageTokens } from "../src/engine/budget/pricing";
import { PrismaUsageStore } from "../src/engine/budget/prismaUsageStore";
import { DomainProcessor, type TranslationContext } from "../src/engine/domain/domainProcessor";
import { buildInstructions } from "../src/engine/translation/realtimeTranslator";
import { createPrismaClient } from "../src/lib/prisma";
import { createDatasetAdapter } from "../src/plugins/datasetAdapter";

const RATE = 24_000; // Realtime 입력·출력 PCM16 24kHz
const FRAME_MS = 100;
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;
const TURN_TIMEOUT_MS = 15_000;
const SETTLE_MS = 1_500; // 마지막 응답 뒤 이만큼 더 기다려 추가 응답(문장 쪼개짐)이 없는지 본다

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const DRY = process.argv.includes("--dry-run");
const MAX_USD = Number(arg("--max-usd") ?? "0.2");
const ONLY = arg("--only")?.split(",");
const outDir = path.resolve(arg("--out") ?? "stream-measure-output");

type Utterance = { id: string; lang: Lang; voice: string; text: string; trap?: boolean };
type Vad = { type: "server_vad"; silence_duration_ms: number; prefix_padding_ms: number; threshold: number } | { type: "semantic_vad"; eagerness: "auto" | "low" | "medium" | "high" };
type Plan = { id: string; source: Lang; target: Lang; vad: Vad; prune: boolean; turns: Utterance[]; note: string };

const KO: Utterance[] = [
  { id: "ko1", lang: "ko", voice: "Yuna", text: "안전모 착용하고 2번 프레스 기계 비상정지 버튼을 확인하세요." },
  { id: "ko2", lang: "ko", voice: "Yuna", text: "자재는 B문으로 들이고 지게차 동선을 비워 두세요." },
  { id: "ko3", lang: "ko", voice: "Yuna", text: "오후 3시까지 3층 거푸집 해체를 끝내세요." },
  { id: "ko4", lang: "ko", voice: "Yuna", text: "비계 위에서는 안전고리를 꼭 거세요." },
];
const TRAP_1: Utterance = { id: "trap1", lang: "ko", voice: "Yuna", text: "오늘 작업은 몇 시에 끝나요?", trap: true };
const TRAP_2: Utterance = { id: "trap2", lang: "ko", voice: "Yuna", text: "이거 어떻게 하는 거예요? 방법 좀 알려 주세요.", trap: true };
const VI: Utterance = { id: "vi1", lang: "vi", voice: "Linh", text: "Tôi đã kiểm tra nút dừng khẩn cấp, máy số hai vẫn bình thường." };
const ZH: Utterance = { id: "zh1", lang: "zh", voice: "Tingting", text: "三楼的模板已经拆完了，下一步做什么？", trap: true };
const RU: Utterance = { id: "ru1", lang: "ru", voice: "Milena", text: "У меня закончились перчатки, где взять новые?", trap: true };

const SERVER_VAD: Vad = { type: "server_vad", silence_duration_ms: 500, prefix_padding_ms: 300, threshold: 0.5 };
const SEMANTIC_VAD: Vad = { type: "semantic_vad", eagerness: "auto" };

const ALL_PLANS: Plan[] = [
  { id: "S1", source: "ko", target: "vi", vad: SERVER_VAD, prune: true, turns: [...KO, TRAP_1], note: "server_vad 500ms, 컨텍스트 정리" },
  { id: "S2", source: "ko", target: "vi", vad: SEMANTIC_VAD, prune: true, turns: [...KO, TRAP_2], note: "semantic_vad auto, 컨텍스트 정리" },
  { id: "S3", source: "ko", target: "vi", vad: SERVER_VAD, prune: false, turns: KO.slice(0, 3), note: "server_vad, 컨텍스트 정리 안 함 (입력 토큰 증가 측정)" },
  // S2가 ko3에서 끊긴 뒤(2026-10-13 1차 측정) semantic_vad 나머지 턴만 다시 재는 세션
  { id: "S2b", source: "ko", target: "vi", vad: SEMANTIC_VAD, prune: true, turns: [KO[2]!, KO[3]!, TRAP_2], note: "semantic_vad auto, S2 재측정 (ko3·ko4·함정2)" },
  { id: "S4a", source: "vi", target: "ko", vad: SERVER_VAD, prune: true, turns: [VI], note: "작업자 → 한국어" },
  { id: "S4b", source: "zh", target: "ko", vad: SERVER_VAD, prune: true, turns: [ZH], note: "작업자 → 한국어 (질문 문장)" },
  { id: "S4c", source: "ru", target: "ko", vad: SERVER_VAD, prune: true, turns: [RU], note: "작업자 → 한국어 (질문 문장)" },
];
// 기본 실행은 S2b 제외 (S2와 같은 문장). 필요할 때 --only S2b
const PLANS = ALL_PLANS.filter((plan) => (ONLY ? ONLY.includes(plan.id) : plan.id !== "S2b"));

// ─── 음성 준비 ───────────────────────────────────────

type Prepared = { pcm: Int16Array; speechSeconds: number };

/** 앞뒤 무음(최대 진폭 -40dBFS 미만 프레임)을 잘라 말소리 구간만 남긴다 */
function trimSilence(pcm: Int16Array): Int16Array {
  const loud = (frame: number) => {
    let peak = 0;
    for (let i = frame * FRAME_SAMPLES; i < Math.min(pcm.length, (frame + 1) * FRAME_SAMPLES); i += 1) peak = Math.max(peak, Math.abs(pcm[i] ?? 0));
    return peak > 328; // 32768 × 10^(-40/20)
  };
  const frames = Math.ceil(pcm.length / FRAME_SAMPLES);
  let first = 0;
  while (first < frames && !loud(first)) first += 1;
  let last = frames - 1;
  while (last > first && !loud(last)) last -= 1;
  return pcm.subarray(first * FRAME_SAMPLES, Math.min(pcm.length, (last + 1) * FRAME_SAMPLES));
}

async function prepare(u: Utterance): Promise<Prepared> {
  const aiff = path.join(outDir, `${u.id}.aiff`);
  execFileSync("say", ["-v", u.voice, "-o", aiff, u.text]);
  const decoded = await decodeToPcm(aiff, RATE);
  const pcm = trimSilence(new Int16Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length));
  writeFileSync(path.join(outDir, `${u.id}.wav`), encodeWav(pcm, RATE));
  return { pcm, speechSeconds: pcm.length / RATE };
}

// ─── 비용 추정 ───────────────────────────────────────

/** 턴 1개 예상 사용량 (여유 있게): 지시문 글자/2 토큰, 입력 음성 10토큰/초(+패딩), 출력 음성 20토큰/초 × 원문 길이의 1.5배 */
function turnEstimate(instructionsChars: number, speechSeconds: number, contextTurns: number): UsageTokens {
  const inputAudio = Math.ceil((speechSeconds + 1) * 10);
  const outputAudio = Math.ceil(speechSeconds * 1.5 * 20) + 40;
  return {
    inputTextTokens: Math.ceil(instructionsChars / 2) + 50,
    inputAudioTokens: inputAudio + contextTurns * (inputAudio + outputAudio),
    outputTextTokens: 150,
    outputAudioTokens: outputAudio,
  };
}
const transcribeEstimate = (speechSeconds: number): UsageTokens => ({ inputAudioTokens: Math.ceil((speechSeconds + 1) * 40), outputTextTokens: 60 });

// ─── 측정 ───────────────────────────────────────────

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};
type ServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  audio_start_ms?: number;
  audio_end_ms?: number;
  item?: { id?: string; role?: string };
  error?: { message?: string; code?: string };
  usage?: { type?: string; input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number; text_tokens?: number }; seconds?: number };
  response?: { id?: string; status?: string; status_details?: unknown; usage?: Usage };
};

const toTokens = (usage: Usage | undefined): UsageTokens => {
  const cached = usage?.input_token_details?.cached_tokens ?? 0;
  const cachedAudio = usage?.input_token_details?.cached_tokens_details?.audio_tokens ?? 0;
  const cachedText = cached - cachedAudio;
  const outputAudio = usage?.output_token_details?.audio_tokens ?? 0;
  return {
    inputTextTokens: Math.max(0, (usage?.input_token_details?.text_tokens ?? 0) - Math.max(0, cachedText)),
    inputAudioTokens: Math.max(0, (usage?.input_token_details?.audio_tokens ?? 0) - cachedAudio),
    cachedInputTokens: cached,
    outputTextTokens: Math.max(usage?.output_token_details?.text_tokens ?? 0, (usage?.output_tokens ?? 0) - outputAudio),
    outputAudioTokens: outputAudio,
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values: number[]) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

async function main() {
  const env = loadEnv();
  mkdirSync(outDir, { recursive: true });
  const pricing = buildPricingTable(env.OPENAI_PRICING_JSON);
  const model = env.TRANSLATION_MODEL;
  const usd = (m: string, usage: UsageTokens) => estimateCostUsd(pricing, m, usage);

  const domain = new DomainProcessor(await createDatasetAdapter(env.DATASET_ADAPTER, env.DATASET_PATH).load());
  // 세션 시작 때 용어집을 지시문에 미리 넣는다 (계획 D3): 이 세션에서 쓸 문장들에서 감지한 용어의 합집합
  const instructionsFor = (plan: Plan) => {
    const terms = new Map<string, TranslationContext["terms"][number]>();
    for (const turn of plan.turns) {
      for (const term of domain.buildContext(domain.process(turn.text, plan.source), plan.target).terms) terms.set(term.source, term);
    }
    return buildInstructions(plan.source, plan.target, { terms: [...terms.values()] });
  };

  const prepared = new Map<string, Prepared>();
  for (const plan of PLANS) for (const turn of plan.turns) if (!prepared.has(turn.id)) prepared.set(turn.id, await prepare(turn));

  // 계획·예상 비용
  let planned = 0;
  console.log(`모델 ${model}, 음성 ${env.TRANSLATION_VOICE}, 전사 ${env.STT_MODEL}, 이번 실행 상한 $${MAX_USD}`);
  for (const plan of PLANS) {
    const chars = instructionsFor(plan).length;
    const cost = plan.turns.reduce((sum, turn, index) => {
      const seconds = prepared.get(turn.id)!.speechSeconds;
      const context = plan.prune ? Math.min(index, 1) : index;
      return sum + usd(model, turnEstimate(chars, seconds, context)) + usd(env.STT_MODEL, transcribeEstimate(seconds));
    }, 0);
    planned += cost;
    const secs = plan.turns.map((t) => prepared.get(t.id)!.speechSeconds.toFixed(1)).join("/");
    console.log(`  ${plan.id} ${plan.source}→${plan.target} ${plan.note}: ${plan.turns.length}턴 (말 ${secs}초), 지시문 ${chars}자, 예상 ≤ $${cost.toFixed(3)}`);
  }
  const turnsTotal = PLANS.reduce((n, p) => n + p.turns.length, 0);
  console.log(`합계 ${turnsTotal}턴, 예상 비용 상한 약 $${planned.toFixed(3)} (여유 있게 잡은 값)`);
  if (DRY) {
    console.log(`--dry-run: OpenAI를 호출하지 않았습니다. 음성 파일: ${outDir}`);
    return;
  }
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 없습니다.");

  const prisma = createPrismaClient(env.DATABASE_URL);
  const budget = new BudgetGuard(new PrismaUsageStore(prisma), pricing, { limitUsd: env.OPENAI_BUDGET_USD, period: env.OPENAI_BUDGET_PERIOD });
  const before = await budget.status();
  console.log(`한도 $${before.limitUsd} (${before.period}), 사용 $${before.spentUsd.toFixed(4)}, 남음 $${before.remainingUsd.toFixed(4)}`);
  let runSpent = 0;
  const rows: Record<string, unknown>[] = [];

  try {
    for (const plan of PLANS) {
      const instructions = instructionsFor(plan);
      const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      });
      const listeners = new Set<(event: ServerEvent, at: number) => void>();
      const eventCounts = new Map<string, number>();
      let closed: string | null = null;
      ws.on("close", (code, reason) => {
        closed = `code ${code} ${reason.toString()}`.trim();
        console.log(`  [${plan.id}] 연결 종료: ${closed}`);
      });
      ws.on("message", (raw) => {
        const at = performance.now();
        let event: ServerEvent;
        try {
          event = JSON.parse(raw.toString()) as ServerEvent;
        } catch {
          return;
        }
        eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
        if (event.type === "error") console.log(`  [${plan.id}] 오류: ${event.error?.code ?? ""} ${event.error?.message ?? ""}`);
        listeners.forEach((listener) => listener(event, at));
      });
      const waitFor = (type: string, timeoutMs = 10_000) =>
        new Promise<ServerEvent>((resolve, reject) => {
          const timer = setTimeout(() => {
            listeners.delete(listener);
            reject(new Error(`${type} 시간 초과`));
          }, timeoutMs);
          const listener = (event: ServerEvent) => {
            if (event.type !== type) return;
            clearTimeout(timer);
            listeners.delete(listener);
            resolve(event);
          };
          listeners.add(listener);
        });
      const send = (event: object) => ws.send(JSON.stringify(event));
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
        ws.once("unexpected-response", (_req, res) => reject(new Error(`Realtime 연결 실패: HTTP ${res.statusCode}`)));
      });
      const updated = waitFor("session.updated");
      send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions,
          output_modalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate: RATE },
              transcription: { model: env.STT_MODEL, language: plan.source },
              turn_detection: { ...plan.vad, create_response: true, interrupt_response: false },
            },
            output: { format: { type: "audio/pcm", rate: RATE }, voice: env.TRANSLATION_VOICE },
          },
          reasoning: { effort: env.TRANSLATION_REASONING },
        },
      });
      await updated;
      console.log(`\n${plan.id} ${plan.source}→${plan.target} (${plan.note})`);

      // 대화 항목 순서 (컨텍스트 정리용)
      const items: string[] = [];
      listeners.add((event) => {
        if ((event.type === "conversation.item.added" || event.type === "conversation.item.created") && event.item?.id && !items.includes(event.item.id)) items.push(event.item.id);
      });

      for (const [index, turn] of plan.turns.entries()) {
        const audio = prepared.get(turn.id)!;
        const contextTurns = plan.prune ? Math.min(index, 1) : index;
        const estimate = usd(model, turnEstimate(instructions.length, audio.speechSeconds, contextTurns));
        const sttEstimate = usd(env.STT_MODEL, transcribeEstimate(audio.speechSeconds));
        if (runSpent + estimate + sttEstimate > MAX_USD) {
          console.log(`  이번 실행 상한($${MAX_USD})에 닿아 멈춥니다. (사용 $${runSpent.toFixed(4)})`);
          throw new Error("RUN_LIMIT");
        }
        const reservation = await budget.reserve(estimate);
        const sttReservation = await budget.reserve(sttEstimate);

        const t: Record<string, number> = {};
        const responses: { usage?: Usage; status?: string }[] = [];
        let transcript = "";
        let inputTranscript = "";
        let sttUsage: ServerEvent["usage"];
        let outputBytes = 0;
        let speechStoppedAudioMs: number | undefined;
        let speechStartedAudioMs: number | undefined;
        let lastDone = 0;
        let created = 0;
        const listener = (event: ServerEvent, at: number) => {
          switch (event.type) {
            case "input_audio_buffer.speech_started":
              t.speechStarted ??= at;
              speechStartedAudioMs ??= event.audio_start_ms;
              break;
            case "input_audio_buffer.speech_stopped":
              t.speechStopped ??= at;
              speechStoppedAudioMs ??= event.audio_end_ms;
              break;
            case "response.created":
              t.responseCreated ??= at;
              created += 1;
              break;
            case "response.output_audio.delta":
              t.firstAudio ??= at;
              outputBytes += Buffer.from(event.delta ?? "", "base64").length;
              break;
            case "response.output_audio_transcript.delta":
              t.firstText ??= at;
              transcript += event.delta ?? "";
              break;
            case "conversation.item.input_audio_transcription.completed":
              t.inputTranscript ??= at;
              inputTranscript = event.transcript ?? "";
              sttUsage = event.usage;
              break;
            case "response.done":
              responses.push({ usage: event.response?.usage, status: event.response?.status });
              lastDone = at;
              transcript += " | ";
              break;
          }
        };
        listeners.add(listener);

        // 실시간 속도로 전송: 무음 300ms → 말소리 → (응답이 끝날 때까지) 무음
        const silence = Buffer.alloc(FRAME_SAMPLES * 2);
        const speech = Buffer.from(audio.pcm.buffer, audio.pcm.byteOffset, audio.pcm.byteLength);
        const frames: Buffer[] = [silence, silence, silence];
        for (let offset = 0; offset < speech.length; offset += FRAME_SAMPLES * 2) frames.push(speech.subarray(offset, offset + FRAME_SAMPLES * 2));
        const speechFrames = frames.length;
        if (closed) {
          budget.release(reservation);
          budget.release(sttReservation);
          console.log(`  [${plan.id}] 연결이 끊겨 남은 턴을 건너뜁니다.`);
          break;
        }
        eventCounts.clear();
        const start = performance.now();
        for (let frame = 0; ; frame += 1) {
          if (closed) break;
          const due = start + frame * FRAME_MS;
          const now = performance.now();
          if (due > now) await sleep(due - now);
          const chunk = frame < speechFrames ? frames[frame]! : silence;
          send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") });
          if (frame === speechFrames - 1) t.speechEnd = performance.now();
          const elapsed = performance.now() - start;
          // 응답이 모두 끝나고(만든 수 = 끝난 수) SETTLE_MS 동안 새 응답이 없으면 턴 종료
          const settled = responses.length > 0 && created === responses.length && performance.now() - lastDone > SETTLE_MS;
          if (frame >= speechFrames && (settled || elapsed > audio.speechSeconds * 1000 + TURN_TIMEOUT_MS)) break;
        }
        // 다음 턴에 앞 턴의 무음이 섞이지 않게 비운다 + 입력 전사가 늦으면 잠깐 기다린다
        send({ type: "input_audio_buffer.clear" });
        if (!t.inputTranscript) await waitFor("conversation.item.input_audio_transcription.completed", 3_000).catch(() => undefined);
        listeners.delete(listener);

        // 사용량 기록 (응답이 여러 개면 합산)
        const usage = responses.reduce<UsageTokens>((sum, r) => {
          const u = toTokens(r.usage);
          return {
            inputTextTokens: (sum.inputTextTokens ?? 0) + (u.inputTextTokens ?? 0),
            inputAudioTokens: (sum.inputAudioTokens ?? 0) + (u.inputAudioTokens ?? 0),
            cachedInputTokens: (sum.cachedInputTokens ?? 0) + (u.cachedInputTokens ?? 0),
            outputTextTokens: (sum.outputTextTokens ?? 0) + (u.outputTextTokens ?? 0),
            outputAudioTokens: (sum.outputAudioTokens ?? 0) + (u.outputAudioTokens ?? 0),
          };
        }, {});
        // 응답이 끝나지 않았는데 번역 음성이 일부 왔으면 사용량을 모르므로 예상치로 기록한다 (기록 누락 방지)
        const partial = responses.length === 0 && t.firstAudio !== undefined;
        const translateTokens = partial ? turnEstimate(instructions.length, audio.speechSeconds, contextTurns) : usage;
        if (responses.length > 0 || partial) await budget.commit(reservation, { ...translateTokens, kind: "translate", model });
        else budget.release(reservation);
        // 입력 전사 사용량: 응답에 있으면 그대로, 없으면 예상치로 기록 (기록을 빠뜨리지 않기 위해 보수적으로)
        const sttTokens: UsageTokens = sttUsage?.input_tokens !== undefined
          ? { inputAudioTokens: sttUsage.input_token_details?.audio_tokens ?? sttUsage.input_tokens, inputTextTokens: sttUsage.input_token_details?.text_tokens ?? 0, outputTextTokens: sttUsage.output_tokens ?? 0 }
          : transcribeEstimate(audio.speechSeconds);
        await budget.commit(sttReservation, { ...sttTokens, kind: "stt", model: env.STT_MODEL });
        const turnUsd = usd(model, translateTokens) + usd(env.STT_MODEL, sttTokens);
        runSpent += turnUsd;

        // 컨텍스트 정리: 마지막 턴(입력 + 응답 항목)만 남기고 지운다
        if (plan.prune) {
          const keep = 1 + responses.length;
          while (items.length > keep) send({ type: "conversation.item.delete", item_id: items.shift()! });
        }

        const ms = (key: string) => (t[key] !== undefined && t.speechEnd !== undefined ? Math.round(t[key] - t.speechEnd) : null);
        const committedAudioSeconds = speechStoppedAudioMs !== undefined && speechStartedAudioMs !== undefined ? (speechStoppedAudioMs - speechStartedAudioMs) / 1000 : null;
        const row = {
          plan: plan.id,
          vad: plan.vad.type,
          prune: plan.prune,
          turn: turn.id,
          trap: !!turn.trap,
          source: turn.text,
          speechSeconds: Number(audio.speechSeconds.toFixed(2)),
          endToSpeechStoppedMs: ms("speechStopped"),
          endToResponseCreatedMs: ms("responseCreated"),
          endToFirstAudioMs: ms("firstAudio"),
          endToFirstTextMs: ms("firstText"),
          endToInputTranscriptMs: ms("inputTranscript"),
          responses: responses.length,
          statuses: responses.map((r) => r.status),
          outputAudioSeconds: Number((outputBytes / 2 / RATE).toFixed(2)),
          translation: transcript.replace(/ \| $/, "").trim(),
          inputTranscript,
          committedAudioSeconds,
          inputAudioTokensPerSecond: committedAudioSeconds ? Number(((responses[0]?.usage?.input_token_details?.audio_tokens ?? 0) / committedAudioSeconds).toFixed(1)) : null,
          rawUsage: responses.map((r) => r.usage),
          sttUsage: sttUsage ?? "없음(예상치로 기록)",
          usd: Number(turnUsd.toFixed(5)),
          partialRecordedAsEstimate: partial,
          connectionClosed: closed,
          events: Object.fromEntries(eventCounts),
        };
        rows.push(row);
        console.log(
          `  ${turn.id}${turn.trap ? "(함정)" : ""}: 말 ${row.speechSeconds}s → 감지 ${row.endToSpeechStoppedMs}ms, 첫 음성 ${row.endToFirstAudioMs}ms, 첫 자막 ${row.endToFirstTextMs}ms, 응답 ${row.responses}개, $${row.usd}`,
        );
        console.log(`     원문 인식: ${inputTranscript}`);
        console.log(`     번역: ${row.translation}`);
        if (responses.length === 0) console.log(`     이벤트: ${JSON.stringify(row.events)}`);
        await sleep(800);
      }
      ws.close();
    }
  } catch (error) {
    if (!(error instanceof Error && error.message === "RUN_LIMIT")) console.error("측정 중단:", error instanceof Error ? error.message : error);
  } finally {
    const after = await budget.status();
    const summary = Object.fromEntries(
      ["server_vad", "semantic_vad"].map((vad) => {
        const subset = rows.filter((r) => r.vad === vad);
        return [vad, {
          turns: subset.length,
          medianEndToFirstAudioMs: median(subset.map((r) => r.endToFirstAudioMs as number)),
          medianEndToSpeechStoppedMs: median(subset.map((r) => r.endToSpeechStoppedMs as number)),
          medianEndToFirstTextMs: median(subset.map((r) => r.endToFirstTextMs as number)),
        }];
      }),
    );
    console.log("\n요약:", JSON.stringify(summary));
    console.log(`이번 실행 비용(기록 기준) $${(after.spentUsd - before.spentUsd).toFixed(4)}, 누적 $${after.spentUsd.toFixed(4)} / 한도 $${after.limitUsd}`);
    writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ model, rows, summary, runUsd: after.spentUsd - before.spentUsd }, null, 2));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
