import { StyleSheet, Text, View } from "react-native";
import { colors, fontSize, spacing } from "@/theme";

/** 아직 구현되지 않은 화면. 어느 Phase에서 무엇이 들어오는지 표시한다. */
export function PlaceholderScreen({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.phase}>{phase}</Text>
        <Text style={styles.title}>{title}</Text>
        {items.map((item) => (
          <Text key={item} style={styles.item}>
            • {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  phase: { color: colors.brand, fontSize: fontSize.caption, fontWeight: "700" },
  title: { color: colors.text, fontSize: fontSize.title, fontWeight: "700", marginBottom: spacing.sm },
  item: { color: colors.textMuted, fontSize: fontSize.body, lineHeight: 24 },
});
