import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, spacing } from "@/theme";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.item, active && styles.active]}
          >
            <Text style={[font.label, { color: active ? colors.ink : colors.muted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  item: { flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm + 1 },
  active: {
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
});

export const segmentedSpacing = spacing.sm;
