import { afterEach, describe, expect, it } from "vitest";
import { SidecarStreamFilter } from "../src/engine/audio/sidecarStreamFilter";
import { DEFAULT_STREAM_FILTER_OPTIONS, SafeStreamFilter, type StreamFilterContext, type StreamFilterOptions } from "../src/engine/audio/streamAudioFilter";
import { createStreamAudioFilter } from "../src/plugins/streamAudioFilter";
import { startFakeSidecar, unusedUrl, type FakeSidecarOptions } from "./helpers/fakeSidecar";

// 노이즈 필터 사이드카 연결 (docs/denoise-sidecar.md 4절): 스트림 1개당 웹소켓 1개, 3,200바이트 조각을 순서대로 주고받는다.
// 가짜 사이드카(로컬 웹소켓 서버)로 확인한다 (비용 0). 통화 전체 경로는 integration/streaming.test.ts

const CONTEXT: StreamFilterContext = { siteId: "site", userId: "user", lang: "vi", sampleRate: 16_000 };
const SAMPLES = 1_600; // 100ms

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function sidecar(options: FakeSidecarOptions = {}) {
  const fake = await startFakeSidecar(options);
  closers.push(fake.close);
  return fake;
}

const frame = (value: number) => new Int16Array(SAMPLES).fill(value);
const frameBuffer = (value: number) => Buffer.from(frame(value).buffer);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 서버와 같은 안전 장치(SafeStreamFilter)로 조각 1..count 를 흘려 보내고, 전달된 조각의 첫 표본과 실패 이유를 모은다 */
async function runThroughSafeFilter(url: string, count: number, options: StreamFilterOptions = DEFAULT_STREAM_FILTER_OPTIONS) {
  const failures: string[] = [];
  const safe = new SafeStreamFilter(new SidecarStreamFilter(url), CONTEXT, options, (reason) => failures.push(reason));
  const delivered: number[] = [];
  const sizes = new Set<number>();
  for (let v = 1; v <= count; v++) {
    safe.push(frameBuffer(v), (out) => {
      sizes.add(out.byteLength);
      delivered.push(out.readInt16LE(0));
    });
  }
  await new Promise<void>((resolve) => safe.after(resolve));
  safe.close();
  return { delivered, failures, sizes, stats: safe.stats };
}

describe("SidecarStreamFilter (노이즈 필터 사이드카 연결)", () => {
  it("플러그인 이름 sidecar 로 만들 수 있다", () => {
    expect(createStreamAudioFilter("sidecar").name).toBe("sidecar");
  });

  it("연결 전에 온 조각도 기다렸다가 보내고, 같은 길이 조각을 순서대로 받는다 (스트림마다 연결 1개)", async () => {
    const fake = await sidecar();
    const session = new SidecarStreamFilter(fake.url).open(CONTEXT);
    const outs = await Promise.all([1, 2, 3].map((v) => session.process(frame(v)))); // open 직후 = 아직 연결 전
    expect(outs.map((o) => [o.length, o[0], o[SAMPLES - 1]])).toEqual([
      [SAMPLES, -1, -1],
      [SAMPLES, -2, -2],
      [SAMPLES, -3, -3],
    ]);
    expect(fake.state).toMatchObject({ connections: 1, frames: 3, sizes: [3_200, 3_200, 3_200] });
    session.close?.();
  });

  it("스트림마다 따로 연결하고, close 하면 연결을 닫는다", async () => {
    const fake = await sidecar();
    const filter = new SidecarStreamFilter(fake.url);
    const a = filter.open(CONTEXT);
    const b = filter.open(CONTEXT);
    expect((await a.process(frame(4)))[0]).toBe(-4);
    expect((await b.process(frame(5)))[0]).toBe(-5);
    expect(fake.state.connections).toBe(2);
    a.close?.();
    b.close?.();
    await sleep(50);
    expect(fake.state.closed).toBe(2);
  });

  it("텍스트 프레임은 응답으로 세지 않는다", async () => {
    const fake = await sidecar({ noiseText: true });
    const session = new SidecarStreamFilter(fake.url).open(CONTEXT);
    const outs = await Promise.all([1, 2].map((v) => session.process(frame(v))));
    expect(outs.map((o) => o[0])).toEqual([-1, -2]);
    session.close?.();
  });

  it("16kHz 가 아니면 열지 않는다 (서버는 그 통화에서 필터 없이 계속)", () => {
    expect(() => new SidecarStreamFilter("ws://127.0.0.1:9").open({ ...CONTEXT, sampleRate: 24_000 })).toThrow(/16000Hz/);
  });

  it("응답을 기다리는 조각이 maxInFlight 이면 새 조각은 보내지 않고 바로 실패한다", async () => {
    const fake = await sidecar({ silent: true });
    const session = new SidecarStreamFilter(fake.url, { maxInFlight: 2 }).open(CONTEXT);
    const pending = [session.process(frame(1)), session.process(frame(2))];
    await expect(session.process(frame(3))).rejects.toThrow(/밀림/);
    session.close?.();
    await expect(Promise.all(pending)).rejects.toThrow(/닫음/); // 닫으면 기다리던 조각도 실패
    expect(fake.state.frames).toBeLessThanOrEqual(2);
  });

  it("close 뒤의 조각은 바로 실패한다", async () => {
    const fake = await sidecar();
    const session = new SidecarStreamFilter(fake.url).open(CONTEXT);
    await session.process(frame(1));
    session.close?.();
    await expect(session.process(frame(2))).rejects.toThrow();
  });
});

