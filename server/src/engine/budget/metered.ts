import type { BudgetGuard, UsageKind } from "./budgetGuard";
import type { UsageTokens } from "./pricing";

/**
 * OpenAI 호출 1건을 비용 한도 안에서 실행한다.
 * 예상 사용량으로 예약 → 호출 → 실제 사용량 기록. 호출이 실패하면 예약만 푼다.
 * 한도를 넘으면 호출하지 않고 BudgetExceededError 를 던진다.
 */
export async function metered<T extends { usage: UsageTokens }>(
  budget: BudgetGuard,
  options: { kind: UsageKind; model: string; estimate: UsageTokens },
  call: () => Promise<T>,
): Promise<T> {
  const reservation = await budget.reserve(budget.estimate(options.model, options.estimate));
  let result: T;
  try {
    result = await call();
  } catch (error) {
    budget.release(reservation);
    throw error;
  }
  await budget.commit(reservation, { ...result.usage, kind: options.kind, model: options.model });
  return result;
}
