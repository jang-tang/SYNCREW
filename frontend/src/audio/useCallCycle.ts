import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { LiveSession } from "@shared/api";
import { useMembers, useSwitchConnection } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { ApiError } from "@/services/live/http";
import { toast } from "@/stores/toast";
import { callOrder, createVolumeKeyDetector, cycleCandidates, DOUBLE_PRESS_MS, type VolumeDirection } from "./callCycle";
import { restoreVolume, stepVolume, watchVolumeKeys } from "./volumeKeys";

// 통화 중 음량 버튼으로 상대 바꾸기 (C1 4단계, docs/live-interpretation.md 3-1절).
// 두 번 누르면: 다음(이전) 걸 수 있는 사람으로 연결을 전환한다(서버가 끊기·연결을 한 번에, C2). 다른 연결 중·접속 끊김이면 그다음 사람.
// 전환 뒤 새 상대 이름을 음성으로 알린다 (announce — 새 연결의 오디오가 켜진 뒤 말하도록 ConnectionProvider 가 맡는다). C2 부터는 받기 없이 바로 연결된다.
// 연결 패널의 "다음 멤버" 버튼도 같은 전환을 쓴다 (돌려주는 cycle).
// 한 번 누르면 음량 한 칸, 두 번 누름은 음량을 남기지 않는다 (stepVolume·restoreVolume, 플랫폼별 차이는 modules/syncrew-duplex/index.ts).

/** 웹 자동 검증용 기록 (e2e/flows.mjs 가 window.__syncrewCycle 으로 읽는다) */
const debug = { watching: 0, presses: 0, doubles: 0, last: "" };
if (Platform.OS === "web" && typeof window !== "undefined") (window as unknown as { __syncrewCycle: typeof debug }).__syncrewCycle = debug;

/** 이 연결에서 상대 바꾸기를 받을지: 통화 중이거나 내가 거는 중(울림, 예전 방식). 걸려 온 울림에서는 받지 않는다 */
export function callCycleEnabled(session: LiveSession | undefined, myId: string | undefined): boolean {
  if (!session || session.mode !== "call" || !myId) return false;
  if (session.status === "active") return true;
  return session.status === "ringing" && session.participants.find((p) => p.userId === myId)?.role === "caller";
}

/** announce(text, sessionId): 그 연결(sessionId)의 오디오가 준비되면 text 를 말한다 */
export function useCallCycle(
  session: LiveSession | undefined,
  myId: string | undefined,
  announce: (text: string, sessionId: string) => void,
) {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = session?.siteId ?? "";
  const members = useMembers(siteId);
  const switchConnection = useSwitchConnection();
  const enabled = callCycleEnabled(session, myId);

  // 버튼 처리는 렌더와 따로 돈다 → 최신 값은 ref 로 읽는다 (값이 바뀔 때마다 네이티브 지켜보기를 다시 시작하지 않게)
  const latest = useRef({ session, myId, members: members.data, t, errorMessage, switchConnection, announce });
  latest.current = { session, myId, members: members.data, t, errorMessage, switchConnection, announce };
  /** 바꾸는 중에 또 누르면 무시한다 (전환 요청이 겹치지 않게) */
  const switching = useRef(false);

  /** 다음(up)·이전(down) 사람으로 전환. 음량 두 번 누름과 "다음 멤버" 버튼이 같이 쓴다 */
  const cycle = useCallback(async (direction: VolumeDirection) => {
    const { session: current, myId: me, members: list, t: tr, announce } = latest.current;
    debug.doubles += 1;
    if (switching.current || !current || !me || !list) {
      debug.last = `skip switching=${switching.current} session=${!!current} me=${!!me} members=${!!list}`;
      return;
    }
    const peer = current.participants.find((p) => p.userId !== me);
    if (!peer) return;
    const candidates = cycleCandidates(callOrder(list, me), peer.userId, direction);
    debug.last = `candidates=${candidates.map((m) => m.userId).join(",")}`;
    if (candidates.length === 0) {
      // 지금 통화는 그대로 둔다
      announce(tr("call.cycle.none"), current.id);
      toast(tr("call.cycle.none"), "default");
      return;
    }
    switching.current = true;
    try {
      for (const next of candidates) {
        try {
          // 서버가 새 상대를 먼저 확인하므로, 안 되면 지금 연결은 그대로다
          const switched = await latest.current.switchConnection.mutateAsync({ sessionId: current.id, userId: next.userId });
          announce(tr("call.cycle.calling", { name: next.displayName }), switched.id);
          return;
        } catch (error) {
          // 다른 연결 중(BUSY)이거나 접속이 끊긴(CONFLICT) 사람은 건너뛴다
          if (error instanceof ApiError && (error.code === "BUSY" || error.code === "CONFLICT")) continue;
          toast(latest.current.errorMessage(error), "error");
          return;
        }
      }
      announce(tr("call.cycle.none"), current.id);
      toast(tr("call.cycle.none"), "default");
    } finally {
      switching.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const detector = createVolumeKeyDetector(
      {
        onSingle: stepVolume,
        onDouble: (direction) => {
          restoreVolume();
          void cycle(direction);
        },
      },
      { windowMs: DOUBLE_PRESS_MS },
    );
    const unwatch = watchVolumeKeys((direction) => {
      debug.presses += 1;
      detector.press(direction);
    });
    debug.watching += 1;
    return () => {
      debug.watching -= 1;
      unwatch();
      detector.reset();
    };
  }, [enabled, cycle]);

  return cycle;
}