describe("SafeStreamFilter 닫기", () => {
  it("응답을 기다리는 조각이 있을 때 스트림을 닫으면 실패로 세지 않는다 (닫힌 스트림의 거짓 경고 없음)", async () => {
    const fake = await sidecar({ delayMs: 30 });
    const failures: string[] = [];
    const safe = new SafeStreamFilter(new SidecarStreamFilter(fake.url), CONTEXT, DEFAULT_STREAM_FILTER_OPTIONS, (reason) => failures.push(reason));
    safe.push(frameBuffer(1), () => {});
    await sleep(15); // 첫 조각이 사이드카 응답을 기다리는 중
    safe.close();
    await sleep(60);
    expect(failures).toEqual([]);
    expect(safe.stats.failed).toBe(0);
  });
});

describe("SidecarStreamFilter + SafeStreamFilter (서버 안전 장치와 함께)", () => {
  it("모든 조각이 사이드카를 거쳐 순서대로 전달된다", async () => {
    const fake = await sidecar();
    const { delivered, failures, sizes, stats } = await runThroughSafeFilter(fake.url, 10);
    expect(delivered).toEqual([-1, -2, -3, -4, -5, -6, -7, -8, -9, -10]);
    expect(failures).toEqual([]);
    expect(sizes).toEqual(new Set([3_200]));
    expect(stats).toEqual({ frames: 10, filtered: 10, failed: 0, disabled: false });
  });

  it("시간 초과로 원본을 쓴 조각의 늦은 응답은 버리고, 다음 조각은 자기 응답을 받는다", async () => {
    // 3번째 조각만 응답이 늦다 (150ms > 제한 100ms). 4번째 조각은 3번째 늦은 응답 뒤에 오지만 제한 안
    const fake = await sidecar({ delayMs: (_c, i) => (i === 2 ? 150 : 0) });
    const { delivered, failures } = await runThroughSafeFilter(fake.url, 6, { frameBudgetMs: 100, maxConsecutiveFailures: 5 });
    // 3 = 원본(시간 초과). 4번째가 3번째의 늦은 응답(-3)을 받았다면 -3 이 두 번 나온다
    expect(delivered).toEqual([-1, -2, 3, -4, -5, -6]);
    expect(failures).toEqual(["timeout"]);
  });

  it("응답이 계속 늦으면 연속 5번 실패로 그 통화에서 필터를 끄고 연결을 닫는다 (이후 조각은 원본, 순서 유지)", async () => {
    const fake = await sidecar({ delayMs: 200 });
    const { delivered, failures, stats } = await runThroughSafeFilter(fake.url, 8);
    expect(delivered).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(failures).toEqual(["timeout", "timeout", "timeout", "timeout", "timeout", "disabled"]);
    expect(stats).toMatchObject({ frames: 5, filtered: 0, failed: 5, disabled: true });
    expect(fake.state.frames).toBe(5); // 꺼진 뒤에는 보내지 않는다
    await sleep(50);
    expect(fake.state.closed).toBe(1);
  });

  it("사이드카가 통화 중 연결을 끊으면 바로 원본으로 넘기고, 연속 5번 실패로 끈다", async () => {
    const fake = await sidecar({ dropAfter: 3 });
    const started = Date.now();
    const { delivered, failures } = await runThroughSafeFilter(fake.url, 10);
    expect(delivered).toEqual([-1, -2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(failures.at(-1)).toBe("disabled");
    expect(failures.filter((f) => f !== "disabled")).toHaveLength(5);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("사이드카에 연결할 수 없으면 원본으로 통화를 계속하고 연속 5번 실패로 끈다", async () => {
    const { delivered, failures } = await runThroughSafeFilter(await unusedUrl(), 7);
    expect(delivered).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(failures).toEqual(["error", "error", "error", "error", "error", "disabled"]);
  });
});
