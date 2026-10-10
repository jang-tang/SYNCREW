import { estimateCostUsd, type PricingTable, type UsageTokens } from "./pricing";

export type UsageKind = "stt" | "translate";

export type UsageRecord = UsageTokens & {
  kind: UsageKind;
  model: string;
  costUsd: number;
};

/** 사용량 저장소. 운영은 Prisma, 테스트는 메모리 구현을 쓴다. */
export interface UsageStore {
  /** since 이후 누적 비용. since가 null이면 전체 누적. */
  sumCostSince(since: Date | null): Promise<number>;
  insert(record: UsageRecord): Promise<void>;
}

export type BudgetPeriod = "month" | "total";

export class BudgetExceededError extends Error {
  constructor(
    readonly limitUsd: number,
    readonly spentUsd: number,
    readonly requestedUsd: number,
  ) {
    super(
      `OpenAI 비용 한도($${limitUsd})를 넘습니다. 사용 $${spentUsd.toFixed(4)}, 요청 예상 $${requestedUsd.toFixed(4)}.`,
    );
    this.name = "BudgetExceededError";
  }
}

export type Reservation = { readonly id: number; readonly estimateUsd: number };

export type BudgetStatus = {
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  period: BudgetPeriod;
  periodStart: Date | null;
};

/**
 * OpenAI 비용 한도 관리.
 * 호출 전 `reserve(예상 비용)` → 호출 후 `commit(실제 사용량)` 또는 실패 시 `release`.
 * 진행 중인 호출의 예상 비용도 한도에 포함하므로 동시 호출로 한도를 넘지 않는다.
 * 서버 1대 기준이다 (예약은 프로세스 메모리에 있음).
 */
export class BudgetGuard {
  private readonly reservations = new Map<number, number>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: UsageStore,
    private readonly pricing: PricingTable,
    private readonly options: { limitUsd: number; period: BudgetPeriod; now?: () => Date },
  ) {}

  private periodStart(): Date | null {
    if (this.options.period === "total") return null;
    const now = (this.options.now ?? (() => new Date()))();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  /** 확인과 예약을 순서대로 처리해 동시 요청 사이의 경쟁을 막는다. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private reservedUsd(): number {
    let total = 0;
    for (const value of this.reservations.values()) total += value;
    return total;
  }

  estimate(model: string, usage: UsageTokens): number {
    return estimateCostUsd(this.pricing, model, usage);
  }

  reserve(estimateUsd: number): Promise<Reservation> {
    return this.serialize(async () => {
      const spent = await this.store.sumCostSince(this.periodStart());
      const committed = spent + this.reservedUsd();
      if (committed + estimateUsd > this.options.limitUsd) {
        throw new BudgetExceededError(this.options.limitUsd, committed, estimateUsd);
      }
      const id = this.nextId++;
      this.reservations.set(id, estimateUsd);
      return { id, estimateUsd };
    });
  }

  /** 실제 사용량을 기록하고 예약을 푼다. 기록한 비용(USD)을 돌려준다. */
  async commit(
    reservation: Reservation,
    actual: UsageTokens & { kind: UsageRecord["kind"]; model: string },
  ): Promise<number> {
    try {
      const costUsd = this.estimate(actual.model, actual);
      await this.store.insert({ ...actual, costUsd });
      return costUsd;
    } finally {
      this.reservations.delete(reservation.id);
    }
  }

  release(reservation: Reservation): void {
    this.reservations.delete(reservation.id);
  }

  async status(): Promise<BudgetStatus> {
    const periodStart = this.periodStart();
    const spentUsd = await this.store.sumCostSince(periodStart);
    const reservedUsd = this.reservedUsd();
    return {
      limitUsd: this.options.limitUsd,
      spentUsd,
      reservedUsd,
      remainingUsd: Math.max(0, this.options.limitUsd - spentUsd - reservedUsd),
      period: this.options.period,
      periodStart,
    };
  }
}

export class InMemoryUsageStore implements UsageStore {
  readonly records: (UsageRecord & { createdAt: Date })[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  async sumCostSince(since: Date | null): Promise<number> {
    return this.records
      .filter((record) => !since || record.createdAt >= since)
      .reduce((total, record) => total + record.costUsd, 0);
  }

  async insert(record: UsageRecord): Promise<void> {
    this.records.push({ ...record, createdAt: this.now() });
  }
}
