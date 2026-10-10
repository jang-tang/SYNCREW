import type { PrismaClient } from "../../lib/prisma";
import type { UsageRecord, UsageStore } from "./budgetGuard";

export class PrismaUsageStore implements UsageStore {
  constructor(private readonly prisma: PrismaClient) {}

  async sumCostSince(since: Date | null): Promise<number> {
    const result = await this.prisma.openAiUsage.aggregate({
      _sum: { costUsd: true },
      ...(since ? { where: { createdAt: { gte: since } } } : {}),
    });
    return Number(result._sum.costUsd ?? 0);
  }

  async insert(record: UsageRecord): Promise<void> {
    await this.prisma.openAiUsage.create({
      data: {
        kind: record.kind,
        model: record.model,
        inputTextTokens: record.inputTextTokens ?? 0,
        inputAudioTokens: record.inputAudioTokens ?? 0,
        cachedInputTokens: record.cachedInputTokens ?? 0,
        outputTextTokens: record.outputTextTokens ?? 0,
        outputAudioTokens: record.outputAudioTokens ?? 0,
        costUsd: record.costUsd.toFixed(6),
      },
    });
  }
}
