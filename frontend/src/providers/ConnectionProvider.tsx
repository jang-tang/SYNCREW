import { useKeepAwake } from "expo-keep-awake";
import * as Speech from "expo-speech";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import type { DeviceStatus, LiveSession, MessageView, SessionParticipant } from "@shared/api";
import type { MyCaption } from "@/audio/myCaptions";
import { useCallCycle } from "@/audio/useCallCycle";
import { useHandsFree } from "@/audio/useHandsFree";
import { useStreamingCall, type Caption, type StreamMode } from "@/audio/useStreamingCall";
import { useActiveConnection, useMe, useSendUtterance, useSession, useSessionAction, useSessionMessages } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { localeOf } from "@/lib/format";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";

// 1:1 연결 (C2 "연결" 방식, docs/live-interpretation.md 3-2절, 2026-10-26).
// 연결은 앱 전체에 하나뿐이고, 어느 화면에 있든 음성은 계속 오간다 (예전에는 통화 화면 안에서만).
// 화면(멤버 탭의 연결 패널·다른 탭의 배너)은 useConnection() 으로 상태를 읽는다.
// 통화 중에는 먼저 스트리밍 통역을 시도하고, 안 되면 발화 단위 방식 (예전 통화 화면과 같다).
// 녹음·스트리밍(ConnectionAudio)은 연결이 있을 때만 만든다 — 앱 맨 위에서 늘 녹음기를 만들면 Android 에서 화면(activity)이
// 준비되기 전에 만들어져 "The current activity is no longer available" 오류 화면이 떴다 (10-26 Note 9).

type MicState = ReturnType<typeof useHandsFree>["state"];
type MicError = ReturnType<typeof useHandsFree>["error"];

/** 연결 중 음성 상태 (ConnectionAudio 가 알린다) */
type AudioReport = {
  streaming: { mode: StreamMode; captions: Caption[]; myCaptions: MyCaption[]; state: MicState; error: MicError };
  handsFree: { state: MicState; error: MicError; device: DeviceStatus | null; retry: () => void };
};

const IDLE_AUDIO: AudioReport = {
  streaming: { mode: "off", captions: [], myCaptions: [], state: "off", error: null },
  handsFree: { state: "off", error: null, device: null, retry: () => undefined },
};

type Connection = {
  /** 지금 연결 (통화 중인 1:1 세션) */
  session: LiveSession | undefined;
  peer: SessionParticipant | undefined;
  streaming: AudioReport["streaming"];
  /** 스트리밍(또는 같은 언어 직접 전달) 중인지 */
  streamingOn: boolean;
  handsFree: AudioReport["handsFree"];
  /** 지금 쓰는 마이크 상태 (스트리밍이면 스트리밍, 아니면 발화 단위) */
  mic: { state: MicState; error: MicError };
  /** 발화 단위 방식일 때 이 연결의 최근 메시지 (스트리밍은 자막으로 보인다) */
  lastMessage: MessageView | undefined;
  online: boolean;
  /** 다음 사람으로 전환 (음량 up 두 번과 같다) */
  next: () => void;
  /** 연결에서 나가기 */
  leave: () => void;
  /** 데모 모드 전용: 말한 것으로 보내기 */
  sendDemo: () => void;
};

const ConnectionContext = createContext<Connection | null>(null);

export function useConnection(): Connection {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("ConnectionProvider 밖에서 useConnection 을 썼습니다.");
  return value;
}

