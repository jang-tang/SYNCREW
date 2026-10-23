import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { BudgetExceededError, BudgetGuard, InMemoryUsageStore } from "../src/engine/budget/budgetGuard";
import { DEFAULT_PRICING } from "../src/engine/budget/pricing";
import { LegacyWorkplaceAdapter } from "../src/engine/dataset/legacyWorkplaceAdapter";
import { DomainProcessor, type StreamGlossary } from "../src/engine/domain/domainProcessor";
import { LANG_CODES } from "../src/shared/languages";
import { buildStreamInstructions, STREAM_INSTRUCTIONS_MAX_CHARS, type StreamEngineEvents, type TurnEnd } from "../src/streaming/engine";
import { hasSpeech, RealtimeStreamEngine, realtimeUsage, transcribeEstimate, transcriptionKeywords, type RealtimeStreamOptions } from "../src/streaming/realtimeStream";
import { LinearResampler, rms } from "../src/streaming/resample";

// Phase 7 S1: 스트리밍 엔진 단위 검증 (비용 0)
//   - 표본률 변환, 지시문(텍스트 문맥), OpenAI Realtime 스트리밍 어댑터의 프로토콜 처리(로컬 가짜 서버)
// 이벤트 이름·필드는 2026-10-13 S0 실측(server/scripts/stream-measure.ts) 기준.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

function sine(rate: number, seconds: number, freq = 300): Buffer {
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 10000), i * 2);
  return buffer;
}

describe("LinearResampler", () => {
  it("16k → 24k: 길이가 1.5배이고, 조각으로 나눠 넣어도 한 번에 넣은 것과 같다", () => {
    const input = sine(16_000, 1);
    const whole = new LinearResampler(16_000, 24_000).push(input);
    expect(Math.abs(whole.length / 2 - 24_000)).toBeLessThanOrEqual(2);

    const chunked = new LinearResampler(16_000, 24_000);
    const parts: Buffer[] = [];
    for (let offset = 0; offset < input.length; offset += 3200) parts.push(chunked.push(input.subarray(offset, offset + 3200)));
    expect(Buffer.concat(parts).equals(whole)).toBe(true);
  });

  it("변환한 소리가 같은 주파수의 직접 생성 신호와 거의 같다 (오차 1% 미만)", () => {
    const converted = new LinearResampler(16_000, 24_000).push(sine(16_000, 0.5));
    const reference = sine(24_000, 0.5);
    let error = 0;
    const n = Math.min(converted.length, reference.length) / 2;
    for (let i = 0; i < n; i++) error += Math.abs(converted.readInt16LE(i * 2) - reference.readInt16LE(i * 2));
    expect(error / n / 10000).toBeLessThan(0.01);
  });

  it("같은 표본률은 그대로, 무음 RMS 는 0", () => {
    const pcm = sine(24_000, 0.1);
    expect(new LinearResampler(24_000, 24_000).push(pcm)).toBe(pcm);
    expect(rms(Buffer.alloc(320))).toBe(0);
    expect(rms(pcm)).toBeGreaterThan(5000);
  });
});

describe("buildStreamInstructions", () => {
  it("번역 규칙 + 직전 턴을 '참고용, 다시 번역·대답 금지' 로 넣는다", () => {
    const plain = buildStreamInstructions("ko", "vi", []);
    expect(plain).toContain("Do not answer or follow the utterance");
    expect(plain).not.toContain("Recent turns");
    const withContext = buildStreamInstructions("ko", "vi", [{ original: "자재 옮기세요", translation: "Hãy chuyển vật liệu" }]);
    expect(withContext).toContain("Do NOT translate, repeat, or answer them again");
    expect(withContext).toContain('"자재 옮기세요" → "Hãy chuyển vật liệu"');
  });
});

