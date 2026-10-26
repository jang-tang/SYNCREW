import * as Speech from "expo-speech";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { LiveSession } from "@shared/api";
import { useMembers, useSessionAction, useStartCall } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { localeOf } from "@/lib/format";
import { ApiError } from "@/services/live/http";
import { toast } from "@/stores/toast";
import { callOrder, createVolumeKeyDetector, cycleCandidates, DOUBLE_PRESS_MS, type VolumeDirection } from "./callCycle";
import { restoreVolume, stepVolume, watchVolumeKeys } from "./volumeKeys";

// 통화 중 음량 버튼으로 상대 바꾸기 (C1 4단계, docs/live-interpretation.md 3-1절).
// 두 번 누르면: 다음(이전) 걸 수 있는 사람을 정하고 → 지금 통화를 끊고 → 건다. 그 사이 다른 통화 중·접속 끊김이면 그다음 사람.
// 건 뒤 새 상대 이름을 음성으로 알리고 새 통화 화면으로 바꾼다. 상대는 받기를 눌러야 연결된다.
// 한 번 누르면 음량 한 칸, 두 번 누름은 음량을 남기지 않는다 (stepVolume·restoreVolume, 플랫폼별 차이는 modules/syncrew-duplex/index.ts).

/** 웹 자동 검증용 기록 (e2e/flows.mjs 가 window.__syncrewCycle 으로 읽는다) */
const debug = { watching: 0, presses: 0, doubles: 0, last: "" };
if (Platform.OS === "web" && typeof window !== "undefined") (window as unknown as { __syncrewCycle: typeof debug }).__syncrewCycle = debug;

/** 이 통화에서 상대 바꾸기를 받을지: 통화 중이거나 내가 거는 중(울림). 걸려 온 울림에서는 받지 않는다 */
export function callCycleEnabled(session: LiveSession | undefined, myId: string | undefined): boolean {
  if (!session || session.mode !== "call" || !myId) return false;
  if (session.status === "active") return true;
  return session.status === "ringing" && session.participants.find((p) => p.userId === myId)?.role === "caller";
}

export function useCallCycle(session: LiveSession | undefined, myId: string | undefined) {
  const { t, lang } = useT();
  const errorMessage = useErrorMessage();
  const siteId = session?.siteId ?? "";
  const members = useMembers(siteId);
  const startCall = useStartCall(siteId);
  const action = useSessionAction();
  const enabled = callCycleEnabled(session, myId);

  // 버튼 처리는 렌더와 따로 돈다 → 최신 값은 ref 로 읽는다 (값이 바뀔 때마다 네이티브 지켜보기를 다시 시작하지 않게)
  const latest = useRef({ session, myId, members: members.data, t, lang, errorMessage, startCall, action });
  latest.current = { session, myId, members: members.data, t, lang, errorMessage, startCall, action };
  /** 바꾸는 중에 또 누르면 무시한다 (끊기·걸기가 겹치지 않게). 새 화면은 새로 시작한다 */
  const switching = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const announce = (text: string) => {
      void Speech.stop();
      Speech.speak(text, { language: localeOf(latest.current.lang) });
    };

    const switchCall = async (direction: VolumeDirection) => {
      const { session: current, myId: me, members: list, t: tr } = latest.current;
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
        announce(tr("call.cycle.none"));
        toast(tr("call.cycle.none"), "default");
        return;
      }
      switching.current = true;
      try {
        await latest.current.action.mutateAsync({ sessionId: current.id, action: "end" }).catch(() => undefined);
        for (const next of candidates) {
          try {
            const created = await latest.current.startCall.mutateAsync(next.userId);
            announce(tr("call.cycle.calling", { name: next.displayName }));
            router.replace(`/site/call/${created.id}`);
            return;
          } catch (error) {
            // 그 사이 다른 통화를 시작했거나(BUSY) 접속이 끊긴(CONFLICT) 사람은 건너뛴다
            if (error instanceof ApiError && (error.code === "BUSY" || error.code === "CONFLICT")) continue;
            toast(latest.current.errorMessage(error), "error");
            return;
          }
        }
        announce(tr("call.cycle.none"));
        toast(tr("call.cycle.none"), "default");
      } finally {
        switching.current = false;
      }
    };

    const detector = createVolumeKeyDetector(
      {
        onSingle: stepVolume,
        onDouble: (direction) => {
          restoreVolume();
          void switchCall(direction);
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
  }, [enabled]);
}
