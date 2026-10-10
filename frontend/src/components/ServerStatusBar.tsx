import { Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "@/i18n/strings";
import { useServerHealth, type ServerStatus } from "@/providers/ServerHealthProvider";
import { colors, fontSize, spacing } from "@/theme";

const STATUS_COLOR: Record<ServerStatus, string> = {
  checking: colors.textMuted,
  online: colors.success,
  degraded: colors.warning,
  offline: colors.danger,
};

/** 화면 상단 고정 연결 상태 표시. 누르면 즉시 다시 확인한다. */
export function ServerStatusBar() {
  const { status, refresh } = useServerHealth();
  return (
    <Pressable
      onPress={refresh}
      accessibilityRole="button"
      accessibilityLabel={t(`server.${status}`)}
      style={[styles.bar, { backgroundColor: STATUS_COLOR[status] }]}
    >
      <View style={styles.dot} />
      <Text style={styles.text}>{t(`server.${status}`)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  text: { color: "#FFFFFF", fontSize: fontSize.caption, fontWeight: "700" },
});
