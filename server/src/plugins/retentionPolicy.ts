// ─────────────────────────────────────────────────────────────
// 데이터 보존 정책 연결 지점
//
// 다른 개발자가 만든 보존 정책은 RetentionPolicy 인터페이스를 구현한 뒤
// 아래 POLICIES 에 등록하고, .env 의 RETENTION_POLICY 에 그 이름을 적는다.
// 서버가 매일 RETENTION_RUN_AT(서버 로컬 시각)에 run()을 호출한다.
// ─────────────────────────────────────────────────────────────
import type { Logger } from "../lib/logger";
import type { PrismaClient } from "../lib/prisma";

export type RetentionContext = {
  now: Date;
  db: PrismaClient;
  logger: Logger;
};

export type RetentionReport = {
  /** 테이블·저장소별 삭제 건수 */
  deleted: Record<string, number>;
};

export interface RetentionPolicy {
  readonly name: string;
  run(context: RetentionContext): Promise<RetentionReport>;
}

/** 기본값: 아무것도 삭제하지 않는다. */
export class NoopRetentionPolicy implements RetentionPolicy {
  readonly name = "noop";

  async run(): Promise<RetentionReport> {
    return { deleted: {} };
  }
}

const POLICIES: Record<string, () => RetentionPolicy> = {
  noop: () => new NoopRetentionPolicy(),
};

export function createRetentionPolicy(name: string): RetentionPolicy {
  const factory = POLICIES[name];
  if (!factory) {
    throw new Error(`알 수 없는 RETENTION_POLICY: ${name}. 사용 가능: ${Object.keys(POLICIES).join(", ")}`);
  }
  return factory();
}

/** "HH:MM" 기준으로 now 이후 가장 가까운 실행 시각 */
export function nextRunAt(now: Date, runAt: string): Date {
  const [hours, minutes] = runAt.split(":").map(Number) as [number, number];
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

/** 매일 정해진 시각에 정책을 실행한다. 반환값을 호출하면 중지된다. */
export function startRetentionScheduler(
  policy: RetentionPolicy,
  options: { runAt: string; db: PrismaClient; logger: Logger },
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const delay = nextRunAt(new Date(), options.runAt).getTime() - Date.now();
    timer = setTimeout(async () => {
      try {
        const report = await policy.run({ now: new Date(), db: options.db, logger: options.logger });
        options.logger.info({ policy: policy.name, report }, "데이터 보존 정책 실행 완료");
      } catch (err) {
        options.logger.error({ err, policy: policy.name }, "데이터 보존 정책 실행 실패");
      }
      schedule();
    }, delay);
    timer.unref();
  };

  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
