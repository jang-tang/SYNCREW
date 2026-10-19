import WebSocket from "ws";
import type { StreamAudioFilter, StreamFilterContext, StreamFilterSession } from "./streamAudioFilter";

// 노이즈 필터 사이드카 연결 (규격: docs/denoise-sidecar.md, 2026-10-19)
//   - 스트림(화자 1명의 통화 1개)마다 웹소켓 1개를 열고, PCM16 mono 16kHz 100ms 조각(3,200바이트)을 바이너리로 보낸다
//   - 사이드카는 같은 길이 조각을 받은 순서대로 돌려준다 (순번이 없으므로 순서로 짝을 맞춘다)
//   - 응답이 시간 안에 안 오면 그 조각은 실패(서버가 원본 사용)로 끝내고, 나중에 도착한 그 응답은 버린다
//     → 다음 조각이 앞 조각의 늦은 응답을 받는 일이 없다
//   - 연결 실패·끊김이면 이후 조각은 바로 실패 → SafeStreamFilter 가 원본을 쓰고 연속 5번이면 그 통화에서 끈다

export type SidecarFilterOptions = {
  /** 조각 1개 응답 대기 (ms). SafeStreamFilter 의 조각당 제한(50ms)보다 조금 짧게 */
  responseTimeoutMs: number;
};

const DEFAULT_OPTIONS: SidecarFilterOptions = { responseTimeoutMs: 45 };
const SAMPLE_RATE = 16_000;

export class SidecarStreamFilter implements StreamAudioFilter {
  readonly name = "sidecar";

  constructor(
    private readonly url: string,
    private readonly options: SidecarFilterOptions = DEFAULT_OPTIONS,
  ) {}

  open(context: StreamFilterContext): StreamFilterSession {
    if (context.sampleRate !== SAMPLE_RATE) {
      throw new Error(`노이즈 필터 사이드카는 ${SAMPLE_RATE}Hz 만 받는다 (받은 값 ${context.sampleRate}Hz)`);
    }
    return new SidecarSession(this.url, this.options.responseTimeoutMs);
  }
}

type Pending = {
  resolve: (frame: Int16Array) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  sent: boolean;
};

class SidecarSession implements StreamFilterSession {
  private readonly ws: WebSocket;
  private readonly ready: Promise<void>;
  /** 보낸 순서대로 응답을 기다리는 조각 (보내기 전 연결을 기다리는 조각 포함) */
  private pending: Pending[] = [];
  /** 시간 초과로 포기한 조각의 늦은 응답 수 — 도착하면 버린다 */
  private dropLate = 0;
  private dead: Error | null = null;

  constructor(
    url: string,
    private readonly timeoutMs: number,
  ) {
    this.ws = new WebSocket(url);
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.ready.catch(() => {});
    this.ws.on("message", (data, isBinary) => this.onMessage(data, isBinary));
    this.ws.on("error", (error) => this.die(error));
    this.ws.on("close", () => this.die(new Error("노이즈 필터 사이드카 연결 끊김")));
  }

  process(frame: Int16Array): Promise<Int16Array> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise<Int16Array>((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        sent: false,
        timer: setTimeout(() => {
          const index = this.pending.indexOf(entry);
          if (index >= 0) this.pending.splice(index, 1);
          if (entry.sent) this.dropLate += 1;
          reject(new Error("노이즈 필터 사이드카 응답 시간 초과"));
        }, this.timeoutMs),
      };
      this.pending.push(entry);
      const send = () => {
        if (this.dead || !this.pending.includes(entry)) return;
        this.ws.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
        entry.sent = true;
      };
      if (this.ws.readyState === WebSocket.OPEN) send();
      else this.ready.then(send, () => {});
    });
  }

  close(): void {
    this.die(new Error("노이즈 필터 사이드카 연결 닫음"));
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    else if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
  }

  private onMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (!isBinary) return; // 규격상 텍스트 프레임은 없다
    if (this.dropLate > 0) {
      this.dropLate -= 1;
      return;
    }
    const entry = this.pending.shift();
    if (!entry) return;
    clearTimeout(entry.timer);
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
    const even = buf.byteLength - (buf.byteLength % 2);
    entry.resolve(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + even)));
  }

  private die(error: Error): void {
    if (this.dead) return;
    this.dead = error;
    for (const entry of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending = [];
  }
}
