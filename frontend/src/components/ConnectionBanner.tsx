import { StyleSheet, Text, View } from "react-native";
import { useT } from "@/i18n";
import { useSessionStore } from "@/stores/session";
import { colors, font, spacing } from "@/theme";

/** 실시간 연결이 끊겼을 때만 상단에 표시 */
export function ConnectionBanner() {
  const { t } = useT();
  const connection = useSessionStore((state) => state.connection);
  if (connection !== "offline") return null;
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <View style={styles.dot} />
      <Text style={styles.text}>{t("net.offline")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningSoft,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  text: { ...font.caption, fontWeight: "700", color: colors.warning },
});
