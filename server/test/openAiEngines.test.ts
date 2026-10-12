import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { BudgetExceededError, BudgetGuard, InMemoryUsageStore } from "../src/engine/budget/budgetGuard";
import { DEFAULT_PRICING } from "../src/engine/budget/pricing";
import { OpenAiStt } from "../src/engine/stt/openAiStt";
import { buildInstructions, RealtimeTranslator } from "../src/engine/translation/realtimeTranslator";

// 실제 OpenAI 엔진의 프로토콜 처리 검증 (로컬 가짜 서버, 비용 없음).
// 이벤트 이름·필드는 2026-10-12 OpenAI 공식 문서(GA Realtime, audio/transcriptions) 기준.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const budget = (limitUsd = 5) => {
  const store = new InMemoryUsageStore();
  return { store, guard: new BudgetGuard(store, DEFAULT_PRICING, { limitUsd, period: "total" }) };
};

/** Realtime 가짜 서버: 받은 이벤트를 기록하고, response.create 에 script 이벤트로 답한다 */
async function fakeRealtime(script: (send: (event: object) => void, socket: WebSocket) => void) {
  const received: { type: string; [key: string]: unknown }[] = [];
  let headers: IncomingMessage["headers"] = {};
  let url = "";
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket, req) => {
    headers = req.headers;
    url = req.url ?? "";
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      received.push(event);
      if (event.type === "response.create") script((e) => socket.send(JSON.stringify(e)), socket);
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
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/realtime`, received, headers: () => headers, path: () => url };
}

const context = { terms: [{ source: "데스라", target: "lan can", meaning: "난간" }] };

describe("RealtimeTranslator (gpt-realtime-2.1)", () => {
  it("GA 세션 설정 → 텍스트 입력 → 음성 델타·전사·사용량을 모아 돌려주고 비용을 기록한다", async () => {
    const pcm = Buffer.alloc(960, 1);
    const server = await fakeRealtime((send) => {
      send({ type: "response.output_audio.delta", delta: pcm.subarray(0, 480).toString("base64") });
      send({ type: "response.output_audio_transcript.delta", delta: "Hãy lắp " });
      send({ type: "response.output_audio.delta", delta: pcm.subarray(480).toString("base64") });
      send({ type: "response.output_audio_transcript.done", transcript: "Hãy lắp lan can." });
      send({
        type: "response.done",
        response: {
          status: "completed",
          usage: {
            input_token_details: { text_tokens: 300, audio_tokens: 0, cached_tokens: 100 },
            output_token_details: { text_tokens: 20, audio_tokens: 200 },
          },
        },
      });
    });
    const { store, guard } = budget();
    const translator = new RealtimeTranslator({ apiKey: "sk-test", model: "gpt-realtime-2.1", voice: "marin", reasoning: "low", budget: guard, url: server.url });

    const out = await translator.translate({ text: "데스라 먼저 설치하세요", sourceLang: "ko", targetLang: "vi", context, withAudio: true });
    expect(out.text).toBe("Hãy lắp lan can.");
    expect(out.audio).toEqual({ data: pcm, sampleRate: 24_000 });
    expect(out.usage).toEqual({ inputTextTokens: 200, inputAudioTokens: 0, cachedInputTokens: 100, outputTextTokens: 20, outputAudioTokens: 200 });

    // 요청 형식
    expect(server.headers().authorization).toBe("Bearer sk-test");
    expect(server.headers()["openai-beta"]).toBeUndefined();
    expect(server.path()).toContain("model=gpt-realtime-2.1");
    const [update, item, create] = server.received;
    expect(update).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        audio: { input: { turn_detection: null }, output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" } },
        reasoning: { effort: "low" },
      },
    });
    expect((update as unknown as { session: { instructions: string } }).session.instructions).toContain("데스라 → lan can: 난간");
    expect(item).toEqual({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: "데스라 먼저 설치하세요" }] },
    });
    expect(create).toEqual({ type: "response.create" });

    // 비용 기록: (200×4 + 100×0.4 + 20×24 + 200×64) / 1M
    expect(store.records).toHaveLength(1);
    expect(store.records[0]!.costUsd).toBeCloseTo((200 * 4 + 100 * 0.4 + 20 * 24 + 200 * 64) / 1e6, 9);
  });

  it("음성 끄기: output_modalities=[text], 텍스트 이벤트로 번역문을 받는다", async () => {
    const server = await fakeRealtime((send) => {
      send({ type: "response.output_text.done", text: "Остановите работу." });
      send({ type: "response.done", response: { status: "completed", usage: {} } });
    });
    const translator = new RealtimeTranslator({ apiKey: "k", model: "gpt-realtime-2.1", voice: "marin", reasoning: "low", budget: budget().guard, url: server.url });
    const out = await translator.translate({ text: "작업 중지", sourceLang: "ko", targetLang: "ru", context: { terms: [] }, withAudio: false });
    expect(out).toMatchObject({ text: "Остановите работу." });
    expect(out.audio).toBeUndefined();
    expect(server.received[0]).toMatchObject({ session: { output_modalities: ["text"] } });
  });

  it("error 이벤트·실패 응답·시간 초과는 오류로 끝나고, 예약한 비용은 기록하지 않는다", async () => {
    const cases: [string, (send: (e: object) => void) => void, RegExp][] = [
      ["error", (send) => send({ type: "error", error: { code: "invalid_value", message: "bad" } }), /invalid_value bad/],
      ["failed", (send) => send({ type: "response.done", response: { status: "failed", status_details: { error: { message: "server_error" } } } }), /server_error/],
      ["timeout", () => undefined, /시간 초과/],
    ];
    for (const [, script, pattern] of cases) {
      const server = await fakeRealtime(script);
      const { store, guard } = budget();
      const translator = new RealtimeTranslator({ apiKey: "k", model: "gpt-realtime-2.1", voice: "marin", reasoning: "low", budget: guard, url: server.url, timeoutMs: 300 });
      await expect(translator.translate({ text: "가", sourceLang: "ko", targetLang: "vi", context: { terms: [] }, withAudio: true })).rejects.toThrow(pattern);
      expect(store.records).toHaveLength(0);
      expect((await guard.status()).reservedUsd).toBe(0);
    }
  });

  it("비용 한도를 넘으면 OpenAI 에 연결하지 않는다", async () => {
    const server = await fakeRealtime(() => undefined);
    const translator = new RealtimeTranslator({ apiKey: "k", model: "gpt-realtime-2.1", voice: "marin", reasoning: "low", budget: budget(0.000001).guard, url: server.url });
    await expect(translator.translate({ text: "가", sourceLang: "ko", targetLang: "vi", context: { terms: [] }, withAudio: true })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(server.received).toHaveLength(0);
  });

  it("지시문: 번역문만 말하도록 하고, 검증 문장이 있으면 그대로 쓰게 한다", () => {
    const text = buildInstructions("ko", "uz", { terms: [], phrase: { source: "a", target: "Avval panjara o'rnating." } });
    expect(text).toContain("into Uzbek");
    expect(text).toContain("Speak ONLY the Uzbek translation");
    expect(text).toContain('"Avval panjara o\'rnating."');
  });
});

describe("OpenAiStt (gpt-4o-mini-transcribe)", () => {
  async function fakeTranscriptions(status: number, body: object) {
    let form: FormData | undefined;
    let auth = "";
    const server = createServer(async (req, res) => {
      auth = req.headers.authorization ?? "";
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"]! } }).formData();
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => new Promise((resolve) => server.close(() => resolve())));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/audio/transcriptions`, form: () => form!, auth: () => auth };
  }

  const audio = { data: new Int16Array(16_000), sampleRate: 16_000 };

  it("WAV 로 올리고 language·prompt·json 형식을 보내며, 토큰 사용량으로 비용을 기록한다", async () => {
    const server = await fakeTranscriptions(200, {
      text: " 안전모 착용하세요 ",
      usage: { type: "tokens", input_tokens: 60, output_tokens: 8, input_token_details: { audio_tokens: 50, text_tokens: 10 } },
    });
    const { store, guard } = budget();
    const stt = new OpenAiStt("sk-test", "gpt-4o-mini-transcribe", guard, server.url);
    const out = await stt.transcribe({ audio, lang: "vi", prompt: "Workplace speech." });
    expect(out.text).toBe("안전모 착용하세요");
    expect(out.usage).toEqual({ inputAudioTokens: 50, inputTextTokens: 10, outputTextTokens: 8 });

    const form = server.form();
    expect(server.auth()).toBe("Bearer sk-test");
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("vi");
    expect(form.get("prompt")).toBe("Workplace speech.");
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file") as File;
    expect(file.name).toBe("speech.wav");
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString()).toBe("RIFF");
    expect(store.records[0]).toMatchObject({ kind: "stt", model: "gpt-4o-mini-transcribe" });
    expect(store.records[0]!.costUsd).toBeCloseTo((50 * 1.25 + 10 * 1.25 + 8 * 5) / 1e6, 9);
  });

  it("우즈베크어는 language 코드를 받지 않으므로 빼고 프롬프트로 언어를 알려 준다", async () => {
    const server = await fakeTranscriptions(200, { text: "Dubulg'a kiying" });
    const { guard } = budget();
    const stt = new OpenAiStt("k", "gpt-4o-mini-transcribe", guard, server.url);
    await stt.transcribe({ audio, lang: "uz", prompt: "Workplace speech." });
    expect(server.form().get("language")).toBeNull();
    expect(server.form().get("prompt")).toBe("The speaker speaks Uzbek. Transcribe in Uzbek (Latin script). Workplace speech.");
  });

  it("HTTP 오류는 응답 내용과 함께 실패하고 비용은 기록하지 않는다", async () => {
    const server = await fakeTranscriptions(400, { error: { message: "Unsupported language" } });
    const { store, guard } = budget();
    const stt = new OpenAiStt("k", "gpt-4o-mini-transcribe", guard, server.url);
    await expect(stt.transcribe({ audio, lang: "uz" })).rejects.toThrow(/400.*Unsupported language/);
    expect(store.records).toHaveLength(0);
  });
});
