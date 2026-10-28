import WebSocket from "ws";
import { SUPPORTED_LANGUAGES, type Lang } from "../../shared/languages";
import type { BudgetGuard } from "../budget/budgetGuard";
import { metered } from "../budget/metered";
import type { UsageTokens } from "../budget/pricing";
import type { ContextTerm, TranslationContext } from "../domain/domainProcessor";
import type { TranslateInput, TranslateOutput, Translator } from "./translator";

// gpt-realtime-2.1 번역기 (docs/architecture.md 4-3)
// 서버 → OpenAI Realtime WebSocket(GA 인터페이스, 2026-10-12 공식 문서 확인):
//   - 헤더는 Authorization 만 (OpenAI-Beta 헤더 없음), session.type = "realtime"
//   - output_modalities 는 ["audio"](음성 + 전사) 또는 ["text"] 중 하나만 가능
//   - 음성: response.output_audio.delta (base64 PCM16 24kHz), 전사: response.output_audio_transcript.done
//   - 사용량: response.done → response.usage
// 번역 1건(메시지 1개 × 대상 언어 1개)마다 세션을 열고 응답이 끝나면 닫는다.
// 연결 맺기에 약 1.1초가 걸려(2026-10-28 실측) warm() 으로 다음 번역에 쓸 연결을 미리 열어 둘 수 있다 (되돌린 자막). 열어 두는 것만으로는 과금되지 않는다.

const URL_BASE = "wss://api.openai.com/v1/realtime";
const TIMEOUT_MS = 15_000;
const OUTPUT_SAMPLE_RATE = 24_000;
/** 미리 열어 두는 연결 수·유지 시간 */
const WARM_MAX = 2;
const WARM_TTL_MS = 120_000;

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
/** 용어 한 줄: `- 원문 → 번역: 뜻; 규칙` (번역·뜻이 없으면 생략) */
export function formatTerm(term: ContextTerm): string {
  const meaning = [term.meaning, term.rule].filter(Boolean).join("; ");
  return `- ${term.source}${term.target ? ` → ${term.target}` : ""}${meaning ? `: ${meaning}` : ""}`;
}

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
    for (const term of context.terms) lines.push(formatTerm(term));
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
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens?: number };
      output_token_details?: { text_tokens?: number; audio_tokens?: number };
    };
  };
};

export class RealtimeTranslator implements Translator {
  readonly name = "openai-realtime";

  private warmSockets: { ws: WebSocket; at: number }[] = [];

  constructor(private readonly options: RealtimeTranslatorOptions) {}

  /** 다음 번역에 쓸 연결을 미리 연다 (이미 WARM_MAX 개면 그대로) */
  warm(): void {
    this.pruneWarm();
    if (this.warmSockets.length >= WARM_MAX) return;
    const entry = { ws: this.connect(), at: Date.now() };
    const drop = () => (this.warmSockets = this.warmSockets.filter((w) => w !== entry));
    entry.ws.on("error", drop);
    entry.ws.on("close", drop);
    entry.ws.on("unexpected-response", () => {
      drop();
      entry.ws.terminate();
    });
    this.warmSockets.push(entry);
  }

  private connect(): WebSocket {
    return new WebSocket(`${this.options.url ?? URL_BASE}?model=${encodeURIComponent(this.options.model)}`, {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
    });
  }

  private pruneWarm(): void {
    const now = Date.now();
    this.warmSockets = this.warmSockets.filter((w) => {
      const alive = now - w.at < WARM_TTL_MS && (w.ws.readyState === WebSocket.OPEN || w.ws.readyState === WebSocket.CONNECTING);
      if (!alive) w.ws.terminate();
      return alive;
    });
  }

  /** 미리 연 연결(열린 것 먼저)이 있으면 그것, 없으면 새로 연다. 꺼낸 연결의 리스너는 호출한 쪽이 바로(같은 틱에) 단다 */
  private takeSocket(): WebSocket {
    this.pruneWarm();
    const entry = this.warmSockets.find((w) => w.ws.readyState === WebSocket.OPEN) ?? this.warmSockets[0];
    if (!entry) return this.connect();
    this.warmSockets = this.warmSockets.filter((w) => w !== entry);
    entry.ws.removeAllListeners();
    return entry.ws;
  }

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
    const { model, voice, reasoning } = this.options;
    const timeoutMs = this.options.timeoutMs ?? TIMEOUT_MS;
    const withAudio = input.withAudio;

    return new Promise<TranslateOutput>((resolve, reject) => {
      const ws = this.takeSocket();
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

      const start = () => {
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
      };
      if (ws.readyState === WebSocket.OPEN) start();
      else ws.on("open", start);

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
            const outputAudioTokens = usage?.output_token_details?.audio_tokens ?? 0;
            // 추론 토큰은 세부 항목에 없을 수 있다. 전체 출력에서 음성을 뺀 나머지를 텍스트 출력 단가로 계산한다.
            const outputTextTokens = Math.max(
              usage?.output_token_details?.text_tokens ?? 0,
              (usage?.output_tokens ?? 0) - outputAudioTokens,
            );
            finish(null, {
              text,
              ...(withAudio && audio.length > 0 ? { audio: { data: Buffer.concat(audio), sampleRate: OUTPUT_SAMPLE_RATE } } : {}),
              model,
              usage: {
                // 캐시된 입력은 입력 토큰에 포함되어 있으므로 텍스트 입력에서 뺀다.
                inputTextTokens: Math.max(0, (usage?.input_token_details?.text_tokens ?? 0) - cached),
                inputAudioTokens: usage?.input_token_details?.audio_tokens ?? 0,
                cachedInputTokens: cached,
                outputTextTokens,
                outputAudioTokens,
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
