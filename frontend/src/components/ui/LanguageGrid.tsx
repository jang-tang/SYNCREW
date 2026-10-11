import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SUPPORTED_LANGUAGES, type Lang } from "@shared/languages";
import { colors, font, radius, spacing } from "@/theme";

/** 큰 언어 선택 목록 (현장에서 바로 찾을 수 있게 모국어 표기) */
export function LanguageGrid({
  value,
  onChange,
  tone = "light",
}: {
  value: Lang | null;
  onChange: (lang: Lang) => void;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {SUPPORTED_LANGUAGES.map((language) => {
        const active = language.code === value;
        return (
          <Pressable
            key={language.code}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(language.code)}
            style={({ pressed }) => [
              styles.item,
              dark && styles.itemDark,
              active && (dark ? styles.activeDark : styles.active),
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={[styles.code, active && styles.codeActive]}>
              <Text style={[styles.codeText, active && { color: "#FFFFFF" }]}>{language.code.toUpperCase()}</Text>
            </View>
            <Text style={[font.bodyStrong, { flex: 1, color: dark ? "#FFFFFF" : colors.ink }]}>{language.nativeName}</Text>
            {active && <Ionicons name="checkmark-circle" size={24} color={colors.brand} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  itemDark: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" },
  active: { borderColor: colors.brand, backgroundColor: "#FFFAF5" },
  activeDark: { borderColor: colors.brand, backgroundColor: "rgba(248,128,26,0.12)" },
  code: { width: 36, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt },
  codeActive: { backgroundColor: colors.brand },
  codeText: { fontSize: 12, fontWeight: "800", color: colors.inkSoft, letterSpacing: 0.5 },
});
