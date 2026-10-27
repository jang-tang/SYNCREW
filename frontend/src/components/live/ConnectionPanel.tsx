import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/ui/Avatar";
import { LangBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { useConnection } from "@/providers/ConnectionProvider";
import { services } from "@/services";
import { colors, font, radius, spacing } from "@/theme";
import { LiveCaptions, ModeChip, MyCaptions } from "./CallParts";
import { DeviceChip, HeadsetNotice, InfoNotice, MicStatus } from "./LiveParts";

/**
 * 연결 화면(멤버 탭) 위쪽 패널 (C2 "연결" 방식, 2026-10-26).
 * 연결 전: 사람을 누르면 바로 연결된다는 안내. 연결 중: 상대·통역 방식·마이크·자막, 나가기·다음 멤버 (마이크는 늘 켜짐, 10-27).
 * 음성은 ConnectionProvider 가 앱 전체에서 맡으므로 이 화면을 떠나도 연결은 계속된다.
 */
export function ConnectionPanel() {
  const { t } = useT();
  const c = useConnection();

  if (!c.session || !c.peer) {
    return (
      <View style={[styles.panel, styles.idle]}>
        <Ionicons name="radio-outline" size={22} color={colors.brand} />
        <Text style={[font.caption, { color: colors.inkSoft, flex: 1, lineHeight: 18 }]}>{t("conn.hint")}</Text>
      </View>
    );
  }

  const peer = c.peer;
  const showStreamCaptions = c.streaming.mode === "stream";
  return (
    <View style={[styles.panel, styles.live]} accessibilityLabel={t("conn.with", { name: peer.displayName })}>
      <View style={styles.row}>
        <Avatar id={peer.userId} name={peer.displayName} size={44} online={peer.online} highlighted />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={font.headline} numberOfLines={1}>
            {t("conn.with", { name: peer.displayName })}
          </Text>
          <View style={styles.row}>
            <LangBadge lang={peer.lang} />
            <Text style={[font.caption, { color: colors.muted }]}>{nativeNameOf(peer.lang)}</Text>
            <DeviceChip device={peer.device} />
          </View>
        </View>
      </View>
      {!c.online && <InfoNotice text={t("call.reconnecting")} />}
      {c.online && !peer.online && <InfoNotice text={t("call.peerOffline")} />}
      <ModeChip mode={c.streaming.mode} />
      <MicStatus state={c.mic.state} error={c.mic.error} />
      {!c.streamingOn && <HeadsetNotice device={c.handsFree.device} />}
      {showStreamCaptions && <LiveCaptions captions={c.streaming.captions} peerName={peer.displayName} />}
      {showStreamCaptions && <MyCaptions captions={c.streaming.myCaptions} />}
      {!c.streamingOn && c.lastMessage?.text ? (
        <View style={styles.message}>
          <Text style={[font.caption, { color: colors.muted }]}>{c.lastMessage.senderName}</Text>
          <Text style={font.bodyStrong}>{c.lastMessage.text}</Text>
        </View>
      ) : null}
      {services.mode === "mock" && <Button title={t("live.demoSpeak")} icon="sparkles-outline" variant="ghost" onPress={c.sendDemo} />}
      <View style={styles.actions}>
        <Button title={t("conn.leave")} icon="exit-outline" variant="danger" size="md" style={{ flex: 1 }} onPress={c.leave} />
        <Button title={t("conn.next")} icon="play-skip-forward" size="md" style={{ flex: 1 }} onPress={c.next} />
      </View>
      {!c.streamingOn && c.handsFree.error && <Button title={t("common.retry")} variant="secondary" onPress={c.handsFree.retry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  idle: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  live: { borderWidth: 2, borderColor: colors.brand },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  message: { padding: spacing.md, borderRadius: 12, backgroundColor: colors.surfaceAlt, gap: 2 },
  actions: { flexDirection: "row", gap: spacing.sm },
});
