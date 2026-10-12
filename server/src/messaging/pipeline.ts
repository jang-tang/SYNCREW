import type { AppContext } from "../context";
import { runPreprocessorSafely } from "../engine/audio/audioPreprocessor";
import { AudioDecodeError, decodeToPcm, durationSeconds, encodeWav } from "../engine/audio/codec";
import { BudgetExceededError } from "../engine/budget/budgetGuard";
import type { DomainResult } from "../engine/domain/domainProcessor";
import type { MessageStatus } from "../shared/api";
import type { Lang } from "../shared/languages";
import { PREPROCESS_TIMEOUT_MS } from "../plugins/audioPreprocessor";
import { fullMessage, recipientCounts, toMessageView, type FullMessage } from "./views";

// 통역 파이프라인 (docs/architecture.md 4절)
//   음성: 디코딩 → 노이즈 필터 플러그인 → STT
//   현장 특화 처리(용어 감지·보정·컨텍스트)
//   대상 언어별 1회 번역 (동시성 제한, 실패 시 재시도) → 해당 언어 수신자에게 전달
// 메시지 1건의 작업은 순서대로 실행하고(같은 메시지 중복 실행 방지), 상태 변경은 조건부 UPDATE 로 한다.

export type PipelineOptions = {
  concurrency: number;
  withAudio: boolean;
  /** 1회 + 재시도 횟수 */
  maxAttempts: number;
  /** 번역 1회 시간 제한 (번역기 자체 제한보다 길게) */
  translateTimeoutMs: number;
  maxAudioSeconds: number;
  /** 재시작 복구 시 이 시간보다 오래 멈춘 처리 중 행만 다시 처리한다 */
  staleMs: number;
};

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  concurrency: 4,
  withAudio: true,
  maxAttempts: 3,
  translateTimeoutMs: 20_000,
  maxAudioSeconds: 30.5,
  staleMs: 2 * 60_000,
};

/** STT 인식 힌트 (기존 PoC 프롬프트 기반) */
export const STT_PROMPT =
  "Construction and manufacturing workplace speech. Preserve machine names, PPE terms, emergency stop, safety helmet, defects, and numbers.";

export type PipelineErrorCode =
  | "OPENAI_NOT_CONFIGURED"
  | "BUDGET_EXCEEDED"
  | "AUDIO_INVALID"
  | "AUDIO_TOO_LONG"
  | "STT_FAILED"
  | "STT_EMPTY"
  | "TRANSLATION_FAILED";

class PipelineError extends Error {
  constructor(readonly code: PipelineErrorCode, message: string = code) {
    super(message);
  }
}

class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const elapsedSince = (start: number) => Math.round(performance.now() - start);

export class MessagePipeline {
  private readonly running = new Map<string, Promise<void>>();
  private readonly limiter: Semaphore;
  readonly options: PipelineOptions;

  constructor(
    private readonly ctx: AppContext,
    options: Partial<PipelineOptions> = {},
  ) {
    this.options = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
    this.limiter = new Semaphore(this.options.concurrency);
  }

  /** 처리 작업 등록. 같은 메시지는 앞 작업이 끝난 뒤 이어서 실행한다. */
  enqueue(messageId: string): void {
    const previous = this.running.get(messageId) ?? Promise.resolve();
    const job: Promise<void> = previous
      .then(() => this.process(messageId))
      .catch((err) => this.ctx.logger.error({ err, messageId }, "통역 파이프라인 오류"))
      .finally(() => {
        if (this.running.get(messageId) === job) this.running.delete(messageId);
      });
    this.running.set(messageId, job);
  }

