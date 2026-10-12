import type { Lang } from "../shared/languages";
import type { SttProvider, TranscribeInput, TranscribeOutput } from "./stt/sttProvider";
import type { TranslateInput, TranslateOutput, Translator } from "./translation/translator";

// 테스트·개발용 가짜 엔진 (OpenAI 호출 없음, 비용 없음).
// ENGINE=fake 로 서버를 띄우면 키 없이 앱 live 모드를 확인할 수 있다.

type FailRule = (input: { attempt: number; lang: Lang }) => boolean;

export type FakeOptions = {
  /** 호출마다 기다리는 시간 (ms) */
  delayMs?: number;
  /** true 를 돌려주면 그 호출을 실패시킨다 */
  fail?: FailRule;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 음성 길이와 무관하게 정해진 문장을 인식한 것으로 처리한다. */
export class FakeStt implements SttProvider {
  readonly name = "fake";
  readonly calls: TranscribeInput[] = [];
  private attempt = 0;

  constructor(
    private readonly options: FakeOptions & { text?: (lang: Lang) => string } = {},
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    this.calls.push(input);
    this.attempt += 1;
    await sleep(this.options.delayMs ?? 0);
    if (this.options.fail?.({ attempt: this.attempt, lang: input.lang })) throw new Error("fake stt failure");
    const text = this.options.text?.(input.lang) ?? `[음성 ${input.lang}] ${(input.audio.data.length / input.audio.sampleRate).toFixed(1)}s`;
    return { text, model: "fake-stt", usage: {} };
  }
}

/** "[대상언어] 원문" 형식으로 번역하고, 요청하면 짧은 무음 PCM 을 음성으로 돌려준다. */
export class FakeTranslator implements Translator {
  readonly name = "fake";
  readonly calls: TranslateInput[] = [];
  private readonly attempts = new Map<string, number>();

  constructor(private readonly options: FakeOptions = {}) {}

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    this.calls.push(input);
    const key = `${input.text}→${input.targetLang}`;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    await sleep(this.options.delayMs ?? 0);
    if (this.options.fail?.({ attempt, lang: input.targetLang })) throw new Error(`fake translate failure (${input.targetLang})`);
    const text = input.context.phrase?.target ?? `[${input.targetLang}] ${input.text}`;
    return {
      text,
      // 24kHz 0.1초 무음 (PCM16)
      ...(input.withAudio ? { audio: { data: Buffer.alloc(4800), sampleRate: 24_000 } } : {}),
      model: "fake-translator",
      usage: {},
    };
  }
}
