import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { useCurrentSite } from "@/hooks/queries";
import { colors, font, radius, spacing } from "@/theme";

/** 탭 화면 제목 위의 현재 현장 표시. 누르면 현장 전환. */
export function SiteEyebrow() {
  const { site } = useCurrentSite();
  if (!site) return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push("/sites")} style={styles.pill} hitSlop={6}>
      <Ionicons name="business" size={13} color={colors.brand} />
      <Text style={styles.text} numberOfLines={1}>
        {site.name}
      </Text>
      <Ionicons name="chevron-down" size={13} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 1,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 260,
  },
  text: { ...font.caption, fontWeight: "700", color: colors.inkSoft, flexShrink: 1 },
});
