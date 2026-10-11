import { StyleSheet, Text, View } from "react-native";
import type { RecipientStatus } from "@shared/api";
import type { Lang } from "@shared/languages";
import { useT } from "@/i18n";
import { colors, font, radius, spacing } from "@/theme";

export type Tone = "neutral" | "brand" | "dark" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.inkSoft },
  brand: { bg: colors.brandSoft, fg: colors.brandPressed },
  dark: { bg: colors.ink, fg: "#FFFFFF" },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
};

export function Badge({ label, tone = "neutral", dot }: { label: string; tone?: Tone; dot?: boolean }) {
  const palette = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      {dot && <View style={[styles.dot, { backgroundColor: palette.fg }]} />}
      <Text style={[styles.text, { color: palette.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** 언어 코드 배지 (VI, ZH ...) */
export function LangBadge({ lang, inverse }: { lang: Lang; inverse?: boolean }) {
  return (
    <View style={[styles.lang, inverse && styles.langInverse]}>
      <Text style={[styles.langText, inverse && { color: colors.ink }]}>{lang.toUpperCase()}</Text>
    </View>
  );
}

export const STATUS_TONE: Record<RecipientStatus, Tone> = {
  pending: "neutral",
  sent: "neutral",
  delivered: "info",
  acknowledged: "brand",
  completed: "success",
  failed: "danger",
};

export function StatusBadge({ status }: { status: RecipientStatus }) {
  const { t } = useT();
  return <Badge label={t(`status.${status}`)} tone={STATUS_TONE[status]} dot />;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { ...font.caption, fontWeight: "700" },
  lang: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.ink },
  langInverse: { backgroundColor: "#FFFFFF" },
  langText: { fontSize: 10, lineHeight: 14, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.5 },
});
