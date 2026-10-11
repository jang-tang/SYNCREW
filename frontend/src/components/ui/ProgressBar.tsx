import { StyleSheet, View } from "react-native";
import type { RecipientCounts } from "@shared/api";
import { colors, radius } from "@/theme";

const SEGMENTS: { key: keyof RecipientCounts; color: string }[] = [
  { key: "completed", color: colors.success },
  { key: "acknowledged", color: colors.brand },
  { key: "delivered", color: "#9DB9F5" },
  { key: "failed", color: colors.danger },
];

/** 지시 진행 상태: 완료 · 확인 · 수신 · 실패 비율을 한 줄로 */
export function RecipientProgress({ counts, total }: { counts: RecipientCounts; total: number }) {
  return (
    <View style={styles.track}>
      {SEGMENTS.map(({ key, color }) =>
        counts[key] > 0 ? <View key={key} style={{ flex: counts[key] / Math.max(total, 1), backgroundColor: color }} /> : null,
      )}
      <View style={{ flex: Math.max(0, total - SEGMENTS.reduce((sum, s) => sum + counts[s.key], 0)) / Math.max(total, 1) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.surfaceAlt, gap: 2 },
});
