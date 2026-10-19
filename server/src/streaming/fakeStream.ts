import { randomUUID } from "node:crypto";
import type { Lang } from "../shared/languages";
import type { ContextLine, StreamConnection, StreamEngine, StreamEngineEvents, StreamOpenOptions } from "./engine";
import { rms } from "./resample";

// 테스트·개발용 가짜 스트리밍 엔진 (OpenAI 호출 없음, 비용 0). ENGINE=fake 서버에서 쓰인다.
// OpenAI server_vad 처럼 음량으로 말 끝을 판단한다: 말소리(RMS > threshold) 뒤 silenceMs 무음이면 턴 확정.
// 번역: "[대상언어] [음성 원문언어] 1.2s" 자막 + 말한 길이에 비례한 440Hz 톤 PCM 을 chunkMs 조각으로 흘려보낸다.

const RATE = 24_000;

export type FakeStreamOptions = {
  /** 말 끝 판단 무음 길이 (ms) */
  silenceMs?: number;
  /** 말소리 판단 RMS */
  threshold?: number;
  /** 말 끝 → 첫 조각까지 (ms) */
  firstChunkDelayMs?: number;
  /** 조각 간격 (ms). 0 이면 한 번에 */
  chunkIntervalMs?: number;
  /** 원문 전사가 오는 시점 (말 끝 기준 ms) */
  originalDelayMs?: number;
  /** 번역 음성 길이 = 말한 길이 × 이 값 */
  audioRatio?: number;
  /** n번째 턴(1부터, 연결마다 따로)을 실패시킨다 */
  failTurn?: (turn: number) => boolean;
  /** n번째 턴에서 첫 조각을 보낸 뒤 연결을 끊는다 (연결별) */
  dropOnTurn?: (turn: number, connection: number) => boolean;
  /** 열기 실패 (n번째 열기, 1부터) */
  failOpen?: (attempt: number) => boolean;
  /** n번째 턴에서 비용 한도 초과 */
  budgetOnTurn?: (turn: number) => boolean;
  /** 원문 전사 문장 */
  originalText?: (turn: number, lang: Lang, seconds: number) => string;
};

export type FakeConnectionRecord = {
  index: number;
  sourceLang: Lang;
  targetLang: Lang;
  appendedBytes: number;
  commits: number;
  contexts: ContextLine[][];
  closed: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 0.1초 단위 길이의 440Hz 톤 (재생 확인용으로 무음이 아닌 소리) */
function tone(seconds: number): Buffer {
  const samples = Math.max(1, Math.round(seconds * RATE));
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 6000), i * 2);
  return buffer;
}

export class FakeStreamEngine implements StreamEngine {
  readonly name = "fake-stream";
  readonly sampleRate = RATE;
  readonly connections: FakeConnectionRecord[] = [];
  private opens = 0;

  constructor(private readonly options: FakeStreamOptions = {}) {}

  async open({ sourceLang, targetLang, events }: StreamOpenOptions): Promise<StreamConnection> {
    this.opens += 1;
    if (this.options.failOpen?.(this.opens)) throw new Error("fake stream open failure");
    const record: FakeConnectionRecord = {
      index: this.connections.length + 1,
      sourceLang,
      targetLang,
      appendedBytes: 0,
      commits: 0,
      contexts: [],
      closed: false,
    };
    this.connections.push(record);
    return new FakeConnection(record, this.options, events);
  }
}

class FakeConnection implements StreamConnection {
  private speechMs = 0;
  private silenceMs = 0;
  private turns = 0;
  private dead = false;

  constructor(
    private readonly record: FakeConnectionRecord,
    private readonly options: FakeStreamOptions,
    private readonly events: StreamEngineEvents,
  ) {}

  append(pcm: Buffer): void {
    if (this.dead) return;
    this.record.appendedBytes += pcm.length;
    const ms = (pcm.length / 2 / RATE) * 1000;
    if (rms(pcm) > (this.options.threshold ?? 300)) {
      this.speechMs += ms;
      this.silenceMs = 0;
    } else if (this.speechMs > 0) {
      this.silenceMs += ms;
      if (this.silenceMs >= (this.options.silenceMs ?? 500)) this.endTurn();
    }
  }

  commit(): void {
    // stream:pause 는 "보내기 중단" 뜻 — 말 끝은 무음(silenceMs)으로만 판단한다 (OpenAI 구현과 같은 의미)
    if (this.dead) return;
    this.record.commits += 1;
  }

  setContext(lines: ContextLine[]): void {
    this.record.contexts.push(lines.map((line) => ({ ...line })));
  }

  close(): void {
    this.dead = true;
    this.record.closed = true;
  }

  private endTurn(): void {
    const seconds = this.speechMs / 1000;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.turns += 1;
    void this.runTurn(this.turns, seconds);
  }

  private async runTurn(turn: number, seconds: number): Promise<void> {
    const { options, events, record } = this;
    const turnId = randomUUID();
    const { sourceLang, targetLang } = record;
    events.turnStart(turnId);
    if (options.budgetOnTurn?.(turn)) {
      events.turnEnd(turnId, { status: "failed", code: "BUDGET_EXCEEDED" });
      this.dead = true;
      events.closed("budget");
      return;
    }
    await sleep(options.firstChunkDelayMs ?? 50);
    if (this.dead) return;

    const original = options.originalText?.(turn, sourceLang, seconds) ?? `[음성 ${sourceLang}] ${seconds.toFixed(1)}s`;
    const translation = `[${targetLang}] ${original}`;
    const audio = tone(seconds * (options.audioRatio ?? 1));
    const chunkBytes = Math.round(RATE * 0.1) * 2;
    const originalAt = options.originalDelayMs ?? 0;
    let originalSent = false;
    const sendOriginal = () => {
      if (originalSent) return;
      originalSent = true;
      // 받아쓰기 조각(앞 절반) → 완성본 (OpenAI 의 ...transcription.delta → completed 순서)
      events.originalDelta(turnId, original.slice(0, Math.ceil(original.length / 2)));
      events.original(turnId, original);
    };
    if (originalAt === 0) sendOriginal();

    const words = translation.split(" ");
    let chunk = 0;
    for (let offset = 0; offset < audio.length; offset += chunkBytes, chunk++) {
      if (this.dead) return;
      events.audio(turnId, audio.subarray(offset, offset + chunkBytes));
      const word = words[chunk];
      if (word !== undefined) events.translationDelta(turnId, chunk === 0 ? word : ` ${word}`);
      if (chunk === 0 && options.dropOnTurn?.(turn, record.index)) {
        // OpenAI 세션이 응답 도중 끊긴 상황 (S0 1-6절)
        this.dead = true;
        events.closed("error");
        return;
      }
      if (options.chunkIntervalMs) await sleep(options.chunkIntervalMs);
    }
    const rest = words.slice(chunk);
    if (rest.length > 0) events.translationDelta(turnId, ` ${rest.join(" ")}`);
    if (originalAt > 0) await sleep(originalAt);
    if (this.dead) return;
    sendOriginal();
    if (options.failTurn?.(turn)) {
      events.turnEnd(turnId, { status: "failed", code: "TRANSLATION_FAILED" });
      return;
    }
    events.turnEnd(turnId, { status: "done", original, translation, model: "fake-stream" });
  }
}

