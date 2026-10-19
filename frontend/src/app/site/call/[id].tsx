import Ionicons from "@expo/vector-icons/Ionicons";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState, type ComponentProps } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { SessionEndReason } from "@shared/api";
import { useHandsFree } from "@/audio/useHandsFree";
import type { MyCaption } from "@/audio/myCaptions";
import { useStreamingCall, type Caption, type StreamMode } from "@/audio/useStreamingCall";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { DeviceChip, HeadsetNotice, InfoNotice, MicStatus } from "@/components/live/LiveParts";
import { Avatar } from "@/components/ui/Avatar";
import { LangBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { useMe, useSendUtterance, useSession, useSessionAction, useSessionMessages } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT, type StringKey } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { colors, font, spacing } from "@/theme";

/**
 * 역순(inverted) 목록의 빈 화면 보정. 네이티브는 React Native 가 빈 화면을 이미 바로 세워 주므로 웹에서만 뒤집는다.
 * (네이티브에서도 뒤집으면 Android 는 좌우 거울 글자, iOS 는 거꾸로 보인다 — 2026-10-14 Galaxy S22 실기기에서 발견)
 */
const WEB_EMPTY_FLIP = Platform.OS === "web" ? { transform: [{ scaleY: -1 as const }] } : {};

// 1:1 실시간 통역 통화 (docs/live-interpretation.md 3절)
// 울림(건 사람: 부르는 중 / 받는 사람: 받기·거절) → 통화 중(핸즈프리: 말하면 자동 통역, 받은 통역 자동 재생) → 종료
// 통화 중에는 먼저 스트리밍 통역(말하는 동안 전송, docs/streaming-plan.md)을 시도하고, 안 되면 발화 단위 방식으로 한다.

const END_TEXT: Record<SessionEndReason, StringKey> = {
  hangup: "call.ended.hangup",
  declined: "call.ended.declined",
  missed: "call.ended.missed",
  cancelled: "call.ended.cancelled",
  connection_lost: "call.ended.connection_lost",
  removed: "call.ended.removed",
};

