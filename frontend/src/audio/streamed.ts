import { Platform } from "react-native";

// 스트림으로 이미 들은 문장 기록 (사용자 지시 2026-10-13, 필수).
// 서버는 턴이 끝나면 stream:out:end(messageId) 를 보내고 바로 이어서 같은 문장의 기록 알림 message:new 를 보낸다.
// 같은 연결로 순서대로 오므로, end 에서 messageId 를 기억해 두면 message:new 에서 다시 재생하지 않을 수 있다.

const MAX = 200;
const ids: string[] = [];
const set = new Set<string>();

export function markStreamed(messageId: string): void {
  if (set.has(messageId)) return;
  set.add(messageId);
  ids.push(messageId);
  if (ids.length > MAX) set.delete(ids.shift()!);
  debug.streamed.push(messageId);
}

export function wasStreamed(messageId: string): boolean {
  return set.has(messageId);
}

/**
 * 웹 자동 검증용 기록 (e2e/live.mjs 가 window.__syncrewPlayback 으로 읽는다).
 * enqueued: message:new 로 재생 대기열에 넣은 메시지 / skipped: 스트림으로 들어 건너뛴 메시지 / streamed: 스트림으로 들은 메시지
 * streamTurns: 스트림으로 받기 시작한 턴 수, streamChunks: 받은 음성 조각 수
 */
export const debug = { enqueued: [] as string[], skipped: [] as string[], streamed: [] as string[], streamTurns: 0, streamChunks: 0 };
if (Platform.OS === "web" && typeof window !== "undefined") (window as unknown as { __syncrewPlayback: typeof debug }).__syncrewPlayback = debug;
