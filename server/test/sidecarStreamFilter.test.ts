import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type RawData } from "ws";
import { SidecarStreamFilter } from "../src/engine/audio/sidecarStreamFilter";
import type { StreamFilterContext } from "../src/engine/audio/streamAudioFilter";

// 노이즈 필터 사이드카 연결 (docs/denoise-sidecar.md): 웹소켓 1개당 스트림 1개, 3,200바이트 조각을 순서대로 주고받는다.
// 가짜 사이드카(로컬 웹소켓 서버)로 확인한다 (비용 0).

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const CONTEXT: StreamFilterContext = { siteId: "site", userId: "user", lang: "vi", sampleRate: 16_000 };

/** 가짜 사이드카: 받은 조각의 부호를 뒤집어 돌려준다. delays[i] 만큼 i번째 응답을 늦춘다 */
async function fakeSidecar(delays: number[] = []) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const state = { connections: 0, frames: 0 };
  wss.on("connection", (socket) => {
    state.connections += 1;
    let index = 0;
    let chain = Promise.resolve();
    socket.on("message", (data: RawData) => {
      const i = index++;
      state.frames += 1;
      const buf = data as Buffer;
      const samples = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const out = Buffer.from(samples.map((v) => -v).buffer);
      chain = chain.then(() => new Promise((resolve) => setTimeout(() => (socket.send(out), resolve()), delays[i] ?? 0)));
    });
  });
  closers.push(
    () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  );
  return { url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, state };
}

const frame = (value: number) => new Int16Array(1_600).fill(value);

describe("SidecarStreamFilter (노이즈 필터 사이드카 연결)", () => {
  it("조각을 보내고 처리된 같은 길이 조각을 순서대로 받는다, 스트림마다 연결 1개, close 로 닫는다", async () => {
    const sidecar = await fakeSidecar();
    const filter = new SidecarStreamFilter(sidecar.url);
    expect(filter.name).toBe("sidecar");
    const session = filter.open(CONTEXT);
    const outs = await Promise.all([1, 2, 3].map((v) => session.process(frame(v))));
    expect(outs.map((o) => [o.length, o[0]])).toEqual([
      [1_600, -1],
      [1_600, -2],
      [1_600, -3],
    ]);
    expect(sidecar.state.connections).toBe(1);
    session.close?.();
  });

  it("응답이 시간 안에 안 오면 그 조각은 실패로 끝내고, 늦게 온 응답은 버려 다음 조각과 섞이지 않는다", async () => {
    const sidecar = await fakeSidecar([0, 120, 0]);
    const session = new SidecarStreamFilter(sidecar.url, { responseTimeoutMs: 40 }).open(CONTEXT);
    expect((await session.process(frame(6)))[0]).toBe(-6); // 연결이 열린 뒤
    await expect(session.process(frame(7))).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 120)); // 늦은 응답(-7)이 도착할 때까지
    // 늦은 응답(-7)은 버리고, 다음 조각은 자기 응답(-8)을 받는다
    const second = await session.process(frame(8));
    expect(second[0]).toBe(-8);
    session.close?.();
  });

  it("16kHz 가 아니면 열지 않는다 (규격은 16kHz)", () => {
    expect(() => new SidecarStreamFilter("ws://127.0.0.1:9").open({ ...CONTEXT, sampleRate: 24_000 })).toThrow();
  });

  it("사이드카에 연결할 수 없으면 조각 처리는 바로 실패한다 (서버는 원본 사용)", async () => {
    const session = new SidecarStreamFilter("ws://127.0.0.1:9", { responseTimeoutMs: 40 }).open(CONTEXT);
    await expect(session.process(frame(1))).rejects.toThrow();
    session.close?.();
  });
});