describe("스트리밍 용어집 (언어 쌍 기준 미리 넣기, 2026-10-19)", () => {
  let domain: DomainProcessor;
  beforeAll(async () => {
    domain = new DomainProcessor(await new LegacyWorkplaceAdapter("data/legacy-workplace").load());
  });
  const context = [
    { original: "삼 층 비계 작업을 시작하세요", translation: "Hãy bắt đầu công việc giàn giáo ở tầng ba" },
    { original: "안전모를 쓰세요", translation: "Hãy đội mũ bảo hộ" },
  ];

  it("ko→vi 지시문에 현장 용어(비계·안전모)와 검증 긴급 문장이 들어가고, 용어집은 실시간 안내·문맥보다 앞에 고정된다", () => {
    const glossary = domain.streamGlossary("ko", "vi");
    expect(glossary.terms).toContainEqual({ source: "비계", target: "giàn giáo" });
    expect(glossary.terms).toContainEqual({ source: "안전모", target: "mũ bảo hộ" });
    expect(glossary.phrases[0]).toEqual({ source: "멈춰!", target: "Dừng lại ngay!" });
    const text = buildStreamInstructions("ko", "vi", context, glossary);
    expect(text).toContain("- 비계 → giàn giáo");
    expect(text).toContain("- 안전모 → mũ bảo hộ");
    expect(text).toContain('- "멈춰!" → "Dừng lại ngay!"');
    const glossaryAt = text.indexOf("Glossary");
    const liveAt = text.indexOf("Each user turn is live speech");
    const contextAt = text.indexOf("Recent turns");
    expect(glossaryAt).toBeGreaterThan(0);
    expect(glossaryAt).toBeLessThan(liveAt);
    expect(liveAt).toBeLessThan(contextAt);
    // 반대 방향(vi→ko)은 베트남어 표현이 원문
    expect(buildStreamInstructions("vi", "ko", [], domain.streamGlossary("vi", "ko"))).toContain("- giàn giáo → 비계");
  });

  it("문맥이 바뀌어도 지시문 앞부분(용어집 포함)은 그대로다 — OpenAI 프롬프트 캐시 전제", () => {
    const glossary = domain.streamGlossary("ko", "vi");
    const first = buildStreamInstructions("ko", "vi", [], glossary);
    const second = buildStreamInstructions("ko", "vi", context, glossary);
    expect(second.startsWith(first)).toBe(true);
    expect(second.length).toBeGreaterThan(first.length);
  });

  it("크기 상한: 모든 언어 쌍의 지시문(문맥 2줄 포함)이 STREAM_INSTRUCTIONS_MAX_CHARS 안이다 (용어 ≤ 110개, 문장 ≤ 12개, 용어+은어 ≤ 420개)", () => {
    for (const source of LANG_CODES) {
      for (const target of LANG_CODES) {
        if (source === target) continue;
        const glossary = domain.streamGlossary(source, target);
        expect(glossary.terms.length).toBeLessThanOrEqual(110);
        expect(glossary.phrases.length).toBeLessThanOrEqual(12);
        expect(glossary.terms.length + (glossary.slang?.length ?? 0)).toBeLessThanOrEqual(420);
        expect(buildStreamInstructions(source, target, context, glossary).length).toBeLessThanOrEqual(STREAM_INSTRUCTIONS_MAX_CHARS);
      }
    }
    // 용어 번역은 ko↔vi 만 있다. 다른 언어는 언어별 번역 대신 은어의 표준 한국어 뜻으로 (2026-10-23, docs/field-terms.md 0절)
    expect(domain.streamGlossary("ko", "vi").terms.length).toBe(110);
    // 은어는 전체가 들어간다 (2026-10-24 상한 확대): 표준어 뜻이 있는 은어 230개, ko→vi 는 용어에 이미 든 것을 뺀 나머지
    const slangTotal = domain.streamGlossary("ko", "ru").slang!.length;
    expect(slangTotal).toBeGreaterThanOrEqual(200);
    expect(domain.streamGlossary("ko", "vi").slang!.length).toBeLessThan(slangTotal);
    expect(domain.streamGlossary("ko", "zh").terms).toEqual([]);
    expect(domain.streamGlossary("ko", "zh").slang).toHaveLength(slangTotal);
  });

  it("ko→zh·ru·uz: 은어는 표준 한국어 뜻으로 들어가고(위험도 순, 아시바가 앞), 안전표지 검증 문장이 들어간다 (2026-10-23)", () => {
    const zh = domain.streamGlossary("ko", "zh");
    expect(zh.slang![0]).toEqual({ source: "아시바", standardKo: "비계" });
    expect(zh.slang).toContainEqual({ source: "데스리", standardKo: "난간" });
    expect(zh.phrases[0]).toEqual({ source: "추락 위험! 안전모, 안전대 착용 필수", target: "当心坠落！必须佩戴安全帽及安全带" });
    const text = buildStreamInstructions("ko", "zh", [], zh);
    expect(text).toContain("Korean site slang (slang=standard Korean meaning). Translate the meaning; never transliterate the slang:");
    // 한 줄에 20개씩 "은어=표준어; …"
    expect(text).toContain("\n아시바=비계; ");
    expect(text).toContain("데스리=난간");
    expect(text).toContain("호리가다=터파기");
    // 은어 → 검증 문장 → 실시간 안내 순서 (모두 고정 부분)
    expect(text.indexOf("Korean site slang")).toBeLessThan(text.indexOf("Verified sentence translations"));
    expect(text.indexOf("Verified sentence translations")).toBeLessThan(text.indexOf("Each user turn is live speech"));
    // 러시아어판 안전표지는 없어 문장은 0개, 은어는 들어간다
    expect(domain.streamGlossary("ko", "ru").phrases).toEqual([]);
    expect(domain.streamGlossary("ko", "ru").slang!.length).toBeGreaterThanOrEqual(200);
    expect(domain.streamGlossary("ko", "uz").phrases[0]!.target).toBe("Qulash xavfi! Xavfsizlik kaska va xavfsizlik kamarini taqish majburiy");
    // 받아쓰기 keywords 에 은어도 들어간다 (2026-10-24, 말하는 도중 자막이 은어를 받아쓰게)
    const keywords = transcriptionKeywords(zh);
    expect(keywords).toHaveLength(zh.slang!.length);
    expect(keywords).toEqual(expect.arrayContaining(["아시바", "호리가다", "데스리"]));
    // ko→vi: 번역 있는 용어가 먼저, 그 뒤 은어 (중복 없음)
    const viGlossary = domain.streamGlossary("ko", "vi");
    const viKeywords = transcriptionKeywords(viGlossary);
    expect(viKeywords.slice(0, 3)).toEqual(viGlossary.terms.slice(0, 3).map((term) => term.source));
    expect(new Set(viKeywords).size).toBe(viKeywords.length);
    expect(viKeywords).toContain("호리가다");
  });

  it("은어 목록: ko→vi 는 이미 용어(번역 있음)에 든 은어를 빼고, 원문이 외국어면 은어 목록이 없다", () => {
    const vi = domain.streamGlossary("ko", "vi");
    const termSources = new Set(vi.terms.map((term) => term.source));
    expect(termSources.has("아시바")).toBe(true);
    for (const item of vi.slang!) expect(termSources.has(item.source)).toBe(false);
    expect(domain.streamGlossary("vi", "ko").slang).toBeUndefined();
    expect(domain.streamGlossary("zh", "ko").slang).toBeUndefined();
  });

  it("순서가 결정적이다: 두 번 만들어도, 데이터셋을 다시 읽어도 같은 순서 (critical 용어가 앞)", async () => {
    const a = domain.streamGlossary("ko", "vi");
    const b = domain.streamGlossary("ko", "vi");
    const other = new DomainProcessor(await new LegacyWorkplaceAdapter("data/legacy-workplace").load()).streamGlossary("ko", "vi");
    expect(b).toEqual(a);
    expect(other).toEqual(a);
    expect(buildStreamInstructions("ko", "vi", [], a)).toBe(buildStreamInstructions("ko", "vi", [], other));
    const sources = a.terms.map((t) => t.source);
    expect(sources.indexOf("비계")).toBeLessThan(sources.indexOf("안전모")); // critical 이 high 보다 앞
    expect(new Set(sources).size).toBe(sources.length); // 중복 없음
  });
});

// ─── OpenAI Realtime 스트리밍 어댑터 ───────────────────

type Received = { type: string; [key: string]: unknown };

type FakeSession = {
  received: Received[];
  send: (event: object) => void;
  drop: () => void;
  headers: () => Record<string, unknown>;
};

/**
 * 가짜 OpenAI Realtime 서버. 연결 URL 에 intent=transcription 이 있으면 전사 세션(stt), 아니면 번역 세션(conversation).
 * 각 연결의 첫 session.update 에 session.updated 로 답한다 (rejectStt 면 전사 세션은 error 로 거부)
 */
