import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SUPPORTED_LANGUAGES } from "@shared/languages";
import { API_BASE_URL } from "@/config";
import { t } from "@/i18n/strings";
import { useServerHealth } from "@/providers/ServerHealthProvider";
import { colors, fontSize, spacing, touchTarget } from "@/theme";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { status, health, error, checkedAt, refresh } = useServerHealth();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>서버 연결</Text>
        <Row label="주소" value={API_BASE_URL} />
        <Row label="상태" value={t(`server.${status}`)} />
        {health && (
          <>
            <Row label="데이터베이스" value={health.db === "ok" ? "정상" : "오류"} />
            <Row label="OpenAI API 키" value={health.openai === "configured" ? "설정됨" : "미설정"} />
            <Row
              label="현장 데이터셋"
              value={`${health.dataset.name} (용어 ${health.dataset.lexicon} · 문장 ${health.dataset.phrases})`}
            />
            {health.budget && (
              <Row
                label="OpenAI 비용"
                value={`$${health.budget.spentUsd.toFixed(2)} / $${health.budget.limitUsd} (${health.budget.period === "month" ? "월" : "누적"})`}
              />
            )}
          </>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        {checkedAt && <Row label="마지막 확인" value={checkedAt.toLocaleTimeString()} />}
        <Pressable style={styles.button} onPress={refresh} accessibilityRole="button">
          <Text style={styles.buttonText}>다시 확인</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>지원 언어</Text>
        {SUPPORTED_LANGUAGES.map((language) => (
          <Row key={language.code} label={language.nativeName} value={language.code} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: fontSize.title, fontWeight: "700", marginBottom: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { color: colors.textMuted, fontSize: fontSize.body },
  value: { color: colors.text, fontSize: fontSize.body, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  error: { color: colors.danger, fontSize: fontSize.caption },
  button: {
    minHeight: touchTarget,
    marginTop: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#FFFFFF", fontSize: fontSize.body, fontWeight: "700" },
});
