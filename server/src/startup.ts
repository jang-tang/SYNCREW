import type { AppContext } from "./context";

/**
 * 서버 시작 직후 정리 (index.ts). 시작 시점에는 연결된 앱이 없으므로:
 *  1) 이전 실행에서 열린 채 남은 통역 세션(울림·진행 중)을 connection_lost 로 닫는다
 *  2) 처리 도중 멈춘 메시지를 다시 처리한다 (staleMs 0 — 이 프로세스에서 처리 중인 것이 없다)
 * 앱은 다시 연결될 때 화면 데이터를 새로 불러온다 (frontend/src/providers/RealtimeBridge.tsx).
 */
export async function recoverOnStartup(
  context: AppContext,
  /** 테스트용 범위 제한 (같은 DB 를 함께 쓰는 다른 테스트를 건드리지 않게). 서버에서는 넘기지 않는다 */
  scope: { siteIds?: string[] } = {},
): Promise<{ closedSessions: number; requeuedMessages: number }> {
  const closedSessions = await context.sessions.closeStale(scope);
  const requeuedMessages = await context.pipeline.recover({ staleMs: 0, ...scope });
  return { closedSessions, requeuedMessages };
}