  /** 진행 중인 작업이 모두 끝날 때까지 기다린다 (테스트·종료용) */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running.values()]);
  }

  /**
   * 서버 재시작 복구: 오래 멈춘 처리 중 번역을 대기로 되돌리고, 끝나지 않은 메시지를 다시 처리한다.
   * (docs/database-design.md 4절) 다시 처리할 메시지 수를 돌려준다.
   * 서버 시작 직후에는 이 프로세스에서 처리 중인 것이 없으므로 staleMs=0 으로 부른다.
   */
  async recover(options: { staleMs?: number } = {}): Promise<number> {
    const { prisma } = this.ctx;
    const staleBefore = new Date(Date.now() - (options.staleMs ?? this.options.staleMs));
    await prisma.messageTranslation.updateMany({
      where: { status: "processing", updatedAt: { lt: staleBefore } },
      data: { status: "pending" },
    });
    const stuck = await prisma.message.findMany({
      where: { status: { in: ["queued", "processing"] }, updatedAt: { lt: staleBefore } },
      select: { id: true },
      orderBy: { seq: "asc" },
    });
    for (const { id } of stuck) this.enqueue(id);
    return stuck.length;
  }

  // ─── 처리 ─────────────────────────────────────────

  private async process(messageId: string): Promise<void> {
    const { prisma } = this.ctx;
    const claimed = await prisma.message.updateMany({
      where: { id: messageId, status: { in: ["queued", "processing"] } },
      data: { status: "processing" },
    });
    if (claimed.count === 0) return;
    let message = await this.load(messageId);
    this.emitStatus(message);

    // 1) 원문 텍스트 (음성이면 인식)
    if (message.rawText === null) {
      try {
        message = await this.recognize(message);
      } catch (error) {
        const code = error instanceof PipelineError ? error.code : "STT_FAILED";
        this.ctx.logger.warn({ err: error, messageId, code }, "음성 인식 실패");
        await this.failAll(message, code);
        return;
      }
    }

    // 2) 현장 특화 처리
    const domainStart = performance.now();
    const domain = this.ctx.domain.process(message.rawText!, message.sourceLang as Lang);
    if (message.correctedText === null) {
      message = await prisma.message.update({
        where: { id: messageId },
        data: {
          correctedText: domain.correctedText,
          glossaryHits: domain.hits,
          timings: { ...((message.timings as object | null) ?? {}), domainMs: elapsedSince(domainStart) },
        },
        include: fullMessage,
      });
    }

    // 3) 대상 언어별 번역 (같은 언어 수신자는 결과 공유)
    const pending = message.translations.filter((t) => t.status === "pending");
    await Promise.all(pending.map((row) => this.translateOne(message, row.id, row.targetLang as Lang, domain)));

    await this.finalize(messageId);
  }

  private async load(messageId: string): Promise<FullMessage> {
    return this.ctx.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: fullMessage });
  }

  private async recognize(message: FullMessage): Promise<FullMessage> {
    const { stt, storage, audioPreprocessor, logger, prisma } = this.ctx;
    if (!stt) throw new PipelineError("OPENAI_NOT_CONFIGURED");
    const timings: Record<string, number | boolean> = {};

    let start = performance.now();
    let pcm;
    try {
      pcm = await decodeToPcm(storage.resolve(message.inputAudioPath!));
    } catch (error) {
      throw new PipelineError("AUDIO_INVALID", error instanceof AudioDecodeError ? error.message : String(error));
    }
    timings.decodeMs = elapsedSince(start);
    if (durationSeconds(pcm) > this.options.maxAudioSeconds) throw new PipelineError("AUDIO_TOO_LONG");

    const lang = message.sourceLang as Lang;
    const pre = await runPreprocessorSafely(
      audioPreprocessor,
      pcm,
      { siteId: message.siteId, userId: message.senderId, lang },
      {
        timeoutMs: PREPROCESS_TIMEOUT_MS,
        onFallback: (reason, err) => logger.warn({ err, reason, messageId: message.id }, "노이즈 필터 실패, 원본으로 진행"),
      },
    );
    timings.preprocessMs = pre.durationMs;
    timings.preprocessApplied = pre.applied;

    start = performance.now();
    const result = await this.attempt("stt", () => stt.transcribe({ audio: pre.audio, lang, prompt: STT_PROMPT }));
    timings.sttMs = elapsedSince(start);
    if (!result.text.trim()) throw new PipelineError("STT_EMPTY");

    return prisma.message.update({
      where: { id: message.id },
      data: { rawText: result.text.trim(), timings },
      include: fullMessage,
    });
  }

  /** 재시도 포함 실행. 비용 한도 초과는 재시도하지 않는다. */
  private async attempt<T>(label: string, task: () => Promise<T>, onAttempt?: () => void): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      onAttempt?.();
      try {
        return await withTimeout(task(), this.options.translateTimeoutMs, label);
      } catch (error) {
        lastError = error;
        if (error instanceof BudgetExceededError) throw new PipelineError("BUDGET_EXCEEDED", error.message);
        this.ctx.logger.warn({ err: error, attempt }, `${label} 실패`);
      }
    }
    throw lastError;
  }

  private async translateOne(message: FullMessage, rowId: string, targetLang: Lang, domain: DomainResult): Promise<void> {
    const { prisma, translator, storage, logger } = this.ctx;
    // 조건부 선점: 다른 작업이 이미 처리 중이면 건너뛴다.
    const claimed = await prisma.messageTranslation.updateMany({
      where: { id: rowId, status: { in: ["pending", "failed"] } },
      data: { status: "processing" },
    });
    if (claimed.count === 0) return;

    if (targetLang === message.sourceLang) {
      await prisma.messageTranslation.update({ where: { id: rowId }, data: { status: "skipped" } });
      await this.deliver(message.id, targetLang);
      return;
    }

    const start = performance.now();
    let attempts = 0;
    try {
      if (!translator) throw new PipelineError("OPENAI_NOT_CONFIGURED");
      const context = this.ctx.domain.buildContext(domain, targetLang);
      const output = await this.attempt(
        `번역(${targetLang})`,
        () =>
          this.limiter.run(() =>
            translator.translate({
              text: domain.correctedText,
              sourceLang: message.sourceLang as Lang,
              targetLang,
              context,
              withAudio: this.options.withAudio,
            }),
          ),
        () => attempts++,
      );
      const translateMs = elapsedSince(start);
      const audioPath = output.audio
        ? await storage.saveTranslationAudio(message.id, targetLang, encodeWav(output.audio.data, output.audio.sampleRate))
        : null;
      await prisma.messageTranslation.update({
        where: { id: rowId },
        data: {
          status: "done",
          translatedText: output.text,
          audioPath,
          model: output.model,
          attempts: { increment: attempts },
          latencyMs: elapsedSince(start),
          timings: { translateMs, saveMs: elapsedSince(start) - translateMs },
          errorCode: null,
        },
      });
      logger.info({ messageId: message.id, targetLang, translateMs, attempts }, "번역 완료");
      await this.deliver(message.id, targetLang);
    } catch (error) {
      const code: PipelineErrorCode = error instanceof PipelineError ? error.code : "TRANSLATION_FAILED";
      logger.warn({ err: error, messageId: message.id, targetLang, code }, "번역 최종 실패");
      await prisma.messageTranslation.update({
        where: { id: rowId },
        data: { status: "failed", errorCode: code, attempts: { increment: attempts }, latencyMs: elapsedSince(start) },
      });
      // 이 언어 수신자만 실패. 다른 언어 수신자는 영향 없음 (시나리오 9)
      await prisma.messageRecipient.updateMany({
        where: { messageId: message.id, targetLang, status: "pending" },
        data: { status: "failed" },
      });
      this.emitStatus(await this.load(message.id));
    }
  }

  /** 해당 언어 수신자에게 전달: sent 로 바꾸고 각자에게 message:new */
  private async deliver(messageId: string, lang: Lang): Promise<void> {
    const { prisma } = this.ctx;
    const targets = await prisma.messageRecipient.findMany({
      where: { messageId, targetLang: lang, status: { in: ["pending", "failed"] } },
      select: { userId: true },
    });
    const userIds = targets.map((t) => t.userId);
    if (userIds.length > 0) {
      await prisma.messageRecipient.updateMany({
        where: { messageId, userId: { in: userIds }, status: { in: ["pending", "failed"] } },
        data: { status: "sent", sentAt: new Date() },
      });
    }
    const message = await this.load(messageId);
    const sender = await prisma.profile.findUnique({ where: { id: message.senderId }, select: { displayName: true } });
    for (const userId of userIds) {
      this.ctx.events.messageNew({ userId, message: toMessageView(message, userId, sender?.displayName ?? "", this.ctx.audioUrls) });
    }
    this.emitStatus(message);
  }

  /** 번역 결과로 메시지 전체 상태를 정한다. */
  private async finalize(messageId: string): Promise<void> {
    const message = await this.load(messageId);
    const states = message.translations.map((t) => t.status);
    if (states.some((s) => s === "pending" || s === "processing")) return;
    const failed = states.filter((s) => s === "failed").length;
    const status: MessageStatus = failed === 0 ? "done" : failed === states.length ? "failed" : "partially_failed";
    await this.ctx.prisma.message.update({ where: { id: messageId }, data: { status } });
    this.emitStatus(await this.load(messageId));
  }

  /** 음성 인식 단계 실패: 모든 언어·수신자 실패 */
  private async failAll(message: FullMessage, code: PipelineErrorCode): Promise<void> {
    const { prisma } = this.ctx;
    await prisma.$transaction([
      prisma.message.update({ where: { id: message.id }, data: { status: "failed", errorCode: code } }),
      prisma.messageTranslation.updateMany({
        where: { messageId: message.id, status: { in: ["pending", "processing"] } },
        data: { status: "failed", errorCode: code },
      }),
      prisma.messageRecipient.updateMany({ where: { messageId: message.id, status: "pending" }, data: { status: "failed" } }),
    ]);
    this.emitStatus(await this.load(message.id));
  }

  private emitStatus(message: FullMessage): void {
    this.ctx.events.messageStatus({
      userId: message.senderId,
      messageId: message.id,
      status: message.status as MessageStatus,
      translations: message.translations.map((t) => {
        const text = t.status === "done" ? t.translatedText : t.status === "skipped" ? message.rawText : null;
        return { lang: t.targetLang as Lang, status: t.status as never, ...(text ? { text } : {}) };
      }),
      recipients: recipientCounts(message.recipients),
    });
  }
}
