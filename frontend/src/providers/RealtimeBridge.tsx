import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { LiveSession, MessageView, Profile } from "@shared/api";
import { enqueue } from "@/audio/playback";
import { debug as playbackDebug, wasStreamed } from "@/audio/streamed";
import { cacheSession as cacheSessionData, qk } from "@/hooks/queries";
import { translate } from "@/i18n";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";

/**
 * 실시간 이벤트(docs/realtime-protocol.md)를 받아 화면 데이터(쿼리 캐시)에 반영한다.
 * - 새 메시지: 목록에 추가, 수신 확인 전송, 자동 재생
 * - 재연결: 현장 재구독 후 전체 다시 불러오기 (누락 동기화)
 * - 실시간 통역 세션: 통화가 오거나 일괄 지시가 시작되면 해당 화면을 연다 (통화는 다른 현장·현장 목록에 있어도). 세션 발화는 설정과 무관하게 자동 재생한다.
 *   (스트리밍 통화에서 이미 들은 문장은 제외 — audio/streamed.ts)
 */
export function RealtimeBridge() {
  const client = useQueryClient();
  const siteId = useSessionStore((state) => state.siteId);
  const setConnection = useSessionStore((state) => state.setConnection);
  const setSiteId = useSessionStore((state) => state.setSiteId);
  const siteRef = useRef(siteId);
  siteRef.current = siteId;

  useEffect(() => {
    const { realtime } = services;
    const me = () => client.getQueryData<Profile | null>(qk.me);
    const lang = () => useSessionStore.getState().uiLang;
    let wasConnected = false;

    const offConnection = realtime.onConnection((state) => {
      setConnection(state);
      if (state === "connected") {
        if (siteRef.current) void realtime.subscribeSite(siteRef.current).catch(() => undefined);
        if (wasConnected) void client.invalidateQueries();
        wasConnected = true;
      }
    });

    const cacheSession = (session: LiveSession) => cacheSessionData(client, session);

    const offs = [
      realtime.on("message:new", ({ message }) => {
        if (message.sessionId) {
          client.setQueryData<MessageView[]>(qk.sessionMessages(message.sessionId), (current) =>
            current && !current.some((item) => item.id === message.id) ? [...current, message] : current,
          );
        }
        if (message.conversationId) {
          client.setQueryData<MessageView[]>(qk.messages(message.conversationId), (current) =>
            current && !current.some((item) => item.id === message.id) ? [...current, message] : current,
          );
          void client.invalidateQueries({ queryKey: qk.conversations(message.siteId) });
        } else {
          void client.invalidateQueries({ queryKey: qk.inbox(message.siteId) });
          // 실시간 지시 발화는 지시 화면에서 바로 보이므로 알림을 띄우지 않는다
          if (!message.sessionId) toast(translate(lang(), "instr.newBadge"), "default");
        }
        void realtime.sendReceipts([message.id]).catch(() => undefined);

        const profile = me();
        // 통화·실시간 지시 발화는 이어폰으로 바로 들려야 하므로 자동 재생 설정과 무관하게 재생한다.
        const live = message.sessionId !== null;
        // 단, 스트리밍 통화에서 이미 들은 문장(stream:out:end 로 받은 messageId)은 다시 재생하지 않는다 (기록에는 표시)
        if (wasStreamed(message.id)) {
          playbackDebug.skipped.push(message.id);
        } else if (profile && (profile.autoPlay || live) && message.senderId !== profile.id && message.siteId === siteRef.current) {
          playbackDebug.enqueued.push(message.id);
          enqueue({ id: message.id, text: message.text, lang: profile.preferredLang, audioUrl: message.audioUrl, rate: profile.speechRate });
        }
      }),
      realtime.on("message:status", () => {
        void client.invalidateQueries({ queryKey: ["messages"] });
        void client.invalidateQueries({ queryKey: ["sessionMessages"] });
        void client.invalidateQueries({ queryKey: ["instructions"] });
        void client.invalidateQueries({ queryKey: ["instruction"] });
      }),
      realtime.on("instruction:recipient", ({ messageId }) => {
        void client.invalidateQueries({ queryKey: qk.instruction(messageId) });
        void client.invalidateQueries({ queryKey: ["instructions"] });
      }),
      realtime.on("membership:changed", ({ siteId: changedSite, userId, status }) => {
        void client.invalidateQueries({ queryKey: qk.sites });
        void client.invalidateQueries({ queryKey: qk.members(changedSite) });
        void client.invalidateQueries({ queryKey: qk.conversations(changedSite) });
        if (userId !== me()?.id) return;
        const siteName = client.getQueryData<{ id: string; name: string }[]>(qk.sites)?.find((s) => s.id === changedSite)?.name ?? "";
        if (status === "active") toast(translate(lang(), "sites.approved", { site: siteName }), "success");
        if (status === "removed" && changedSite === siteRef.current) {
          setSiteId(null);
          toast(translate(lang(), "sites.removed"), "error");
        }
      }),
      realtime.on("join:requested", ({ siteId: changedSite }) => {
        void client.invalidateQueries({ queryKey: qk.members(changedSite) });
      }),
      realtime.on("presence:changed", () => {
        if (siteRef.current) void client.invalidateQueries({ queryKey: qk.members(siteRef.current) });
      }),
      realtime.on("sync:required", () => void client.invalidateQueries()),
      realtime.on("session:invite", ({ session }) => {
        cacheSession(session);
        if (session.siteId !== siteRef.current) {
          // 걸려 온 전화는 어느 화면에 있든 받을 수 있게 그 현장으로 바꿔서 연다 (현장 목록·다른 현장, 2026-10-26 C1).
          // 실시간 지시는 지금 현장 것만 연다 (다른 현장 일을 하는 중에 화면이 바뀌지 않게)
          if (session.mode !== "call") return;
          siteRef.current = session.siteId;
          setSiteId(session.siteId);
        }
        router.push(session.mode === "call" ? `/site/call/${session.id}` : `/site/broadcast/${session.id}`);
      }),
      realtime.on("session:updated", ({ session }) => cacheSession(session)),
      realtime.on("device:changed", ({ siteId: changedSite }) => {
        void client.invalidateQueries({ queryKey: qk.members(changedSite) });
      }),
    ];

    realtime.connect();
    // 앱이 다시 화면에 나오면 누락분을 맞춘다.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void client.invalidateQueries();
    });

    return () => {
      offs.forEach((off) => off());
      offConnection();
      appState.remove();
      realtime.disconnect();
    };
  }, [client, setConnection, setSiteId]);

  useEffect(() => {
    if (siteId) void services.realtime.subscribeSite(siteId).catch(() => undefined);
  }, [siteId]);

  return null;
}