/** 통화 중 화면이 꺼지지 않게 (휴대폰만. 웹은 브라우저 화면 잠금 API가 불안정해 쓰지 않는다) */
function KeepAwakeNative() {
  useKeepAwake();
  return null;
}
const KeepAwake = Platform.OS === "web" ? () => null : KeepAwakeNative;

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const session = useSession(id);
  const messages = useSessionMessages(id);
  const action = useSessionAction();
  const send = useSendUtterance(id);
  const connection = useSessionStore((state) => state.connection);
  const [muted, setMuted] = useState(false);

  const data = session.data;
  const myId = me.data?.id;
  const mine = data?.participants.find((p) => p.userId === myId);
  const peer = data?.participants.find((p) => p.userId !== myId);
  const active = data?.status === "active";
  const online = connection === "connected";

  const reportDevice = (device: Parameters<typeof services.realtime.reportDevice>[0]) =>
    void services.realtime.reportDevice(device).catch(() => undefined);

  const streaming = useStreamingCall({
    sessionId: id,
    active: active && online,
    muted,
    onDevice: reportDevice,
    onFallback: (reason) => toast(t(reason === "BUDGET_EXCEEDED" ? "stream.fallbackBudget" : "stream.fallback"), "error"),
  });
  const streamingOn = streaming.mode === "stream" || streaming.mode === "relay";

  const handsFree = useHandsFree({
    // 연결이 끊긴 동안은 보내지 못하므로 듣기를 멈춘다. 스트리밍 중에는 쓰지 않는다
    active: active && online && streaming.mode === "utterance",
    muted,
    onUtterance: (recording) => send.mutateAsync(recording).catch((error: unknown) => toast(errorMessage(error), "error")),
    onDevice: reportDevice,
  });
  const mic = streamingOn ? streaming : handsFree;

  const list = useMemo(() => [...(messages.data ?? [])].sort((a, b) => b.seq - a.seq), [messages.data]);
  const onError = (error: unknown) => toast(errorMessage(error), "error");
  const act = (kind: "accept" | "decline" | "end") => action.mutate({ sessionId: id, action: kind }, { onError });
  const close = () => (router.canGoBack() ? router.back() : router.replace("/site"));

  if (!data || !me.data || !peer) {
    return (
      <Screen>
        <StackHeader title={t("call.start")} />
        <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.brand} />
      </Screen>
    );
  }

  const header = (
    <View style={styles.peer}>
      <Avatar id={peer.userId} name={peer.displayName} size={40} online={peer.online} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={font.headline} numberOfLines={1}>
          {peer.displayName}
        </Text>
        <View style={styles.row}>
          <LangBadge lang={peer.lang} />
          <Text style={styles.sub}>{nativeNameOf(peer.lang)}</Text>
          {active && <DeviceChip device={peer.device} />}
        </View>
      </View>
    </View>
  );

  // ─── 울림 ───
  if (data.status === "ringing") {
    const incoming = mine?.role === "callee";
    return (
      <Screen background={colors.ink}>
        <View style={styles.ringing}>
          <Avatar id={peer.userId} name={peer.displayName} size={96} />
          <Text style={[font.title, { color: "#FFFFFF", textAlign: "center" }]}>
            {t(incoming ? "call.ringingIn" : "call.ringingOut", { name: peer.displayName })}
          </Text>
          <View style={styles.row}>
            <LangBadge lang={peer.lang} inverse />
            <Text style={{ ...font.label, color: "rgba(255,255,255,0.7)" }}>{nativeNameOf(peer.lang)}</Text>
          </View>
          <Text style={styles.ringHint}>{t("live.empty")}</Text>
        </View>
        <View style={styles.ringButtons}>
          {incoming ? (
            <>
              <RoundButton icon="close" label={t("call.decline")} color={colors.danger} labelColor="#FFFFFF" onPress={() => act("decline")} />
              <RoundButton icon="call" label={t("call.accept")} color={colors.success} labelColor="#FFFFFF" onPress={() => act("accept")} />
            </>
          ) : (
            <RoundButton icon="close" label={t("call.cancel")} color={colors.danger} labelColor="#FFFFFF" onPress={() => act("end")} />
          )}
        </View>
      </Screen>
    );
  }

  // ─── 종료 ───
  if (data.status === "ended") {
    return (
      <Screen>
        <StackHeader subtitle={header} onBack={close} />
        <View style={styles.ended}>
          <Ionicons name="call-outline" size={40} color={colors.muted} />
          <Text style={font.title}>{t(END_TEXT[data.endReason ?? "hangup"])}</Text>
          {data.conversationId && (
            <Button title={t("call.backToHistory")} icon="chatbubbles-outline" variant="secondary" onPress={() => router.replace(`/site/chat/${data.conversationId}`)} />
          )}
          <Button title={t("common.close")} variant="ghost" onPress={close} />
        </View>
      </Screen>
    );
  }

  // ─── 통화 중 ───
  return (
    <Screen edges={["top", "bottom"]}>
      {active && online && <KeepAwake />}
      <StackHeader subtitle={header} right={<LiveIndicator />} />
      <View style={styles.status}>
        {!online && <InfoNotice text={t("call.reconnecting")} />}
        {online && !peer.online && <InfoNotice text={t("call.peerOffline")} />}
        <ModeChip mode={streaming.mode} />
        <MicStatus state={mic.state} error={mic.error} level={mic.level} />
        {!streamingOn && <HeadsetNotice device={handsFree.device} />}
        {streaming.mode === "stream" && <LiveCaptions captions={streaming.captions} peerName={peer.displayName} />}
        {streaming.mode === "stream" && <MyCaptions captions={streaming.myCaptions} />}
      </View>
      <FlatList
        inverted
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingVertical: spacing.md, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ ...WEB_EMPTY_FLIP, padding: spacing.xl, gap: spacing.sm }}>
            <Text style={[font.body, { color: colors.inkSoft, textAlign: "center" }]}>{t("live.empty")}</Text>
            <Text style={[font.caption, { color: colors.muted, textAlign: "center" }]}>{t("live.notice")}</Text>
          </View>
        }
        renderItem={({ item }) => <MessageBubble message={item} me={me.data!} showSender={false} onRetry={() => undefined} />}
      />
      <View style={styles.controls}>
        {services.mode === "mock" && (
          <Button
            title={t("live.demoSpeak")}
            icon="sparkles-outline"
            variant="ghost"
            onPress={() => send.mutate({ uri: "demo", mimeType: "audio/mp4" }, { onError })}
          />
        )}
        <View style={styles.controlRow}>
          <RoundButton
            icon={muted ? "mic-off" : "mic"}
            label={t(muted ? "live.unmute" : "live.mute")}
            color={muted ? colors.muted : colors.ink}
            onPress={() => setMuted((value) => !value)}
          />
          <RoundButton icon="call" label={t("call.hangup")} color={colors.danger} rotate onPress={() => act("end")} />
        </View>
        {!streamingOn && handsFree.error && (
          <Button title={t("common.retry")} variant="secondary" onPress={handsFree.retry} />
        )}
      </View>
    </Screen>
  );
}

