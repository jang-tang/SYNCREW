import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { MessageView, Profile } from "@shared/api";
import { enqueue } from "@/audio/playback";
import { qk } from "@/hooks/queries";
import { translate } from "@/i18n";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";

/**
 * 실시간 이벤트(docs/realtime-protocol.md)를 받아 화면 데이터(쿼리 캐시)에 반영한다.
 * - 새 메시지: 목록에 추가, 수신 확인 전송, 자동 재생
 * - 재연결: 현장 재구독 후 전체 다시 불러오기 (누락 동기화)
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

    const offs = [
      realtime.on("message:new", ({ message }) => {
        if (message.conversationId) {
          client.setQueryData<MessageView[]>(qk.messages(message.conversationId), (current) =>
            current && !current.some((item) => item.id === message.id) ? [...current, message] : current,
          );
          void client.invalidateQueries({ queryKey: qk.conversations(message.siteId) });
        } else {
          void client.invalidateQueries({ queryKey: qk.inbox(message.siteId) });
          toast(translate(lang(), "instr.newBadge"), "default");
        }
        void realtime.sendReceipts([message.id]).catch(() => undefined);

        const profile = me();
        if (profile?.autoPlay && message.senderId !== profile.id && message.siteId === siteRef.current) {
          enqueue({ id: message.id, text: message.text, lang: profile.preferredLang, audioUrl: message.audioUrl, rate: profile.speechRate });
        }
      }),
      realtime.on("message:status", () => {
        void client.invalidateQueries({ queryKey: ["messages"] });
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