/** 연결 중 화면이 꺼지지 않게 (휴대폰만. 웹은 브라우저 화면 잠금 API가 불안정해 쓰지 않는다) */
function KeepAwakeNative() {
  useKeepAwake();
  return null;
}
const KeepAwake = Platform.OS === "web" ? () => null : KeepAwakeNative;

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useT();
  const errorMessage = useErrorMessage();
  const signedIn = useSessionStore((state) => state.authStatus === "signedIn");
  const siteId = useSessionStore((state) => state.siteId) ?? "";
  const connection = useSessionStore((state) => state.connection);
  const me = useMe(signedIn);
  const myId = me.data?.id;
  const listed = useActiveConnection(signedIn ? siteId : "");
  // 목록은 다시 불러와야 바뀌므로, 실시간으로 바로 갱신되는 세션 상세를 함께 본다 (끝나면 즉시 소리를 멈추게)
  const detail = useSession(listed?.id ?? "");
  const session = detail.data?.status === "active" ? detail.data : undefined;
  const peer = session?.participants.find((p) => p.userId !== myId);
  const online = connection === "connected";
  const active = !!session && online;
  const action = useSessionAction();
  const send = useSendUtterance(session?.id ?? "");
  const messages = useSessionMessages(session?.id ?? "");
  const [audio, setAudio] = useState<AudioReport>(IDLE_AUDIO);
  /** 상대 이름 안내를 말하는 동안만 마이크를 끈다 (안내 소리가 상대에게 통역돼 가지 않게) */
  const [announcing, setAnnouncing] = useState(false);
  const [announcement, setAnnouncement] = useState<{ text: string; sessionId: string } | null>(null);
  const announce = useCallback((text: string, sessionId: string) => setAnnouncement({ text, sessionId }), []);
  const report = useCallback((next: AudioReport) => setAudio(next), []);
  const { streaming, handsFree } = session ? audio : IDLE_AUDIO;
  const streamingOn = streaming.mode === "stream" || streaming.mode === "relay";
  // 음량 버튼 두 번으로 다음·이전 사람에게 전환 (C1). 연결 패널의 "다음 멤버" 버튼도 같은 전환
  const cycle = useCallCycle(session, myId, announce);

  // 이름 안내는 그 연결의 오디오가 켜진 뒤에 말한다 (10-27 iPhone: 전환 직후 바로 말하면 앞 연결의 오디오가 꺼지며 끊기고,
  // 통화 밖에서는 미디어 음량(그 iPhone 은 0.05)으로 나와 거의 안 들렸다)
  const audioReady = streaming.mode === "stream" || streaming.mode === "relay" || streaming.mode === "utterance";
  useEffect(() => {
    if (!announcement) return;
    if (session && session.id !== announcement.sessionId) return setAnnouncement(null);
    if (!session || !audioReady) return;
    setAnnouncement(null);
    setAnnouncing(true);
    const done = () => setAnnouncing(false);
    void Speech.stop();
    Speech.speak(announcement.text, { language: localeOf(lang), onDone: done, onStopped: done, onError: done });
    // 끝 알림이 오지 않아도 마이크가 꺼진 채 남지 않게 (setAnnouncement 로 이 effect 가 다시 돌아도 지워지지 않도록 cleanup 에 두지 않는다)
    setTimeout(done, 5000);
  }, [announcement, session, audioReady, lang]);

  // 연결 알림: 누가 나에게 연결했을 때, 상대가 나가거나 다른 사람으로 바꿨을 때 (내가 나가거나 바꾼 때는 알리지 않는다)
  const previous = useRef<{ id: string; peerName: string } | null>(null);
  const leaving = useRef(false);
  useEffect(() => {
    const before = previous.current;
    if (session && peer) {
      if (before?.id !== session.id) {
        const mine = session.participants.find((p) => p.userId === myId);
        if (mine?.role === "callee") toast(t("conn.connected", { name: peer.displayName }), "success");
        // 새 연결에서만 되돌린다 — 다시 그릴 때마다 되돌리면 내가 나가는 사이 false 가 되어 나에게도 "끝났어요" 가 떴다 (10-27)
        leaving.current = false;
      }
      previous.current = { id: session.id, peerName: peer.displayName };
      return;
    }
    if (before && !leaving.current) toast(t("conn.ended", { name: before.peerName }), "default");
    previous.current = null;
    leaving.current = false;
  }, [session?.id, peer?.displayName, myId, session, peer, t]);
  // 다른 사람으로 바뀌면 앞 연결의 자막·상태를 지운다
  useEffect(() => setAudio(IDLE_AUDIO), [session?.id]);
  // 연결이 끝나면 음성 상태를 원래대로
  useEffect(() => {
    if (session) return;
    setAnnouncing(false);
    setAudio(IDLE_AUDIO);
  }, [session]);

  const value = useMemo<Connection>(
    () => ({
      session,
      peer,
      streaming,
      streamingOn,
      handsFree,
      mic: streamingOn ? { state: streaming.state, error: streaming.error } : { state: handsFree.state, error: handsFree.error },
      lastMessage: messages.data?.reduce<MessageView | undefined>((last, m) => (!last || m.seq > last.seq ? m : last), undefined),
      online,
      next: () => void cycle("up"),
      leave: () => {
        if (!session) return;
        leaving.current = true;
        action.mutate({ sessionId: session.id, action: "end" }, { onError: (error) => toast(errorMessage(error), "error") });
      },
      sendDemo: () => send.mutate({ uri: "demo", mimeType: "audio/mp4" }, { onError: (error) => toast(errorMessage(error), "error") }),
    }),
    [session, peer, streaming, streamingOn, handsFree, messages.data, online, cycle, action, errorMessage, send],
  );

  return (
    <ConnectionContext.Provider value={value}>
      {active && <KeepAwake />}
      {session && <ConnectionAudio key={session.id} sessionId={session.id} active={active} muted={announcing} onReport={report} />}
      {children}
    </ConnectionContext.Provider>
  );
}

