import Ionicons from "@expo/vector-icons/Ionicons";
import { goHome } from "@/lib/nav";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, View, type ListRenderItem } from "react-native";
import type { LiveSession, MessageView, Profile } from "@shared/api";
import { useAudioRouteProbe } from "@/audio/useAudioRouteProbe";
import { useHandsFree } from "@/audio/useHandsFree";
import { MessageBubble, NO_RETRY } from "@/components/chat/MessageBubble";
import { DeviceChip, HeadsetNotice, InfoNotice, MicStatus } from "@/components/live/LiveParts";
import { Avatar } from "@/components/ui/Avatar";
import { LangBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { useMe, useSendUtterance, useSession, useSessionAction, useSessionMessages } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { formatTime } from "@/lib/format";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

// 관리자 실시간 일괄 지시 (docs/live-interpretation.md 4절)
// 관리자: 수신 대상 연결 상태를 보며 말하면, 대상자 각자의 언어로 통역되어 이어폰에 자동 재생된다.
// 구성원: 관리자의 지시가 내 언어로 자동 재생되고, 원문·번역문이 화면에 쌓인다.

/** 지시 중 화면이 꺼지지 않게 (휴대폰만) */
function KeepAwakeNative() {
  useKeepAwake();
  return null;
}
const KeepAwake = Platform.OS === "web" ? () => null : KeepAwakeNative;

const keyOf = (item: MessageView) => item.id;
const LIST_CONTENT = { paddingVertical: spacing.md, flexGrow: 1 };
/** 관리자 목록의 지시 1건 (memo: 새 지시가 와도 이전 항목은 다시 그리지 않는다) */
const renderSpoken: ListRenderItem<MessageView> = ({ item }) => <SpokenItem message={item} />;

export default function BroadcastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const session = useSession(id);
  const { t } = useT();

  if (!session.data || !me.data) {
    return (
      <Screen>
        <StackHeader title={t("bc.title")} />
        <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.brand} />
      </Screen>
    );
  }
  const speaker = session.data.participants.find((p) => p.role === "speaker")?.userId === me.data.id;
  return speaker ? <SpeakerConsole session={session.data} me={me.data} /> : <ListenerView session={session.data} me={me.data} />;
}

/** 관리자는 지시 탭으로, 구성원(저절로 열린 수신 화면)은 연결 탭으로 */
const closeSpeaker = () => (router.canGoBack() ? router.back() : router.replace("/site/instructions"));

// ─── 관리자 ─────────────────────────────────────────

function SpeakerConsole({ session, me }: { session: LiveSession; me: Profile }) {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const messages = useSessionMessages(session.id);
  const send = useSendUtterance(session.id);
  const action = useSessionAction();
  const connection = useSessionStore((state) => state.connection);
  const [muted, setMuted] = useState(false);
  const onError = (error: unknown) => toast(errorMessage(error), "error");
  const active = session.status === "active";
  const online = connection === "connected";

  const handsFree = useHandsFree({
    active: active && online,
    muted,
    onUtterance: (recording) => send.mutateAsync(recording).catch(onError),
    onDevice: (device) => void services.realtime.reportDevice(device).catch(() => undefined),
  });

  const listeners = session.participants.filter((p) => p.role === "listener" && !p.leftAt);
  const connected = listeners.filter((p) => p.online).length;
  const list = useMemo(() => [...(messages.data ?? [])].sort((a, b) => b.seq - a.seq), [messages.data]);

  if (!active) {
    return (
      <Screen>
        <StackHeader title={t("bc.title")} onBack={closeSpeaker} />
        <View style={styles.ended}>
          <Ionicons name="radio-outline" size={40} color={colors.muted} />
          <Text style={font.title}>{t("bc.ended")}</Text>
          <Button title={t("instr.title")} icon="megaphone-outline" variant="secondary" onPress={() => router.replace("/site/instructions")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      {online && <KeepAwake />}
      <StackHeader title={t("bc.title")} right={<LiveBadge />} />
      <FlatList
        data={list}
        keyExtractor={keyOf}
        contentContainerStyle={styles.content}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {!online && <InfoNotice text={t("call.reconnecting")} />}
            <MicStatus state={handsFree.state} error={handsFree.error} />
            <HeadsetNotice device={handsFree.device} />
            <SectionTitle title={t("bc.listeners")} right={<Text style={styles.count}>{t("bc.connected", { a: connected, b: listeners.length })}</Text>} />
            <Card padded={false}>
              {listeners.map((p) => (
                <View key={p.userId} style={styles.listener}>
                  <Avatar id={p.userId} name={p.displayName} size={36} online={p.online} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={font.bodyStrong} numberOfLines={1}>
                      {p.displayName}
                    </Text>
                    <View style={styles.row}>
                      <LangBadge lang={p.lang} />
                      {p.online ? <DeviceChip device={p.device} /> : <Text style={styles.offline}>{t("bc.offline")}</Text>}
                    </View>
                  </View>
                </View>
              ))}
            </Card>
            {connected < listeners.length && <InfoNotice text={t("bc.offlineNote")} />}
            {list.length === 0 && <Text style={styles.empty}>{t("live.empty")}</Text>}
          </View>
        }
        renderItem={renderSpoken}
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
        <View style={styles.row}>
          <Button
            title={t(muted ? "live.unmute" : "live.mute")}
            icon={muted ? "mic-off" : "mic"}
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => setMuted((value) => !value)}
          />
          <Button
            title={t("bc.end")}
            icon="stop-circle"
            variant="danger"
            style={{ flex: 1 }}
            loading={action.isPending}
            onPress={() => action.mutate({ sessionId: session.id, action: "end" }, { onError })}
          />
        </View>
        {handsFree.error && <Button title={t("common.retry")} variant="ghost" onPress={handsFree.retry} />}
      </View>
    </Screen>
  );
}

