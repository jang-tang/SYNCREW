// PCM16 mono 표본률 변환 (선형 보간). 조각을 이어 받아도 경계가 끊기지 않도록 상태를 유지한다.
// 앱 16kHz → OpenAI 24kHz. 음성 통역 용도로는 선형 보간이면 충분하다 (docs/streaming-plan.md 4절).
// 조각마다(100ms, 초당 10번 × 통화 수) 도는 경로라 number[]·클로저·readInt16LE 대신 Int16Array 로 처리한다
// (2026-10-20 측정, docs/perf-network-2026-10-20.md).

/** Buffer 를 Int16Array 로 본다. 2바이트 정렬이 안 된 Buffer(풀 조각)는 복사한다 */
function int16View(pcm: Buffer): Int16Array {
  const count = pcm.length >> 1;
  if (pcm.byteOffset % 2 === 0) return new Int16Array(pcm.buffer, pcm.byteOffset, count);
  return new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + count * 2));
}

export class LinearResampler {
  private readonly step: number;
  /** 다음 출력 표본 위치 (직전 조각의 마지막 표본 = 0 기준) */
  private position = 0;
  private last: number | null = null;

  constructor(
    readonly fromRate: number,
    readonly toRate: number,
  ) {
    this.step = fromRate / toRate;
  }

  push(chunk: Buffer): Buffer {
    if (this.fromRate === this.toRate) return chunk;
    const input = int16View(chunk);
    const count = input.length;
    if (count === 0) return Buffer.alloc(0);
    // [직전 마지막 표본, ...이번 조각] 을 하나의 배열처럼 본다
    const offset = this.last === null ? 0 : 1;
    const last = this.last ?? 0;
    const length = count + offset;
    const end = length - 1;
    const step = this.step;
    // 출력 개수 상한 (실제 개수는 아래 while 이 정한다 — 부동소수 누적 오차로 ±1 이 날 수 있어 닫힌 식을 쓰지 않는다)
    const out = new Int16Array(Math.max(0, Math.floor((end - this.position) / step)) + 2);
    let n = 0;
    let t = this.position;
    while (t <= end) {
      const i = Math.floor(t);
      const frac = t - i;
      const a = i < offset ? last : input[i - offset]!;
      let value = a;
      if (frac !== 0 && i + 1 < length) value = a + (input[i + 1 - offset]! - a) * frac;
      const rounded = Math.round(value);
      out[n++] = rounded > 32767 ? 32767 : rounded < -32768 ? -32768 : rounded;
      t += step;
    }
    this.position = t - end;
    this.last = input[count - 1]!;
    return Buffer.from(out.buffer, 0, n * 2);
  }
}

/** PCM16 조각의 RMS 음량 (0–32768) */
export function rms(pcm: Buffer): number {
  const samples = int16View(pcm);
  const count = samples.length;
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / count);
}