/** 연결 중에만 있는 음성 부분: 스트리밍 통역 → 안 되면 발화 단위 (예전 통화 화면과 같다). 연결마다 새로 만든다 (key) */
function ConnectionAudio({
  sessionId,
  active,
  muted,
  onReport,
}: {
  sessionId: string;
  active: boolean;
  muted: boolean;
  onReport: (report: AudioReport) => void;
}) {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const send = useSendUtterance(sessionId);
  const reportDevice = (device: Parameters<typeof services.realtime.reportDevice>[0]) =>
    void services.realtime.reportDevice(device).catch(() => undefined);

  const streaming = useStreamingCall({
    sessionId,
    active,
    // 연결되면 마이크는 늘 켜 둔다 (C2 — 마이크 끄기 버튼 없음, 10-27 사용자). 상대 이름 안내 중에만 끈다
    muted,
    onDevice: reportDevice,
    onFallback: (reason) => toast(t(reason === "BUDGET_EXCEEDED" ? "stream.fallbackBudget" : "stream.fallback"), "error"),
  });
  const handsFree = useHandsFree({
    // 연결이 끊긴 동안은 보내지 못하므로 듣기를 멈춘다. 스트리밍 중에는 쓰지 않는다
    active: active && streaming.mode === "utterance",
    muted,
    onUtterance: (recording) => send.mutateAsync(recording).catch((error: unknown) => toast(errorMessage(error), "error")),
    onDevice: reportDevice,
  });

  // 위로 알리는 것은 값이 바뀔 때만 (훅이 렌더마다 새 객체를 돌려주므로 그대로 알리면 끝없이 다시 그린다)
  const retry = useRef(handsFree.retry);
  retry.current = handsFree.retry;
  useEffect(() => {
    onReport({
      streaming: { mode: streaming.mode, captions: streaming.captions, myCaptions: streaming.myCaptions, state: streaming.state, error: streaming.error },
      handsFree: { state: handsFree.state, error: handsFree.error, device: handsFree.device, retry: () => retry.current() },
    });
  }, [onReport, streaming.mode, streaming.captions, streaming.myCaptions, streaming.state, streaming.error, handsFree.state, handsFree.error, handsFree.device]);
  return null;
}
