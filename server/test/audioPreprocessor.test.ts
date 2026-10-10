import { describe, expect, it, vi } from "vitest";
import {
  PassthroughPreprocessor,
  runPreprocessorSafely,
  type AudioPreprocessor,
  type PcmAudio,
} from "../src/engine/audio/audioPreprocessor";
import { createAudioPreprocessor } from "../src/plugins/audioPreprocessor";

const audio: PcmAudio = { data: new Int16Array([1, -2, 3]), sampleRate: 16000 };
const context = { siteId: "s", userId: "u", lang: "ko" as const };

describe("노이즈 필터 플러그인", () => {
  it("기본 passthrough는 입력을 그대로 돌려준다", async () => {
    const result = await runPreprocessorSafely(createAudioPreprocessor("passthrough"), audio, context, { timeoutMs: 100 });
    expect(result).toMatchObject({ audio, applied: true });
  });

  it("등록된 필터의 출력을 사용한다", async () => {
    const halve: AudioPreprocessor = {
      name: "halve",
      process: async (input) => ({ ...input, data: input.data.map((sample) => sample / 2) }),
    };
    const result = await runPreprocessorSafely(halve, { ...audio, data: new Int16Array([4, -8]) }, context, { timeoutMs: 100 });
    expect(Array.from(result.audio.data)).toEqual([2, -4]);
  });

  it("필터가 오류를 내면 원본으로 진행한다", async () => {
    const onFallback = vi.fn();
    const broken: AudioPreprocessor = { name: "broken", process: async () => { throw new Error("model crashed"); } };
    const result = await runPreprocessorSafely(broken, audio, context, { timeoutMs: 100, onFallback });
    expect(result).toMatchObject({ audio, applied: false, fallbackReason: "error" });
    expect(onFallback).toHaveBeenCalledWith("error", expect.any(Error));
  });

  it("시간 초과면 원본으로 진행한다", async () => {
    const slow: AudioPreprocessor = { name: "slow", process: () => new Promise(() => undefined) };
    const result = await runPreprocessorSafely(slow, audio, context, { timeoutMs: 20 });
    expect(result).toMatchObject({ audio, applied: false, fallbackReason: "timeout" });
  });

  it("잘못된 출력이면 원본으로 진행한다", async () => {
    const invalid = { name: "invalid", process: async () => ({ data: [1, 2], sampleRate: 16000 }) } as unknown as AudioPreprocessor;
    const result = await runPreprocessorSafely(invalid, audio, context, { timeoutMs: 100 });
    expect(result).toMatchObject({ applied: false, fallbackReason: "invalid_output" });
  });

  it("알 수 없는 이름은 시작 시 실패한다", () => {
    expect(new PassthroughPreprocessor().name).toBe("passthrough");
    expect(() => createAudioPreprocessor("dl-noise-filter")).toThrow(/AUDIO_PREPROCESSOR/);
  });
});
