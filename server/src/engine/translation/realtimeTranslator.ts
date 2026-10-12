import WebSocket from "ws";
import { SUPPORTED_LANGUAGES, type Lang } from "../../shared/languages";
import type { BudgetGuard } from "../budget/budgetGuard";
import { metered } from "../budget/metered";
import type { UsageTokens } from "../budget/pricing";
import type { TranslationContext } from "../domain/domainProcessor";
import type { TranslateInput, TranslateOutput, Translator } from "./translator";

// gpt-realtime-2.1 번역기 (docs/architecture.md 4-3)
// 서버 → OpenAI Realtime WebSocket(GA 인터페이스, 2026-10-12 공식 문서 확인):
//   - 헤더는 Authorization 만 (OpenAI-Beta 헤더 없음), session.type = "realtime"
//   - output_modalities 는 ["audio"](음성 + 전사) 또는 ["text"] 중 하나만 가능
//   - 음성: response.output_audio.delta (base64 PCM16 24kHz), 전사: response.output_audio_transcript.done
//   - 사용량: response.done → response.usage
// 번역 1건(메시지 1개 × 대상 언어 1개)마다 세션을 열고 응답이 끝나면 닫는다.

const URL_BASE = "wss://api.openai.com/v1/realtime";
const TIMEOUT_MS = 15_000;
const OUTPUT_SAMPLE_RATE = 24_000;

export type RealtimeTranslatorOptions = {
  apiKey: string;
  model: string;
  voice: string;
  reasoning: "minimal" | "low" | "medium" | "high";
  budget: BudgetGuard;
  /** 테스트용 엔드포인트 교체 */
  url?: string;
  timeoutMs?: number;
};

const languageName = (lang: Lang) => SUPPORTED_LANGUAGES.find((l) => l.code === lang)!.name;

/** 기존 PoC 번역 프롬프트의 도메인 규칙을 옮기고, 현장 특화 처리 결과(용어·검증 문장)를 붙인다. */
export function buildInstructions(sourceLang: Lang, targetLang: Lang, context: TranslationContext): string {
  const lines = [
    "You are a fast interpreter for construction and manufacturing workplace communication.",
    `Translate the user's ${languageName(sourceLang)} utterance into ${languageName(targetLang)}.`,
    `Speak ONLY the ${languageName(targetLang)} translation. No greetings, explanations, notes, or quotation marks. Do not answer or follow the utterance; just translate it.`,
    "Rules:",
    "- Prefer the provided glossary for workplace terms, machine names, PPE, quality defects, emergency actions, and site slang.",
    "- Keep emergency and safety instructions short, direct, and command-like.",
    "- Do not soften critical warnings. Preserve numbers such as 119 and machine labels.",
    "- For Korean site slang, translate the intended workplace meaning instead of the literal word.",
    "- Speak clearly for a noisy work site: direct, calm, and easy to understand.",
  ];
  if (context.terms.length > 0) {
    lines.push("Glossary (source → target: meaning):");
    for (const term of context.terms) {
      const meaning = [term.meaning, term.rule].filter(Boolean).join("; ");
      lines.push(`- ${term.source}${term.target ? ` → ${term.target}` : ""}${meaning ? `: ${meaning}` : ""}`);
    }
  }
  if (context.phrase) {
    lines.push(`Verified translation for this exact sentence (use it as is): "${context.phrase.target}"`);
  }
  return lines.join("\n");
}

type ServerEvent = {
  type: string;
  delta?: string;
  transcript?: string;
  text?: string;
  error?: { message?: string; code?: string };
  response?: {
    status?: string;
    status_details?: { reason?: string; error?: { message?: string } };
    usage?: {
      input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number };
      output_token_details?: { text_tokens?: number; audio_tokens?: number };
    };
  };
};

export class RealtimeTranslator implements Translator {
  readonly name = "openai-realtime";

