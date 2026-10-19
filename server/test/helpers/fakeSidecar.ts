import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData } from "ws";

// 가짜 노이즈 필터 사이드카 (docs/denoise-sidecar.md 규격의 웹소켓 서버, 비용 0)
//   받은 조각을 mode 에 따라 바꿔 받은 순서대로 1개씩 돌려준다 (실제 사이드카처럼 한 연결 안에서는 하나씩 차례로 처리)

export type FakeSidecarOptions = {
  /** invert: 부호 반전(결과가 원본과 구별됨), mute: 무음, echo: 그대로 */
  mode?: "invert" | "mute" | "echo";
  /** 연결별 i번째 조각 응답 지연 (ms). 함수면 (연결 번호, 조각 번호) → ms */
  delayMs?: number | ((connection: number, frame: number) => number);
  /** 연결별로 이만큼 받으면 연결을 끊는다 (응답하지 않고) */
  dropAfter?: number;
  /** 응답하지 않는다 */
  silent?: boolean;
  /** 응답마다 텍스트 프레임을 먼저 보낸다 (규격 밖 메시지를 무시하는지 확인용) */
  noiseText?: boolean;
};

export type FakeSidecar = {
  url: string;
  state: { connections: number; frames: number; closed: number; sizes: number[] };
  close(): Promise<void>;
};

export async function startFakeSidecar(options: FakeSidecarOptions = {}): Promise<FakeSidecar> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const state = { connections: 0, frames: 0, closed: 0, sizes: [] as number[] };
  wss.on("connection", (socket) => {
    const connection = state.connections++;
    let index = 0;
    let chain = Promise.resolve();
    socket.on("close", () => (state.closed += 1));
    socket.on("message", (data: RawData, isBinary) => {
      if (!isBinary) return;
      const frame = index++;
      state.frames += 1;
      const buf = data as Buffer;
      state.sizes.push(buf.byteLength);
      if (options.dropAfter !== undefined && index >= options.dropAfter) return void socket.terminate();
      if (options.silent) return;
      const samples = new Int16Array(buf.byteLength / 2);
      new Uint8Array(samples.buffer).set(buf);
      const mode = options.mode ?? "invert";
      const out = mode === "mute" ? new Int16Array(samples.length) : mode === "invert" ? samples.map((v) => -v) : samples;
      const delay = typeof options.delayMs === "function" ? options.delayMs(connection, frame) : (options.delayMs ?? 0);
      chain = chain.then(
        () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              if (socket.readyState === socket.OPEN) {
                if (options.noiseText) socket.send("noise");
                socket.send(Buffer.from(out.buffer));
              }
              resolve();
            }, delay),
          ),
      );
    });
  });
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

/** 아무것도 듣지 않는 주소 (연결 거부) */
export async function unusedUrl(): Promise<string> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const { port } = wss.address() as AddressInfo;
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  return `ws://127.0.0.1:${port}`;
}
