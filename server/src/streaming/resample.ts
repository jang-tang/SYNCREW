// PCM16 mono 표본률 변환 (선형 보간). 조각을 이어 받아도 경계가 끊기지 않도록 상태를 유지한다.
// 앱 16kHz → OpenAI 24kHz. 음성 통역 용도로는 선형 보간이면 충분하다 (docs/streaming-plan.md 4절).

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
    const count = Math.floor(chunk.length / 2);
    if (count === 0) return Buffer.alloc(0);
    // [직전 마지막 표본, ...이번 조각] 을 하나의 배열처럼 본다
    const offset = this.last === null ? 0 : 1;
    const at = (index: number) => (index < offset ? this.last! : chunk.readInt16LE((index - offset) * 2));
    const length = count + offset;
    const out: number[] = [];
    let t = this.position;
    while (t <= length - 1) {
      const i = Math.floor(t);
      const frac = t - i;
      const a = at(i);
      const value = frac === 0 || i + 1 >= length ? a : a + (at(i + 1) - a) * frac;
      out.push(Math.max(-32768, Math.min(32767, Math.round(value))));
      t += this.step;
    }
    this.position = t - (length - 1);
    this.last = chunk.readInt16LE((count - 1) * 2);
    const buffer = Buffer.alloc(out.length * 2);
    out.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
    return buffer;
  }
}

/** PCM16 조각의 RMS 음량 (0–32768) */
export function rms(pcm: Buffer): number {
  const count = Math.floor(pcm.length / 2);
  if (count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = pcm.readInt16LE(i * 2);
    sum += v * v;
  }
  return Math.sqrt(sum / count);
}
