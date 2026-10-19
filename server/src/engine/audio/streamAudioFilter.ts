import type { PreprocessContext } from "./audioPreprocessor";

// 스트리밍 통화용 노이즈 필터 인터페이스 (2026-10-14 결정: 노이즈 필터는 서버에서 실행).
// 발화 단위 방식의 AudioPreprocessor(녹음 전체를 한 번에)와 달리, 말하는 동안 100ms 조각이 계속 들어온다.
//   - 스트림(화자 1명의 통화 1개)마다 세션 1개를 연다 → 잡음 추정 같은 상태를 세션에 둘 수 있다
//   - process: PCM16 mono 조각(앱 기본 16kHz, 100ms = 1600표본)을 받아 같은 길이로 돌려준다
//   - 안전 규칙(streamHub 가 적용): 조각당 시간 제한 안에 끝나지 않거나, 오류·길이가 다른 출력이면 원본 조각을 쓴다.
//     연속 5번 실패하면 그 통화에서는 필터를 끈다. 조각 순서는 항상 유지된다.
// 구현체 등록: src/plugins/streamAudioFilter.ts, 선택: .env STREAM_AUDIO_FILTER

export type StreamFilterContext = PreprocessContext & { sampleRate: number };

export interface StreamFilterSession {
  process(frame: Int16Array): Int16Array | Promise<Int16Array>;
  close?(): void;
}

export interface StreamAudioFilter {
  readonly name: string;
  open(context: StreamFilterContext): StreamFilterSession;
}

/** 기본값: 조각을 그대로 돌려준다 (필터 없음) */
export class PassthroughStreamFilter implements StreamAudioFilter {
  readonly name = "passthrough";
  open(): StreamFilterSession {
    return { process: (frame) => frame };
  }
}

export type StreamFilterOptions = {
  /** 조각 1개 처리 시간 제한 (ms). 넘으면 원본 조각 */
  frameBudgetMs: number;
  /** 연속 실패가 이만큼이면 이 스트림에서 필터를 끈다 */
  maxConsecutiveFailures: number;
};

export const DEFAULT_STREAM_FILTER_OPTIONS: StreamFilterOptions = { frameBudgetMs: 50, maxConsecutiveFailures: 5 };

/**
 * 스트림 1개의 필터 실행기: 조각 순서를 지키고(앞 조각이 끝나야 다음 조각), 실패하면 원본으로 넘긴다.
 * passthrough 면 아무 일도 하지 않고 바로 넘긴다 (지연 0).
 */
export class SafeStreamFilter {
  private chain: Promise<void> = Promise.resolve();
  private failures = 0;
  private disabled: boolean;
  private session: StreamFilterSession | null = null;
  /** 스트림을 닫았다 — 그 뒤에 끝나는 조각은 실패로 세지 않는다 (닫으면서 기다리던 조각이 거절되므로) */
  private closed = false;
  /** 이 스트림에서 필터에 넘긴 조각 수와 결과 (스트림을 닫을 때 기록) */
  readonly stats = { frames: 0, filtered: 0, failed: 0, disabled: false };

  constructor(
    filter: StreamAudioFilter,
    context: StreamFilterContext,
    private readonly options: StreamFilterOptions,
    private readonly onFailure: (reason: "error" | "timeout" | "invalid_output" | "disabled", error?: unknown) => void,
  ) {
    this.disabled = filter.name === "passthrough";
    if (!this.disabled) {
      try {
        this.session = filter.open(context);
      } catch (error) {
        this.disabled = true;
        this.stats.disabled = true;
        onFailure("error", error);
      }
    }
  }

  /** 조각을 필터에 통과시켜 순서대로 deliver 한다 */
  push(frame: Buffer, deliver: (frame: Buffer) => void): void {
    if (this.disabled || !this.session) {
      // 앞에 필터 처리 중인 조각이 있으면 그 뒤에 (순서 유지)
      this.chain = this.chain.then(() => deliver(frame));
      return;
    }
    // 기다리는 동안 필터가 꺼졌으면(연속 실패) 원본 그대로 — 닫힌 세션을 다시 부르지 않는다
    this.chain = this.chain.then(async () => deliver(this.disabled || !this.session ? frame : await this.run(frame)));
  }

  private async run(frame: Buffer): Promise<Buffer> {
    const samples = new Int16Array(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    let timer: NodeJS.Timeout | undefined;
    this.stats.frames += 1;
    try {
      const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), this.options.frameBudgetMs)));
      const outcome = await Promise.race([Promise.resolve(this.session!.process(samples)), timeout]);
      if (outcome === "timeout") return this.fail(frame, "timeout");
      if (!(outcome instanceof Int16Array) || outcome.length !== samples.length) return this.fail(frame, "invalid_output");
      this.failures = 0;
      this.stats.filtered += 1;
      return Buffer.from(outcome.buffer, outcome.byteOffset, outcome.byteLength);
    } catch (error) {
      return this.fail(frame, "error", error);
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(frame: Buffer, reason: "error" | "timeout" | "invalid_output", error?: unknown): Buffer {
    if (this.closed) return frame;
    this.failures += 1;
    this.stats.failed += 1;
    this.onFailure(reason, error);
    if (this.failures >= this.options.maxConsecutiveFailures) {
      this.disabled = true;
      this.stats.disabled = true;
      this.close();
      this.onFailure("disabled");
    }
    return frame;
  }

  /** 앞에 들어온 조각이 모두 처리된 뒤 실행 (말 끝 알림이 조각을 앞지르지 않게) */
  after(task: () => void): void {
    this.chain = this.chain.then(task);
  }

  close(): void {
    this.closed = true;
    try {
      this.session?.close?.();
    } catch {
      // 닫기 실패는 무시
    }
    this.session = null;
  }
}