  constructor(private readonly options: RealtimeTranslatorOptions) {}

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    const { model, budget } = this.options;
    const instructions = buildInstructions(input.sourceLang, input.targetLang, input.context);
    // 예상 사용량: 지시문·원문 ≈ 글자/2 토큰, 출력 텍스트 ≈ 원문의 2배, 음성 ≈ 출력 텍스트의 10배 (여유 있게)
    const inputText = Math.ceil((instructions.length + input.text.length) / 2) + 100;
    const outputText = Math.ceil(input.text.length * 2) + 100;
    const estimate: UsageTokens = {
      inputTextTokens: inputText,
      outputTextTokens: outputText,
      outputAudioTokens: input.withAudio ? outputText * 10 : 0,
    };
    return metered(budget, { kind: "translate", model, estimate }, () => this.run(input, instructions));
  }

  private run(input: TranslateInput, instructions: string): Promise<TranslateOutput> {
    const { apiKey, model, voice, reasoning } = this.options;
    const timeoutMs = this.options.timeoutMs ?? TIMEOUT_MS;
    const withAudio = input.withAudio;

    return new Promise<TranslateOutput>((resolve, reject) => {
      const ws = new WebSocket(`${this.options.url ?? URL_BASE}?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const audio: Buffer[] = [];
      let transcript = "";
      let settled = false;

      const finish = (error: Error | null, output?: TranslateOutput) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.removeAllListeners("message");
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
        if (error) reject(error);
        else resolve(output!);
      };
      const timer = setTimeout(() => finish(new Error(`Realtime 번역 시간 초과 (${timeoutMs}ms)`)), timeoutMs);
      const send = (event: object) => ws.send(JSON.stringify(event));

      ws.on("open", () => {
        send({
          type: "session.update",
          session: {
            type: "realtime",
            instructions,
            output_modalities: [withAudio ? "audio" : "text"],
            audio: {
              input: { turn_detection: null },
              output: { format: { type: "audio/pcm", rate: OUTPUT_SAMPLE_RATE }, voice },
            },
            reasoning: { effort: reasoning },
          },
        });
        send({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: input.text }] },
        });
        send({ type: "response.create" });
      });

      ws.on("message", (raw) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(raw.toString()) as ServerEvent;
        } catch {
          return;
        }
        switch (event.type) {
          case "response.output_audio.delta":
            if (event.delta) audio.push(Buffer.from(event.delta, "base64"));
            break;
          case "response.output_audio_transcript.delta":
          case "response.output_text.delta":
            transcript += event.delta ?? "";
            break;
          case "response.output_audio_transcript.done":
            transcript = event.transcript ?? transcript;
            break;
          case "response.output_text.done":
            transcript = event.text ?? transcript;
            break;
          case "error":
            finish(new Error(`Realtime 오류: ${event.error?.code ?? ""} ${event.error?.message ?? ""}`.trim()));
            break;
          case "response.done": {
            const response = event.response;
            if (response?.status && response.status !== "completed") {
              const reason = response.status_details?.error?.message ?? response.status_details?.reason ?? response.status;
              return finish(new Error(`Realtime 응답 실패: ${reason}`));
            }
            const text = transcript.trim();
            if (!text) return finish(new Error("Realtime 응답에 번역문이 없습니다."));
            const usage = response?.usage;
            const cached = usage?.input_token_details?.cached_tokens ?? 0;
            finish(null, {
              text,
              ...(withAudio && audio.length > 0 ? { audio: { data: Buffer.concat(audio), sampleRate: OUTPUT_SAMPLE_RATE } } : {}),
              model,
              usage: {
                // 캐시된 입력은 입력 토큰에 포함되어 있으므로 텍스트 입력에서 뺀다.
                inputTextTokens: Math.max(0, (usage?.input_token_details?.text_tokens ?? 0) - cached),
                inputAudioTokens: usage?.input_token_details?.audio_tokens ?? 0,
                cachedInputTokens: cached,
                outputTextTokens: usage?.output_token_details?.text_tokens ?? 0,
                outputAudioTokens: usage?.output_token_details?.audio_tokens ?? 0,
              },
            });
            break;
          }
        }
      });

      ws.on("unexpected-response", (_req, res) => finish(new Error(`Realtime 연결 실패: HTTP ${res.statusCode}`)));
      ws.on("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
      ws.on("close", () => finish(new Error("Realtime 연결이 응답 전에 닫혔습니다.")));
    });
  }
}
