import { StyleSheet, Text, View } from "react-native";
import type { Lang } from "@shared/languages";
import { initials } from "@/lib/format";
import { avatarColor, colors } from "@/theme";

export function Avatar({
  id,
  name,
  size = 44,
  online,
  lang,
}: {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  lang?: Lang;
}) {
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(id) }]}>
        <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
      </View>
      {lang && (
        <View style={styles.lang}>
          <Text style={styles.langText}>{lang.toUpperCase()}</Text>
        </View>
      )}
      {online !== undefined && !lang && (
        <View style={[styles.presence, { backgroundColor: online ? colors.success : colors.placeholder }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#FFFFFF", fontWeight: "800" },
  presence: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  lang: {
    position: "absolute",
    right: -6,
    bottom: -4,
    paddingHorizontal: 4,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  langText: { fontSize: 9, lineHeight: 13, fontWeight: "800", color: colors.ink },
});
