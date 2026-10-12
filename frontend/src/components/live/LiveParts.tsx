import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DeviceStatus, LiveSession } from "@shared/api";
import type { HandsFreeError, HandsFreeState } from "@/audio/useHandsFree";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { useMe, useOpenSessions, useSiteId } from "@/hooks/queries";
import { useT, type StringKey } from "@/i18n";
import { colors, font, radius, spacing } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

// 실시간 통역 화면 공통 부품: 마이크 상태, 오디오 장치, 진행 중 세션 배너

const STATE_TEXT: Record<HandsFreeState, StringKey> = {
  off: "live.off",
  starting: "live.starting",
  listening: "live.listening",
  speaking: "live.speaking",
  paused: "live.paused",
  muted: "live.muted",
  error: "live.recordFailed",
};

/** 핸즈프리 마이크 상태 + 음량 표시 */
export function MicStatus({ state, error, level }: { state: HandsFreeState; error: HandsFreeError | null; level: number }) {
  const { t } = useT();
  const active = state === "listening" || state === "speaking";
  const tone = state === "error" ? colors.danger : state === "speaking" ? colors.brand : active ? colors.success : colors.muted;
  const icon: IconName = state === "muted" ? "mic-off" : state === "paused" ? "volume-high" : state === "error" ? "alert-circle" : "mic";
  const text = state === "error" && error === "permission" ? t("live.micDenied") : t(STATE_TEXT[state]);
  return (
    <View style={styles.mic} accessibilityLiveRegion="polite">
      <View style={[styles.micIcon, { backgroundColor: tone }]}>
        <Ionicons name={icon} size={26} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={[font.bodyStrong, state === "error" && { color: colors.danger }]}>{text}</Text>
        {active && (
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%`, backgroundColor: tone }]} />
          </View>
        )}
      </View>
    </View>
  );
}

const ROUTE: Record<DeviceStatus["audioRoute"], { icon: IconName; text: StringKey; tone: string }> = {
  bluetooth: { icon: "bluetooth", text: "audio.bluetooth", tone: colors.info },
  wired: { icon: "headset", text: "audio.wired", tone: colors.info },
  builtin: { icon: "phone-portrait-outline", text: "audio.builtin", tone: colors.warning },
  unknown: { icon: "help-circle-outline", text: "audio.unknown", tone: colors.muted },
};

/** 오디오 장치 표시 (작은 칩) */
export function DeviceChip({ device }: { device: DeviceStatus | null | undefined }) {
  const { t } = useT();
  if (!device) {
    return (
      <View style={styles.chip}>
        <Ionicons name="remove-circle-outline" size={14} color={colors.muted} />
        <Text style={[styles.chipText, { color: colors.muted }]}>{t("audio.none")}</Text>
      </View>
    );
  }
  const route = ROUTE[device.audioRoute];
  const label = device.audioRoute === "bluetooth" && device.inputName ? device.inputName : t(route.text);
  return (
    <View style={styles.chip}>
      <Ionicons name={route.icon} size={14} color={route.tone} />
      <Text style={[styles.chipText, { color: route.tone }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** 휴대폰 마이크·스피커로 확인됐을 때만 이어폰 연결 안내 (확인할 수 없으면 단정하지 않는다) */
export function HeadsetNotice({ device }: { device: DeviceStatus | null }) {
  const { t } = useT();
  if (device?.audioRoute !== "builtin") return null;
  return (
    <View style={styles.notice}>
      <Ionicons name="headset-outline" size={18} color={colors.warning} />
      <Text style={styles.noticeText}>{t("audio.noHeadset")}</Text>
    </View>
  );
}

export function InfoNotice({ text, tone = "warning" }: { text: string; tone?: "warning" | "info" | "danger" }) {
  const color = tone === "info" ? colors.info : tone === "danger" ? colors.danger : colors.warning;
  const background = tone === "info" ? colors.infoSoft : tone === "danger" ? colors.dangerSoft : colors.warningSoft;
  return (
    <View style={[styles.notice, { backgroundColor: background }]}>
      <Ionicons name={tone === "info" ? "information-circle" : "alert-circle"} size={18} color={color} />
      <Text style={[styles.noticeText, { color }]}>{text}</Text>
    </View>
  );
}

/** 탭 화면 상단: 연결 끊김 + 진행 중인 통화·실시간 지시로 돌아가기 */
export function SiteBanners() {
  const { t } = useT();
  const siteId = useSiteId();
  const me = useMe();
  const open = useOpenSessions(siteId);
  const live = open.data?.find((s) => s.status === "active" || (s.status === "ringing" && s.startedBy !== me.data?.id));
  return (
    <>
      <ConnectionBanner />
      {live && <LiveBanner session={live} label={t(live.mode === "call" ? "call.banner" : "bc.banner")} />}
    </>
  );
}

function LiveBanner({ session, label }: { session: LiveSession; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(session.mode === "call" ? `/site/call/${session.id}` : `/site/broadcast/${session.id}`)}
      style={styles.banner}
    >
      <View style={styles.liveDot} />
      <Text style={styles.bannerText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mic: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  micIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  meter: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  meterFill: { height: 6, borderRadius: 3 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: 180,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  chipText: { ...font.caption, fontWeight: "700" },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  noticeText: { ...font.caption, color: colors.warning, flex: 1, lineHeight: 18 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.success,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FFFFFF" },
  bannerText: { ...font.label, color: "#FFFFFF", flex: 1 },
});
