import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, font, spacing } from "@/theme";

export function EmptyState({
  icon,
  message,
  action,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  message: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconRing}>
        <View style={styles.iconCircle}>
          <Ionicons name={icon} size={30} color={colors.brand} />
        </View>
      </View>
      <Text style={styles.text}>{message}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.lg, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  iconRing: { padding: 10, borderRadius: 60, backgroundColor: "#FFF8F2" },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  text: { ...font.body, color: colors.inkSoft, textAlign: "center" },
});