/** 관리자가 말한 지시 1건: 원문, 언어별 통역 상태. 누르면 구성원별 전달 상태 */
const SpokenItem = memo(function SpokenItem({ message }: { message: MessageView }) {
  const { t, lang } = useT();
  const pending = message.status === "queued" || message.status === "processing";
  return (
    <Card onPress={() => router.push(`/site/instruction/${message.id}`)} style={{ gap: spacing.sm }}>
      <View style={styles.row}>
        <Text style={[font.body, { flex: 1 }]}>{message.originalText ?? "…"}</Text>
        <Text style={styles.time}>{formatTime(message.createdAt, lang)}</Text>
      </View>
      <View style={[styles.row, { flexWrap: "wrap" }]}>
        {pending && <ActivityIndicator size="small" color={colors.brand} />}
        {(message.translations ?? []).map((tr) => {
          const tone = tr.status === "failed" ? colors.danger : tr.status === "done" || tr.status === "skipped" ? colors.success : colors.muted;
          const icon = tr.status === "failed" ? "close-circle" : tr.status === "done" || tr.status === "skipped" ? "checkmark-circle" : "ellipse-outline";
          return (
            <View key={tr.lang} style={styles.langChip}>
              <Ionicons name={icon} size={13} color={tone} />
              <Text style={[styles.langText, { color: tone }]}>{tr.lang.toUpperCase()}</Text>
            </View>
          );
        })}
        {(message.status === "failed" || message.status === "partially_failed") && (
          <Text style={[styles.time, { color: colors.danger }]}>{t(message.status === "failed" ? "chat.failed" : "chat.partial")}</Text>
        )}
      </View>
    </Card>
  );
});

// ─── 구성원 ─────────────────────────────────────────

function ListenerView({ session, me }: { session: LiveSession; me: Profile }) {
  const { t } = useT();
  const messages = useSessionMessages(session.id);
  const connection = useSessionStore((state) => state.connection);
  const active = session.status === "active";
  const device = useAudioRouteProbe(active, (next) => void services.realtime.reportDevice(next).catch(() => undefined));
  const list = useMemo(() => [...(messages.data ?? [])].sort((a, b) => b.seq - a.seq), [messages.data]);
  const renderItem = useCallback<ListRenderItem<MessageView>>(
    ({ item }) => <MessageBubble message={item} me={me} showSender onRetry={NO_RETRY} />,
    [me],
  );

  return (
    <Screen edges={["top", "bottom"]}>
      {active && <KeepAwake />}
      <StackHeader title={t("bc.receiving", { name: session.startedByName })} right={active ? <LiveBadge /> : undefined} onBack={goHome} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}>
        {active ? (
          <>
            {connection !== "connected" && <InfoNotice text={t("call.reconnecting")} />}
            <View style={styles.listenCard}>
              <Ionicons name="headset" size={28} color={colors.brand} />
              <Text style={[font.body, { flex: 1, color: colors.inkSoft }]}>{t("bc.listenHint")}</Text>
            </View>
            <View style={styles.row}>
              <DeviceChip device={device} />
            </View>
            <HeadsetNotice device={device} />
          </>
        ) : (
          <InfoNotice tone="info" text={t("bc.ended")} />
        )}
      </View>
      <FlatList
        inverted
        data={list}
        keyExtractor={keyOf}
        contentContainerStyle={LIST_CONTENT}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={5}
        renderItem={renderItem}
      />
    </Screen>
  );
}

function LiveBadge() {
  const { t } = useT();
  return (
    <View style={[styles.row, { paddingRight: spacing.sm }]}>
      <View style={styles.liveDot} />
      <Text style={[font.label, { color: colors.danger }]}>{t("bc.live")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  count: { ...font.caption, fontWeight: "700", color: colors.success },
  listener: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  offline: { ...font.caption, fontWeight: "700", color: colors.danger },
  empty: { ...font.body, color: colors.muted, textAlign: "center", paddingVertical: spacing.lg },
  time: { ...font.caption, color: colors.placeholder },
  langChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  langText: { ...font.caption, fontWeight: "800" },
  controls: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  ended: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  listenCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
});