async function fakeRealtime(options: { rejectStt?: boolean } = {}) {
  const sessions = { conversation: null as FakeSession | null, transcription: null as FakeSession | null };
  const urls: string[] = [];
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const kind = req.url?.includes("intent=transcription") ? "transcription" : "conversation";
    urls.push(req.url ?? "");
    const received: Received[] = [];
    const headers = req.headers as Record<string, unknown>;
    sessions[kind] = { received, send: (event) => ws.send(JSON.stringify(event)), drop: () => ws.terminate(), headers: () => headers };
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString()) as Received;
      received.push(event);
      if (event.type === "session.update" && received.filter((e) => e.type === "session.update").length === 1) {
        if (kind === "transcription" && options.rejectStt) ws.send(JSON.stringify({ type: "error", error: { code: "invalid_session", message: "rejected" } }));
        else ws.send(JSON.stringify({ type: "session.updated" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  );
  const conv = () => sessions.conversation!;
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/realtime`,
    urls,
    /** 번역 세션이 받은 이벤트 */
    get received() {
      return conv().received;
    },
    headers: () => conv().headers(),
    send: (event: object) => conv().send(event),
    drop: () => conv().drop(),
    /** 전사 세션 (liveTranscription 일 때만 있다) */
    stt: () => sessions.transcription,
    connections: () => urls.length,
  };
}

function recorder() {
  const log: { type: string; turnId?: string; data?: unknown }[] = [];
  const ends: { turnId: string; result: TurnEnd }[] = [];
  let closed: string | null = null;
  const events: StreamEngineEvents = {
    turnStart: (turnId) => log.push({ type: "start", turnId }),
    audio: (turnId, pcm) => log.push({ type: "audio", turnId, data: pcm.length }),
    translationDelta: (turnId, text) => log.push({ type: "delta", turnId, data: text }),
    originalDelta: (turnId, text) => log.push({ type: "originalDelta", turnId, data: text }),
    original: (turnId, text) => log.push({ type: "original", turnId, data: text }),
    turnEnd: (turnId, result) => ends.push({ turnId, result }),
    closed: (reason) => (closed = reason),
  };
  return { events, log, ends, closed: () => closed };
}

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("조건 시간 초과");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

function engine(url: string, limitUsd = 5, extra: Partial<Pick<RealtimeStreamOptions, "liveTranscription" | "streamTranscribeModel" | "trace" | "log">> = {}) {
  const store = new InMemoryUsageStore();
  const budget = new BudgetGuard(store, DEFAULT_PRICING, { limitUsd, period: "total" });
  return {
    store,
    budget,
    engine: new RealtimeStreamEngine({
      apiKey: "sk-test",
      model: "gpt-realtime-2.1",
      transcribeModel: "gpt-4o-mini-transcribe",
      voice: "marin",
      reasoning: "low",
      silenceMs: 500,
      budget,
      url,
      ...extra,
    }),
  };
}

const sttUsage = { type: "tokens", input_tokens: 50, output_tokens: 23, input_token_details: { audio_tokens: 49, text_tokens: 1 } };

const usage = {
  input_tokens: 252,
  output_tokens: 205,
  input_token_details: { text_tokens: 203, audio_tokens: 49, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } },
  output_token_details: { text_tokens: 117, audio_tokens: 88 },
};

describe("RealtimeStreamEngine (OpenAI Realtime 스트리밍)", () => {
  it("세션 설정: 번역 세션은 server_vad 500ms·interrupt_response=false·24kHz 음성·전사 없음, 전사 세션(intent=transcription)은 같은 VAD + 입력 전사(언어), 인증 헤더", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: recorder().events });
    const update = server.received[0] as unknown as { session: { audio: { input: Record<string, unknown> } } };
    expect(server.received[0]!.type).toBe("session.update");
    expect(update.session).toMatchObject({
      type: "realtime",
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24_000 },
          turn_detection: { type: "server_vad", silence_duration_ms: 500, prefix_padding_ms: 300, create_response: true, interrupt_response: false },
        },
        output: { format: { type: "audio/pcm", rate: 24_000 }, voice: "marin" },
      },
      reasoning: { effort: "low" },
    });
    // 받아쓰기는 전사 세션만 한다 (2번 청구 방지)
    expect(update.session.audio.input).not.toHaveProperty("transcription");
    expect(server.headers()["authorization"]).toBe("Bearer sk-test");

    expect(server.connections()).toBe(2);
    expect(server.urls.some((u) => u.includes("intent=transcription"))).toBe(true);
    expect(server.urls.some((u) => u.includes("model=gpt-realtime-2.1") && !u.includes("intent="))).toBe(true);
    const stt = server.stt()!;
    expect(stt.headers()["authorization"]).toBe("Bearer sk-test");
    expect(stt.received[0]).toEqual({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model: "gpt-4o-mini-transcribe", language: "ko", prompt: expect.any(String) },
            turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
          },
        },
      },
    });

    // 같은 음성이 두 세션에 모두 들어간다
    connection.append(Buffer.alloc(4800));
    await until(() => stt.received.some((r) => r.type === "input_audio_buffer.append"));
    await until(() => server.received.some((r) => r.type === "input_audio_buffer.append"));
    expect(server.received.find((r) => r.type === "input_audio_buffer.append")!["audio"]).toBe(stt.received.find((r) => r.type === "input_audio_buffer.append")!["audio"]);
    connection.close();
  });

  it("STREAM_LIVE_TRANSCRIPTION=off (liveTranscription:false): 예전 그대로 — 연결 1개, 번역 세션이 입력 전사까지, 번역 세션의 전사 이벤트가 원문이 된다", async () => {
    const server = await fakeRealtime();
    const { engine: e, store } = engine(server.url, 5, { liveTranscription: false });
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    expect(server.connections()).toBe(1);
    expect(server.stt()).toBeNull();
    const update = server.received[0] as unknown as { session: { audio: { input: Record<string, unknown> } } };
    expect(update.session.audio.input["transcription"]).toMatchObject({ model: "gpt-4o-mini-transcribe", language: "ko" });

    server.send({ type: "input_audio_buffer.committed", item_id: "item_in" });
    server.send({ type: "response.created", response: { id: "resp_1" } });
    server.send({ type: "conversation.item.input_audio_transcription.delta", item_id: "item_in", delta: "안전모" });
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_1", delta: "Mũ bảo hộ" });
    server.send({ type: "response.done", response: { id: "resp_1", status: "completed", usage, output: [{ id: "item_out" }] } });
    server.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_in", transcript: "안전모", usage: sttUsage });
    await until(() => rec.ends.length === 1);
    expect(rec.log.map((l) => `${l.type}:${l.data ?? ""}`)).toEqual(["start:", "originalDelta:안전모", "delta:Mũ bảo hộ", "original:안전모"]);
    expect(rec.ends[0]!.result).toMatchObject({ status: "done", original: "안전모", translation: "Mũ bảo hộ" });
    await until(() => store.records.length === 2);
    connection.close();
  });

  it("전사 세션을 못 열면(설정 거부) 번역 세션 전사로 되돌아간다 — 번역 세션에 전사가 켜진 설정을 다시 보낸다", async () => {
    const server = await fakeRealtime({ rejectStt: true });
    const logs: string[] = [];
    const { engine: e } = engine(server.url, 5, { log: (message) => logs.push(message) });
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    expect(logs).toContain("Realtime 전사 세션 열기 실패, 번역 세션 전사로 대체");
    const updates = () => server.received.filter((r) => r.type === "session.update") as unknown as { session: { audio?: { input: Record<string, unknown> } } }[];
    await until(() => updates().some((u) => u.session.audio?.input["transcription"] !== undefined));
    expect(updates()[0]!.session.audio?.input["transcription"]).toBeUndefined(); // 처음엔 전사 없이 열었다
    // 그 뒤 번역 세션의 전사 이벤트가 원문이 된다
    server.send({ type: "input_audio_buffer.committed", item_id: "item_f" });
    server.send({ type: "conversation.item.input_audio_transcription.delta", item_id: "item_f", delta: "네" });
    await until(() => rec.log.some((l) => l.type === "originalDelta"));
    connection.close();
  });

  it("용어집을 넘기면 세션 지시문에 들어가고, 문맥(setContext) 갱신은 그 뒤에만 붙는다", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const glossary: StreamGlossary = { terms: [{ source: "비계", target: "giàn giáo" }], phrases: [{ source: "멈춰!", target: "Dừng lại ngay!" }] };
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: recorder().events, glossary });
    const first = (server.received[0] as unknown as { session: { instructions: string } }).session.instructions;
    expect(first).toContain("- 비계 → giàn giáo");
    expect(first).toContain('- "멈춰!" → "Dừng lại ngay!"');
    connection.setContext([{ original: "a", translation: "b" }]);
    await until(() => server.received.filter((r) => r.type === "session.update").length === 2);
    const second = (server.received.filter((r) => r.type === "session.update")[1] as unknown as { session: { instructions: string } }).session.instructions;
    expect(second.startsWith(first)).toBe(true);
    expect(second).toContain('"a" → "b"');
    connection.close();
  });

  it("턴 1개: 확정 → 시작·음성·자막·원문 → 끝(done), 사용량 기록, 세션 안 항목 삭제, 문맥은 session.update 로", async () => {
    const server = await fakeRealtime();
    const { engine: e, store } = engine(server.url);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "vi", targetLang: "ko", events: rec.events });

    connection.append(Buffer.alloc(4800 * 10)); // 1초
    await until(() => server.received.some((r) => r.type === "input_audio_buffer.append"));
    server.send({ type: "input_audio_buffer.speech_started", audio_start_ms: 0 });
    server.send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 900 });
    server.send({ type: "input_audio_buffer.committed", item_id: "item_in" });
    server.send({ type: "conversation.item.added", item: { id: "item_in" } });
    server.send({ type: "response.created", response: { id: "resp_1" } });
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_1", delta: "비상정지 " });
    server.send({ type: "response.output_audio.delta", response_id: "resp_1", delta: Buffer.alloc(960).toString("base64") });
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_1", delta: "점검했습니다." });
    server.send({ type: "response.done", response: { id: "resp_1", status: "completed", usage, output: [{ id: "item_out" }] } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rec.ends).toHaveLength(0); // 원문 전사(전사 세션)를 기다린다
    const stt = server.stt()!;
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_in" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_in", transcript: "Tôi đã kiểm tra nút dừng khẩn cấp.", usage: sttUsage });
    await until(() => rec.ends.length === 1);

    expect(rec.log.map((l) => l.type)).toEqual(["start", "delta", "audio", "delta", "original"]);
    const turnId = rec.log[0]!.turnId!;
    expect(rec.log.every((l) => l.turnId === turnId)).toBe(true);
    expect(rec.ends[0]).toEqual({
      turnId,
      result: { status: "done", original: "Tôi đã kiểm tra nút dừng khẩn cấp.", translation: "비상정지 점검했습니다.", model: "gpt-realtime-2.1" },
    });
    await until(() => store.records.length === 2);
    expect(store.records.map((r) => r.kind).sort()).toEqual(["stt", "translate"]);
    expect(store.records.find((r) => r.kind === "translate")).toMatchObject({ inputAudioTokens: 49, outputAudioTokens: 88, outputTextTokens: 117 });
    expect(store.records.find((r) => r.kind === "stt")).toMatchObject({ inputAudioTokens: 49, outputTextTokens: 23, model: "gpt-4o-mini-transcribe" });
    const deleted = server.received.filter((r) => r.type === "conversation.item.delete").map((r) => r["item_id"]);
    expect(deleted.sort()).toEqual(["item_in", "item_out"]);

    connection.setContext([{ original: "a", translation: "b" }]);
    await until(() => server.received.filter((r) => r.type === "session.update").length === 2);
    const contextUpdate = server.received.filter((r) => r.type === "session.update")[1] as unknown as { session: { instructions: string } };
    expect(contextUpdate.session.instructions).toContain('"a" → "b"');
    connection.close();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("단말 말 끝(commit)에 아무것도 보내지 않는다 — 말 끝은 서버 VAD 만 정한다 (2026-10-19 실측: 수동 commit 뒤 VAD 가 멈춤)", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: recorder().events });
    server.send({ type: "input_audio_buffer.speech_started" });
    await sleep(50);
    connection.commit();
    connection.setContext([{ original: "a", translation: "b" }]); // 대조군: 그 뒤 보낸 것은 도착한다
    await until(() => server.received.filter((r) => r.type === "session.update").length === 2);
    expect(server.received.filter((r) => r.type === "input_audio_buffer.commit")).toHaveLength(0);
    expect(server.received.filter((r) => r.type === "response.create")).toHaveLength(0);
    connection.close();
  });

  it("전사 세션의 조각(...transcription.delta)은 말하는 도중(번역 턴이 확정되기 전)에 originalDelta 로 올라오고, 완성본은 번역 턴이 시작된 뒤 그 턴 id 로 올라온다", async () => {
    const server = await fakeRealtime();
    const traces: string[] = [];
    const { engine: e } = engine(server.url, 5, { trace: (session, type) => traces.push(`${session}:${type}`) });
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    // 말하는 중: 전사 세션만 이벤트를 낸다 (번역 세션은 아직 아무 턴도 없다)
    stt.send({ type: "input_audio_buffer.speech_started", item_id: "stt_d", audio_start_ms: 0 });
    stt.send({ type: "conversation.item.input_audio_transcription.delta", item_id: "stt_d", delta: "안전모" });
    stt.send({ type: "conversation.item.input_audio_transcription.delta", item_id: "stt_d", delta: " 쓰세요" });
    await until(() => rec.log.filter((l) => l.type === "originalDelta").length === 2);
    const turnId = rec.log[0]!.turnId!;
    expect(rec.log).toEqual([
      { type: "originalDelta", turnId, data: "안전모" },
      { type: "originalDelta", turnId, data: " 쓰세요" },
    ]);
    // 전사 완성본이 번역 응답보다 먼저 와도 original 은 턴 시작(response.created) 뒤에 올라온다
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_d" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_d", transcript: "안전모 쓰세요", usage: sttUsage });
    await until(() => traces.includes("transcription:conversation.item.input_audio_transcription.completed"));
    expect(rec.log.some((l) => l.type === "original")).toBe(false);
    server.send({ type: "input_audio_buffer.committed", item_id: "item_d" });
    server.send({ type: "response.created", response: { id: "resp_d" } });
    await until(() => rec.log.some((l) => l.type === "original"));
    expect(rec.log.slice(2)).toEqual([
      { type: "start", turnId },
      { type: "original", turnId, data: "안전모 쓰세요" },
    ]);
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_d", delta: "Hãy đội mũ bảo hộ" });
    server.send({ type: "response.done", response: { id: "resp_d", status: "completed", usage, output: [] } });
    await until(() => rec.ends.length === 1);
    expect(rec.ends[0]).toEqual({ turnId, result: { status: "done", original: "안전모 쓰세요", translation: "Hãy đội mũ bảo hộ", model: "gpt-realtime-2.1" } });
    // STREAM_DEBUG 추적: 조각이 아닌 이벤트는 세션 종류와 함께, 첫 조각은 "(first)" 로 남는다
    expect(traces).toContain("transcription:input_audio_buffer.speech_started");
    expect(traces).toContain("transcription:conversation.item.input_audio_transcription.delta (first)");
    expect(traces).toContain("conversation:response.created");
    expect(traces.filter((t) => t.endsWith(".delta"))).toEqual([]);
    connection.close();
  });

  it("턴 짝짓기: 두 세션의 항목을 순서대로 묶는다 — 전사 2턴이 먼저 완성돼도 번역 1·2턴에 차례로 붙고, 번역 턴이 없는 전사는 버린다", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_1" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_1", transcript: "첫째", usage: sttUsage });
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_2" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_2", transcript: "둘째", usage: sttUsage });
    for (const n of [1, 2]) {
      server.send({ type: "input_audio_buffer.committed", item_id: `item_${n}` });
      server.send({ type: "response.created", response: { id: `resp_${n}` } });
      server.send({ type: "response.output_audio_transcript.delta", response_id: `resp_${n}`, delta: `번역${n}` });
      server.send({ type: "response.done", response: { id: `resp_${n}`, status: "completed", usage, output: [] } });
    }
    await until(() => rec.ends.length === 2);
    expect(rec.ends.map((x) => x.result)).toEqual([
      { status: "done", original: "첫째", translation: "번역1", model: "gpt-realtime-2.1" },
      { status: "done", original: "둘째", translation: "번역2", model: "gpt-realtime-2.1" },
    ]);
    expect(new Set(rec.ends.map((x) => x.turnId)).size).toBe(2);
    expect(rec.log.filter((l) => l.type === "original").map((l) => l.data)).toEqual(["첫째", "둘째"]);
    connection.close();
  });

  it("hasSpeech: 글자가 없거나 군소리(음·어·ừ·嗯)뿐이면 말이 아니다, 짧은 지시(멈춰·네)는 말이다", () => {
    for (const text of ["", "  ", "음,", "어, 어…", "음음", "Ừ.", "嗯", "...", "э"]) expect(hasSpeech(text), text).toBe(false);
    for (const text of ["멈춰!", "네", "아 네 그리고", "Tôi hiểu rồi.", "好啊", "12"]) expect(hasSpeech(text), text).toBe(true);
  });

  // 2026-10-24 S4 실측: 전사가 비거나 군소리뿐인 턴에서 번역 모델이 "멈춰!" 같은 지시를 지어냈다 → 내보내지 않는다
  it("원문에 말이 없는 턴: 전사가 오기 전 번역 음성·자막은 붙잡아 두고, 빈 전사가 오면 버린다 (응답 취소 + EMPTY 실패)", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    server.send({ type: "input_audio_buffer.committed", item_id: "item_e" });
    server.send({ type: "response.created", response: { id: "resp_e" } });
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_e", delta: "Dừng lại ngay!" });
    server.send({ type: "response.output_audio.delta", response_id: "resp_e", delta: Buffer.alloc(960).toString("base64") });
    await until(() => rec.log.some((l) => l.type === "start"));
    await sleep(50);
    expect(rec.log.map((l) => l.type)).toEqual(["start"]); // 전사 전: 붙잡아 둠
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_e" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_e", transcript: "음,", usage: sttUsage });
    await until(() => rec.ends.length === 1);
    expect(rec.ends[0]!.result).toEqual({ status: "failed", code: "EMPTY" });
    await until(() => server.received.some((r) => r.type === "response.cancel"));
    expect(server.received.find((r) => r.type === "response.cancel")).toEqual({ type: "response.cancel", response_id: "resp_e" });
    server.send({ type: "response.output_audio.delta", response_id: "resp_e", delta: Buffer.alloc(960).toString("base64") });
    server.send({ type: "response.done", response: { id: "resp_e", status: "cancelled", usage, output: [] } });
    await sleep(50);
    expect(rec.log.map((l) => l.type)).toEqual(["start"]);
    expect(rec.ends).toHaveLength(1);

    // 대조군: 다음 턴은 말이 있는 전사 → 붙잡아 둔 것을 순서대로 내보낸다
    server.send({ type: "input_audio_buffer.committed", item_id: "item_s" });
    server.send({ type: "response.created", response: { id: "resp_s" } });
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_s", delta: "Ăn trưa lúc 12 giờ." });
    server.send({ type: "response.output_audio.delta", response_id: "resp_s", delta: Buffer.alloc(960).toString("base64") });
    await sleep(50);
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_s" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_s", transcript: "점심은 열두 시에", usage: sttUsage });
    server.send({ type: "response.done", response: { id: "resp_s", status: "completed", usage, output: [] } });
    await until(() => rec.ends.length === 2);
    expect(rec.log.slice(1).map((l) => l.type)).toEqual(["start", "delta", "audio", "original"]);
    expect(rec.ends[1]!.result).toMatchObject({ status: "done", original: "점심은 열두 시에", translation: "Ăn trưa lúc 12 giờ." });
    connection.close();
  });

  it("빈 전사가 번역 응답보다 먼저 오면: 응답이 만들어지자마자 취소하고 시작을 알리지 않는다", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_e" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_e", transcript: "", usage: sttUsage });
    await sleep(50);
    server.send({ type: "input_audio_buffer.committed", item_id: "item_e" });
    server.send({ type: "response.created", response: { id: "resp_e" } });
    server.send({ type: "response.output_audio.delta", response_id: "resp_e", delta: Buffer.alloc(960).toString("base64") });
    await until(() => server.received.some((r) => r.type === "response.cancel"));
    server.send({ type: "response.done", response: { id: "resp_e", status: "cancelled", usage, output: [] } });
    await sleep(50);
    expect(rec.log).toEqual([]);
    expect(rec.ends).toEqual([]);
    connection.close();
  });

  it("말하는 도중 전사 조각에 말이 있으면 번역 음성은 붙잡지 않고 바로 나간다 (지연 없음)", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    stt.send({ type: "conversation.item.input_audio_transcription.delta", item_id: "stt_1", delta: "안전모" });
    await until(() => rec.log.some((l) => l.type === "originalDelta"));
    server.send({ type: "input_audio_buffer.committed", item_id: "item_1" });
    server.send({ type: "response.created", response: { id: "resp_1" } });
    server.send({ type: "response.output_audio.delta", response_id: "resp_1", delta: Buffer.alloc(960).toString("base64") });
    await until(() => rec.log.some((l) => l.type === "audio")); // 전사 완성본 전
    expect(rec.log.map((l) => l.type)).toEqual(["originalDelta", "start", "audio"]);
    connection.close();
  });

  it("전사가 오지 않으면 SPEECH_HOLD_MS(2초) 뒤 붙잡아 둔 번역을 그대로 내보낸다", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    server.send({ type: "input_audio_buffer.committed", item_id: "item_1" });
    server.send({ type: "response.created", response: { id: "resp_1" } });
    server.send({ type: "response.output_audio.delta", response_id: "resp_1", delta: Buffer.alloc(960).toString("base64") });
    await sleep(1500);
    expect(rec.log.map((l) => l.type)).toEqual(["start"]);
    await until(() => rec.log.some((l) => l.type === "audio"), 1500);
    connection.close();
  });

  it("응답 도중 연결이 끊기면 진행 중 턴은 실패(ENGINE_CLOSED), closed('error'), 예약은 풀린다", async () => {
    const server = await fakeRealtime();
    const { engine: e, budget } = engine(server.url);
    const rec = recorder();
    await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    server.send({ type: "input_audio_buffer.committed", item_id: "item_x" });
    server.send({ type: "response.created", response: { id: "resp_x" } });
    server.send({ type: "response.output_audio.delta", response_id: "resp_x", delta: Buffer.alloc(480).toString("base64") });
    await until(() => rec.log.some((l) => l.type === "audio"));
    server.drop();
    await until(() => rec.closed() === "error");
    expect(rec.ends).toEqual([{ turnId: rec.log[0]!.turnId, result: { status: "failed", code: "ENGINE_CLOSED" } }]);
    await new Promise((resolve) => setTimeout(resolve, 20)); // 예약 해제는 예약이 끝난 뒤 비동기로
    expect((await budget.status()).reservedUsd).toBe(0);
  });

  it("비용: 남은 한도가 모자라면 열지 않고(BudgetExceededError), 턴 예약이 안 되면 그 턴 취소 + closed('budget')", async () => {
    const server = await fakeRealtime();
    await expect(engine(server.url, 0.01).engine.open({ sourceLang: "ko", targetLang: "vi", events: recorder().events })).rejects.toBeInstanceOf(BudgetExceededError);

    const { engine: e, budget } = engine(server.url, 0.035);
    const rec = recorder();
    await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    await budget.reserve(0.03); // 다른 호출이 한도를 거의 다 씀
    server.send({ type: "input_audio_buffer.committed", item_id: "item_b" });
    server.send({ type: "response.created", response: { id: "resp_b" } });
    await until(() => rec.closed() === "budget");
    expect(rec.ends).toEqual([{ turnId: expect.any(String), result: { status: "failed", code: "BUDGET_EXCEEDED" } }]);
    await until(() => server.received.some((r) => r.type === "response.cancel"));
  });

  it("realtimeUsage: 캐시된 입력은 종류별로 빼고, 추론 토큰은 텍스트 출력으로 계산", () => {
    expect(
      realtimeUsage({
        input_tokens: 581,
        output_tokens: 214,
        input_token_details: { text_tokens: 440, audio_tokens: 141, cached_tokens: 512, cached_tokens_details: { text_tokens: 384, audio_tokens: 128 } },
        output_token_details: { text_tokens: 83, audio_tokens: 83 },
      }),
    ).toEqual({ inputTextTokens: 56, inputAudioTokens: 13, cachedInputTokens: 512, outputTextTokens: 131, outputAudioTokens: 83 });
  });
});

// ─── gpt-live-transcribe 전사 세션 (2026-10-20): VAD 없이 말하는 도중 조각, 말 끝은 번역 세션 VAD → 서버가 전사 세션에 commit ───

describe("RealtimeStreamEngine + gpt-live-transcribe (STREAM_STT_MODEL)", () => {
  const live = { streamTranscribeModel: "gpt-live-transcribe" } as const;
  type SttUpdate = { session: { audio: { input: { transcription: Record<string, unknown>; turn_detection: unknown } } } };

  it("전사 세션 설정: turn_detection null · languages [원문 언어 ISO 639-1] · delay low · 용어집 keywords(≤50, 한 줄·<> 없음), 번역 세션은 그대로 server_vad", async () => {
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url, 5, live);
    const glossary: StreamGlossary = {
      terms: [
        { source: "비계", target: "giàn giáo" },
        { source: "안전모", target: "mũ bảo hộ" },
        { source: "비계", target: "giàn giáo" }, // 중복
        { source: "두\n줄", target: "x" }, // 여러 줄
        { source: "<태그>", target: "y" }, // 꺾쇠
        { source: "  ", target: "z" }, // 빈 값
      ],
      phrases: [],
    };
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: recorder().events, glossary });
    const stt = server.stt()!;
    const update = stt.received[0] as unknown as SttUpdate;
    expect(update).toEqual({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model: "gpt-live-transcribe", languages: ["ko"], delay: "low", prompt: expect.any(String), keywords: ["비계", "안전모"] },
            turn_detection: null,
          },
        },
      },
    });
    expect(update.session.audio.input.transcription).not.toHaveProperty("language");
    // 번역 세션은 바뀌지 않는다 (server_vad, 전사 없음)
    const conv = (server.received[0] as unknown as SttUpdate).session.audio.input;
    expect(conv.turn_detection).toMatchObject({ type: "server_vad", create_response: true });
    expect(conv).not.toHaveProperty("transcription");
    connection.close();
  });

  it("transcriptionKeywords: 용어집이 없거나 비면 keywords 를 보내지 않고, 400개를 넘으면 앞 400개만 (용어 → 은어 순)", async () => {
    expect(transcriptionKeywords(undefined)).toEqual([]);
    const many: StreamGlossary = {
      terms: Array.from({ length: 300 }, (_, i) => ({ source: `용어${i}`, target: `t${i}` })),
      phrases: [],
      slang: Array.from({ length: 200 }, (_, i) => ({ source: `은어${i}`, standardKo: `표준${i}` })),
    };
    expect(transcriptionKeywords(many)).toHaveLength(400);
    expect(transcriptionKeywords(many)[299]).toBe("용어299");
    expect(transcriptionKeywords(many)[399]).toBe("은어99");
    const server = await fakeRealtime();
    const { engine: e } = engine(server.url, 5, live);
    const connection = await e.open({ sourceLang: "vi", targetLang: "ko", events: recorder().events });
    const transcription = (server.stt()!.received[0] as unknown as SttUpdate).session.audio.input.transcription;
    expect(transcription).not.toHaveProperty("keywords");
    expect(transcription["languages"]).toEqual(["vi"]);
    connection.close();
  });

  it("말하는 도중 조각이 (번역 턴이 생기기 전에) originalDelta 로 올라오고, 번역 세션 committed 때 전사 세션에 commit 을 정확히 1번 보내며, 완성본은 턴 시작 뒤 같은 턴 id 로, 사용량은 duration(초) 기준 $0.017/분", async () => {
    const server = await fakeRealtime();
    const traces: string[] = [];
    const { engine: e, store } = engine(server.url, 5, { ...live, trace: (session, type) => traces.push(`${session}:${type}`) });
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    const sttCommits = () => stt.received.filter((r) => r.type === "input_audio_buffer.commit");

    connection.append(Buffer.alloc(4800 * 30)); // 3초
    await until(() => stt.received.some((r) => r.type === "input_audio_buffer.append"));
    // 말하는 중: 전사 세션(VAD 없음)이 조각을 낸다. speech_started 는 없다. 번역 세션은 아직 아무 턴도 없다
    stt.send({ type: "conversation.item.input_audio_transcription.delta", item_id: "live_1", delta: "안전모를" });
    stt.send({ type: "conversation.item.input_audio_transcription.delta", item_id: "live_1", delta: " 쓰세요" });
    await until(() => rec.log.filter((l) => l.type === "originalDelta").length === 2);
    const turnId = rec.log[0]!.turnId!;
    expect(rec.log).toEqual([
      { type: "originalDelta", turnId, data: "안전모를" },
      { type: "originalDelta", turnId, data: " 쓰세요" },
    ]);
    expect(sttCommits()).toHaveLength(0); // 말하는 동안은 commit 없음

    // 번역 세션 VAD 가 말 끝을 정함 → 서버가 전사 세션에 commit 1번
    server.send({ type: "input_audio_buffer.speech_started", audio_start_ms: 0 });
    server.send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 2900 });
    server.send({ type: "input_audio_buffer.committed", item_id: "item_1" });
    await until(() => sttCommits().length === 1);
    expect(sttCommits()).toEqual([{ type: "input_audio_buffer.commit" }]);
    // 번역 세션에는 수동 commit 을 보내지 않는다 (VAD 를 멈추므로)
    expect(server.received.filter((r) => r.type === "input_audio_buffer.commit")).toHaveLength(0);

    // 전사 세션: commit 응답(committed) → 완성본(duration 사용량). 번역 응답보다 먼저 와도 original 은 턴 시작 뒤에
    stt.send({ type: "input_audio_buffer.committed", item_id: "live_1", previous_item_id: null });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "live_1", transcript: "안전모를 쓰세요.", usage: { type: "duration", seconds: 3.1 } });
    await until(() => traces.includes("transcription:conversation.item.input_audio_transcription.completed"));
    expect(rec.log.some((l) => l.type === "original")).toBe(false);
    server.send({ type: "response.created", response: { id: "resp_1" } });
    await until(() => rec.log.some((l) => l.type === "original"));
    expect(rec.log.slice(2)).toEqual([
      { type: "start", turnId },
      { type: "original", turnId, data: "안전모를 쓰세요." },
    ]);
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_1", delta: "Hãy đội mũ bảo hộ." });
    server.send({ type: "response.done", response: { id: "resp_1", status: "completed", usage, output: [{ id: "out_1" }] } });
    await until(() => rec.ends.length === 1);
    expect(rec.ends[0]).toEqual({ turnId, result: { status: "done", original: "안전모를 쓰세요.", translation: "Hãy đội mũ bảo hộ.", model: "gpt-realtime-2.1" } });

    // 비용: stt 는 gpt-live-transcribe, 3.1초 → 52 "음성 토큰"(1분=1000) × $17/1M ≈ $0.000884 (= 3.1/60 × $0.017 반올림)
    await until(() => store.records.length === 2);
    const sttRecord = store.records.find((r) => r.kind === "stt")!;
    expect(sttRecord).toMatchObject({ model: "gpt-live-transcribe", inputAudioTokens: 52 });
    expect(sttRecord.outputTextTokens ?? 0).toBe(0);
    expect(sttRecord.costUsd).toBeCloseTo((3.1 / 60) * 0.017, 4);
    expect(transcribeEstimate("gpt-live-transcribe", 3)).toEqual({ inputAudioTokens: 59 });
    expect(transcribeEstimate("gpt-4o-transcribe", 3)).toEqual({ inputAudioTokens: 140, outputTextTokens: 60 });
    expect(traces).not.toContain("transcription:input_audio_buffer.speech_started");
    expect(traces).toContain("transcription:conversation.item.input_audio_transcription.delta (first)");
    expect(sttCommits()).toHaveLength(1); // 턴이 끝나도 commit 은 1번뿐
    connection.close();
  });

  it("여러 턴: 번역 세션 committed 마다 전사 세션 commit 1번씩, 완성본은 순서대로 짝지어지고 (item_id 로) 턴마다 원문이 맞는다", async () => {
    const server = await fakeRealtime();
    const { engine: e, store } = engine(server.url, 5, live);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    const sttCommits = () => stt.received.filter((r) => r.type === "input_audio_buffer.commit");
    const turn = async (n: number) => {
      stt.send({ type: "conversation.item.input_audio_transcription.delta", item_id: `live_${n}`, delta: `원문${n}` });
      await until(() => rec.log.filter((l) => l.type === "originalDelta").length === n);
      server.send({ type: "input_audio_buffer.committed", item_id: `item_${n}` });
      await until(() => sttCommits().length === n);
      server.send({ type: "response.created", response: { id: `resp_${n}` } });
      server.send({ type: "response.output_audio_transcript.delta", response_id: `resp_${n}`, delta: `번역${n}` });
      server.send({ type: "response.done", response: { id: `resp_${n}`, status: "completed", usage, output: [] } });
      stt.send({ type: "input_audio_buffer.committed", item_id: `live_${n}` });
    };
    await turn(1);
    await turn(2);
    // 완성본이 뒤바뀌어 와도 item_id 로 제 턴에 붙는다
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "live_2", transcript: "둘째", usage: { type: "duration", seconds: 2 } });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "live_1", transcript: "첫째", usage: { type: "duration", seconds: 1 } });
    await until(() => rec.ends.length === 2);
    const ids = rec.log.filter((l) => l.type === "start").map((l) => l.turnId);
    expect(new Set(ids).size).toBe(2);
    // 턴 끝은 완성본이 온 순서(2 → 1)지만, 원문·번역은 각자 제 턴에 붙는다
    expect(rec.ends.map((x) => x.turnId)).toEqual([ids[1], ids[0]]);
    expect(rec.ends.find((x) => x.turnId === ids[0])!.result).toEqual({ status: "done", original: "첫째", translation: "번역1", model: "gpt-realtime-2.1" });
    expect(rec.ends.find((x) => x.turnId === ids[1])!.result).toEqual({ status: "done", original: "둘째", translation: "번역2", model: "gpt-realtime-2.1" });
    expect(rec.log.filter((l) => l.type === "originalDelta").map((l) => [l.turnId, l.data])).toEqual([
      [ids[0], "원문1"],
      [ids[1], "원문2"],
    ]);
    expect(sttCommits()).toHaveLength(2);
    await until(() => store.records.filter((r) => r.kind === "stt").length === 2);
    expect(store.records.filter((r) => r.kind === "stt").map((r) => r.inputAudioTokens).sort()).toEqual([17, 34]);
    connection.close();
  });

  it("STREAM_STT_MODEL=gpt-4o-transcribe 면 예전 그대로: 전사 세션은 server_vad + language, 번역 세션 committed 에 commit 을 보내지 않고 사용량은 tokens 형", async () => {
    const server = await fakeRealtime();
    const { engine: e, store } = engine(server.url, 5, { streamTranscribeModel: "gpt-4o-transcribe" });
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const stt = server.stt()!;
    expect((stt.received[0] as unknown as SttUpdate).session.audio.input).toEqual({
      format: { type: "audio/pcm", rate: 24_000 },
      transcription: { model: "gpt-4o-transcribe", language: "ko", prompt: expect.any(String) },
      turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
    });
    server.send({ type: "input_audio_buffer.committed", item_id: "item_v" });
    server.send({ type: "response.created", response: { id: "resp_v" } });
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_v", delta: "번역" });
    server.send({ type: "response.done", response: { id: "resp_v", status: "completed", usage, output: [] } });
    stt.send({ type: "input_audio_buffer.speech_started", item_id: "stt_v" });
    stt.send({ type: "input_audio_buffer.committed", item_id: "stt_v" });
    stt.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "stt_v", transcript: "원문", usage: sttUsage });
    await until(() => rec.ends.length === 1);
    expect(rec.ends[0]!.result).toMatchObject({ status: "done", original: "원문" });
    await until(() => store.records.length === 2);
    expect(store.records.find((r) => r.kind === "stt")).toMatchObject({ model: "gpt-4o-transcribe", inputAudioTokens: 49, outputTextTokens: 23 });
    expect(stt.received.filter((r) => r.type === "input_audio_buffer.commit")).toHaveLength(0);
    connection.close();
  });

  it("전사 세션을 못 열면(거부) 번역 세션 전사(STT_MODEL)로 되돌아가고 commit 도 보내지 않는다", async () => {
    const server = await fakeRealtime({ rejectStt: true });
    const { engine: e, store } = engine(server.url, 5, live);
    const rec = recorder();
    const connection = await e.open({ sourceLang: "ko", targetLang: "vi", events: rec.events });
    const updates = () => server.received.filter((r) => r.type === "session.update") as unknown as SttUpdate[];
    await until(() => updates().some((u) => u.session.audio?.input["transcription"] !== undefined));
    expect(updates().at(-1)!.session.audio.input.transcription).toMatchObject({ model: "gpt-4o-mini-transcribe", language: "ko" });
    server.send({ type: "input_audio_buffer.committed", item_id: "item_r" });
    server.send({ type: "response.created", response: { id: "resp_r" } });
    server.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_r", transcript: "원문", usage: sttUsage });
    server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_r", delta: "번역" });
    server.send({ type: "response.done", response: { id: "resp_r", status: "completed", usage, output: [] } });
    await until(() => rec.ends.length === 1);
    await until(() => store.records.length === 2);
    expect(store.records.find((r) => r.kind === "stt")).toMatchObject({ model: "gpt-4o-mini-transcribe" });
    connection.close();
  });
});