const MODE_TEXT: Partial<Record<StreamMode, StringKey>> = {
  connecting: "stream.connecting",
  stream: "stream.mode.stream",
  relay: "stream.mode.relay",
  utterance: "stream.mode.utterance",
};

/** 지금 통역 방식 (실시간 스트리밍 / 같은 언어 직접 전달 / 문장 단위) */
function ModeChip({ mode }: { mode: StreamMode }) {
  const { t } = useT();
  const key = MODE_TEXT[mode];
  if (!key) return null;
  const tone = mode === "stream" || mode === "relay" ? colors.success : colors.muted;
  return (
    <View style={[styles.row, styles.modeChip]}>
      <Ionicons name={mode === "utterance" ? "chatbox-ellipses-outline" : "pulse"} size={14} color={tone} />
      <Text style={[font.caption, { color: tone, fontWeight: "700" }]}>{t(key)}</Text>
    </View>
  );
}

/** 상대 말의 실시간 자막: 번역(크게) + 원문(작게). 가장 최근 턴만 */
function LiveCaptions({ captions, peerName }: { captions: Caption[]; peerName: string }) {
  const { t } = useT();
  const last = captions.at(-1);
  if (!last) return null;
  return (
    <View style={styles.caption} accessibilityLiveRegion="polite">
      <Text style={[font.caption, { color: colors.muted }]}>{peerName}</Text>
      <Text style={[font.bodyStrong, last.status === "failed" && { color: colors.danger }]}>
        {last.status === "failed" ? t("stream.failed") : last.translation || "…"}
      </Text>
      {last.original && <Text style={[font.caption, { color: colors.inkSoft }]}>{last.original}</Text>}
    </View>
  );
}

/** 내 말 자막: 말하는 순간부터 상태(듣는 중 → 받아쓰는 중 조각 → 원문·번역)를 보여 준다. 가장 최근 말만 (2026-10-19) */
function MyCaptions({ captions }: { captions: MyCaption[] }) {
  const { t } = useT();
  const last = captions.at(-1);
  if (!last) return null;
  const failed = last.status === "failed";
  // 완성본 원문 → 받아쓰는 중 조각 → 둘 다 없으면 상태 문구
  const original = last.original ?? (last.partial || null);
  const pending = last.status === "speaking" ? t("stream.mine.speaking") : t("stream.mine.processing");
  return (
    <View style={[styles.caption, styles.mine]} accessibilityLiveRegion="polite">
      <Text style={[font.caption, { color: colors.muted }]}>{t("stream.mine.me")}</Text>
      <Text style={[font.bodyStrong, failed && { color: colors.danger }]}>
        {failed && !original ? t("stream.mine.failed") : (original ?? pending)}
      </Text>
      {!failed && last.translation ? <Text style={[font.caption, { color: colors.inkSoft }]}>{last.translation}</Text> : null}
      {failed && original ? <Text style={[font.caption, { color: colors.danger }]}>{t("stream.failed")}</Text> : null}
    </View>
  );
}

function LiveIndicator() {
  const { t } = useT();
  return (
    <View style={[styles.row, { paddingRight: spacing.sm }]}>
      <View style={styles.liveDot} />
      <Text style={[font.label, { color: colors.success }]}>{t("call.connected")}</Text>
    </View>
  );
}

function RoundButton({
  icon,
  label,
  color,
  onPress,
  rotate,
  labelColor = colors.inkSoft,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  color: string;
  onPress: () => void;
  rotate?: boolean;
  labelColor?: string;
}) {
  // 아이콘과 글자 모두 누를 수 있게 한 덩어리로 (장갑 낀 손)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ alignItems: "center", gap: spacing.xs }}>
      <View style={[styles.round, { backgroundColor: color }]}>
        <Ionicons name={icon} size={30} color="#FFFFFF" style={rotate ? { transform: [{ rotate: "135deg" }] } : undefined} />
      </View>
      <Text style={[font.label, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  peer: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  sub: { ...font.caption, color: colors.muted },
  status: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  controls: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  controlRow: { flexDirection: "row", justifyContent: "space-evenly" },
  round: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  ringing: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.xl },
  ringHint: { ...font.caption, color: "rgba(255,255,255,0.6)", textAlign: "center", lineHeight: 18 },
  ringButtons: { flexDirection: "row", justifyContent: "space-evenly", paddingBottom: spacing.xxxl },
  ended: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  modeChip: { alignSelf: "flex-start" },
  caption: { padding: spacing.md, borderRadius: 12, backgroundColor: colors.surfaceAlt, gap: 2 },
  mine: { alignSelf: "flex-end", maxWidth: "90%", borderWidth: 1, borderColor: colors.border },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
});
