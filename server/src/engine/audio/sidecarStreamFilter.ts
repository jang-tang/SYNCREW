import WebSocket from "ws";
import type { StreamAudioFilter, StreamFilterContext, StreamFilterSession } from "./streamAudioFilter";

// 노이즈 필터 사이드카 연결 (규격: docs/denoise-sidecar.md, 2026-10-19)
//   - 스트림(화자 1명의 통화 1개)마다 웹소켓 1개를 열고, PCM16 mono 16kHz 100ms 조각(3,200바이트)을 바이너리 프레임으로 보낸다
//   - 사이드카는 받은 순서대로 정확히 1개씩 응답한다 → 순번 없이 "보낸 순서 = 응답 순서"로 짝을 맞춘다
//   - 시간 제한(50ms)·연속 실패 끄기는 SafeStreamFilter 가 맡는다. 여기서는 시간을 재지 않는다
//
// 늦은 응답 버리기 (응답 수 대조 방식):
//   시간 초과로 서버가 원본을 쓴 조각도 대기열에서 빼지 않는다. 그 조각의 응답이 늦게 오면 대기열 맨 앞인
//   그 조각 자리에 채워지고, 결과는 이미 아무도 기다리지 않으므로 버려진다. 다음 조각은 항상 자기 응답을 받는다.
//   연결을 다시 맺지 않으므로 사이드카의 잡음 추정 상태(GTCRN 스트리밍 캐시)도 유지된다.
//   대신 늦은 응답이 남아 있는 동안 다음 조각 응답도 그만큼 늦는다 — 계속 밀리면 연속 5번 실패로 그 통화에서 꺼진다.
//
// 연결 전에 온 조각은 연결을 기다렸다가 순서대로 보낸다 (compose 내부망에서는 보통 첫 조각 전에 열린다).
// 연결 실패·끊김이면 기다리던 조각과 이후 조각은 모두 바로 실패 → 서버는 원본을 쓰고, 연속 5번이면 그 통화에서 끈다.

export type SidecarFilterOptions = {
  /** 응답을 기다리는 조각이 이만큼이면 새 조각은 보내지 않고 바로 실패 (사이드카가 멈췄을 때 쌓이지 않게) */
  maxInFlight: number;
};

export const DEFAULT_SIDECAR_FILTER_OPTIONS: SidecarFilterOptions = { maxInFlight: 8 };

/** 규격상 사이드카는 16kHz 만 받는다 */
const SAMPLE_RATE = 16_000;

export class SidecarStreamFilter implements StreamAudioFilter {
  readonly name = "sidecar";

  constructor(
    private readonly url: string,
    private readonly options: SidecarFilterOptions = DEFAULT_SIDECAR_FILTER_OPTIONS,
  ) {}

  open(context: StreamFilterContext): StreamFilterSession {
    // 던지면 SafeStreamFilter 가 그 스트림에서 필터를 끄고 원본으로 계속한다
    if (context.sampleRate !== SAMPLE_RATE) {
      throw new Error(`노이즈 필터 사이드카는 ${SAMPLE_RATE}Hz 만 받는다 (받은 값 ${context.sampleRate}Hz)`);
    }
    return new SidecarSession(this.url, this.options.maxInFlight);
  }
}

type Waiter = { resolve: (frame: Int16Array) => void; reject: (error: Error) => void };

class SidecarSession implements StreamFilterSession {
  private readonly ws: WebSocket;
  /** 보낸(또는 연결을 기다리는) 순서대로 응답을 기다리는 조각. 다음 응답의 주인은 항상 맨 앞 */
  private waiting: Waiter[] = [];
  /** 연결이 열리기 전에 온 조각 (열리면 순서대로 보낸다) */
  private unsent: Buffer[] = [];
  private failure: Error | null = null;

  constructor(
    url: string,
    private readonly maxInFlight: number,
  ) {
    this.ws = new WebSocket(url, { perMessageDeflate: false });
    this.ws.on("open", () => {
      const queued = this.unsent;
      this.unsent = [];
      for (const bytes of queued) this.send(bytes);
    });
    this.ws.on("message", (data, isBinary) => this.onMessage(data, isBinary));
    this.ws.on("error", (error) => this.fail(new Error(`노이즈 필터 사이드카 연결 오류: ${error.message}`)));
    this.ws.on("close", () => this.fail(new Error("노이즈 필터 사이드카 연결 끊김")));
  }

  process(frame: Int16Array): Promise<Int16Array> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.waiting.length >= this.maxInFlight) {
      return Promise.reject(new Error(`노이즈 필터 사이드카 응답 밀림 (대기 ${this.waiting.length}개)`));
    }
    const bytes = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    return new Promise<Int16Array>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      if (this.ws.readyState === WebSocket.OPEN) this.send(bytes);
      else this.unsent.push(bytes);
    });
  }

  close(): void {
    this.fail(new Error("노이즈 필터 사이드카 연결 닫음"));
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close(1000);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
  }

  private send(bytes: Buffer): void {
    this.ws.send(bytes, { binary: true }, (error) => {
      if (error) this.fail(new Error(`노이즈 필터 사이드카 전송 실패: ${error.message}`));
    });
  }

  private onMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (!isBinary) return; // 규격상 텍스트 프레임(제어 메시지)은 없다 — 응답으로 세지 않는다
    const waiter = this.waiting.shift();
    if (!waiter) return; // 보낸 적 없는 응답 (규격 위반) — 버린다
    // 시간 초과로 서버가 이미 원본을 쓴 조각이면 resolve 해도 아무도 쓰지 않는다 (= 늦은 응답 버리기)
    waiter.resolve(toInt16(data));
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    const waiting = this.waiting;
    this.waiting = [];
    this.unsent = [];
    for (const waiter of waiting) waiter.reject(error);
  }
}

/** 받은 바이너리를 새 Int16Array 로 복사 (Buffer 의 byteOffset 이 홀수일 수 있어 그대로 감싸지 않는다).
 *  홀수 바이트면 마지막 1바이트는 버린다 → 길이가 달라 SafeStreamFilter 가 invalid_output 으로 처리 */
function toInt16(data: WebSocket.RawData): Int16Array {
  const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
  const out = new Int16Array(Math.floor(buf.byteLength / 2));
  new Uint8Array(out.buffer).set(buf.subarray(0, out.byteLength));
  return out;
}
