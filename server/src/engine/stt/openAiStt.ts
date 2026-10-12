import type { BudgetGuard } from "../budget/budgetGuard";
import { metered } from "../budget/metered";
import { encodeWav } from "../audio/codec";
import type { Lang } from "../../shared/languages";
import type { SttProvider, TranscribeInput, TranscribeOutput } from "./sttProvider";

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const TIMEOUT_MS = 15_000;

/**
 * language 파라미터가 받지 않는 언어 (2026-10-12 실제 호출: uz → 400 "Language code 'uz' is not recognized").
 * 이 언어는 language 를 빼고 프롬프트에 언어 이름을 적어 인식시킨다.
 */
const PROMPT_ONLY_LANGUAGES: Partial<Record<Lang, string>> = { uz: "Uzbek" };

/** STT 요청의 language·prompt 값. 지원하지 않는 언어는 프롬프트로 언어를 알려 준다. */
export function sttLanguageParams(lang: Lang, prompt?: string): { language?: string; prompt?: string } {
  const trimmed = prompt?.trim() || undefined;
  const name = PROMPT_ONLY_LANGUAGES[lang];
  if (!name) return { language: lang, prompt: trimmed };
  return { prompt: [`The speaker speaks ${name}. Transcribe in ${name} (Latin script).`, trimmed].filter(Boolean).join(" ") };
}

type TranscriptionResponse = {
  text?: unknown;
  usage?: {
    type?: string;
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { audio_tokens?: number; text_tokens?: number };
  };
};

/**
 * OpenAI 음성 인식 (/v1/audio/transcriptions, 기존 PoC requestAudioTranscription 이식).
 * gpt-4o(-mini)-transcribe 는 response_format=json 만 지원한다.
 */
export class OpenAiStt implements SttProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly budget: BudgetGuard,
    /** 테스트용 엔드포인트 교체 */
    private readonly endpoint = ENDPOINT,
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    const seconds = input.audio.data.length / input.audio.sampleRate;
    // 예상 사용량: 음성 1초 ≈ 10 토큰(여유 있게), 프롬프트 ≈ 글자/2, 출력 ≈ 초당 5 토큰
    const estimate = {
      inputAudioTokens: Math.ceil(seconds * 10) + 50,
      inputTextTokens: Math.ceil((input.prompt?.length ?? 0) / 2),
      outputTextTokens: Math.ceil(seconds * 5) + 50,
    };

    return metered(this.budget, { kind: "stt", model: this.model, estimate }, async () => {
      const form = new FormData();
      form.append("model", this.model);
      const params = sttLanguageParams(input.lang, input.prompt);
      if (params.language) form.append("language", params.language);
      form.append("response_format", "json");
      if (params.prompt) form.append("prompt", params.prompt);
      const wav = encodeWav(input.audio.data, input.audio.sampleRate);
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`OpenAI STT ${response.status}: ${detail}`);
      }
      const data = (await response.json()) as TranscriptionResponse;
      const text = typeof data.text === "string" ? data.text.trim() : "";
      const usage = data.usage?.type === "tokens" ? data.usage : undefined;
      return {
        text,
        model: this.model,
        usage: {
          inputAudioTokens: usage?.input_token_details?.audio_tokens ?? usage?.input_tokens ?? estimate.inputAudioTokens,
          inputTextTokens: usage?.input_token_details?.text_tokens ?? 0,
          outputTextTokens: usage?.output_tokens ?? estimate.outputTextTokens,
        },
      };
    });
  }
}
