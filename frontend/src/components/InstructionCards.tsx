import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import type { InboxItem, InstructionSummary } from "@shared/api";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RecipientProgress } from "@/components/ui/ProgressBar";
import { useT } from "@/i18n";
import { formatTime } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";

/** 관리자: 보낸 지시 한 건의 진행 현황 */
/** 실시간 일괄 지시 중에 말한 지시 표시 */
function LiveTag() {
  const { t } = useT();
  return (
    <View style={styles.liveTag}>
      <Ionicons name="radio" size={11} color="#FFFFFF" />
      <Text style={styles.liveText}>{t("instr.liveTag")}</Text>
    </View>
  );
}

export function SentInstructionCard({ item }: { item: InstructionSummary }) {
  const { t, lang } = useT();
  const confirmed = item.counts.acknowledged + item.counts.completed;
  // 실시간 지시는 확인 응답을 받지 않으므로 전달 수를 보여 준다
  const delivered = item.counts.sent + item.counts.delivered + item.counts.acknowledged + item.counts.completed;
  return (
    <Card onPress={() => router.push(`/site/instruction/${item.id}`)} style={{ gap: spacing.md }}>
      <View style={styles.top}>
        {item.sessionId && <LiveTag />}
        <Text style={[font.bodyStrong, { flex: 1 }]} numberOfLines={2}>
          {item.text}
        </Text>
        <Text style={styles.time}>{formatTime(item.createdAt, lang)}</Text>
      </View>
      <RecipientProgress counts={item.counts} total={item.total} />
      <View style={styles.top}>
        <Text style={styles.progress}>
          {item.requiresAck ? t("instr.progress", { a: confirmed, b: item.total }) : t("bc.delivery", { a: delivered, b: item.total })}
        </Text>
        <View style={styles.legend}>
          {item.counts.completed > 0 && <Legend color={colors.success} label={`${t("status.completed")} ${item.counts.completed}`} />}
          {item.counts.failed > 0 && <Legend color={colors.danger} label={`${t("status.failed")} ${item.counts.failed}`} />}
        </View>
      </View>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.time}>{label}</Text>
    </View>
  );
}

const isNew = (item: InboxItem) => item.myStatus === "sent" || item.myStatus === "delivered" || item.myStatus === "pending";

/** 구성원: 받은 지시. 아직 확인하지 않았으면 강조하고 바로 확인할 수 있게 한다. */
export function InboxCard({ item, onAck, acking }: { item: InboxItem; onAck: () => void; acking: boolean }) {
  const { t, lang } = useT();
  const fresh = isNew(item) && item.requiresAck;
  return (
    <Card onPress={() => router.push(`/site/instruction/${item.id}`)} style={[{ gap: spacing.md }, fresh && styles.fresh]}>
      <View style={styles.top}>
        <View style={styles.from}>
          {item.sessionId && <LiveTag />}
          <Ionicons name="megaphone" size={14} color={fresh ? colors.brand : colors.muted} />
          <Text style={[styles.time, fresh && { color: colors.brandPressed, fontWeight: "700" }]} numberOfLines={1}>
            {t("instr.from", { name: item.senderName })}
          </Text>
        </View>
        {fresh ? <View style={styles.newBadge}><Text style={styles.newText}>{t("instr.newBadge")}</Text></View> : <StatusBadge status={item.myStatus} />}
      </View>
      <Text style={[font.message, { fontSize: 18 }]} numberOfLines={3}>
        {item.text ?? "…"}
      </Text>
      <View style={styles.top}>
        <Text style={styles.time}>{formatTime(item.createdAt, lang)}</Text>
      </View>
      {fresh && <Button title={t("instr.ack")} icon="checkmark" onPress={onAck} loading={acking} />}
    </Card>
  );
}

export { isNew as isUnacknowledged };

const styles = StyleSheet.create({
  liveTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.danger,
  },
  liveText: { fontSize: 11, fontWeight: "800", color: "#FFFFFF" },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md, justifyContent: "space-between" },
  time: { ...font.caption, color: colors.muted },
  progress: { ...font.label, color: colors.ink },
  legend: { flexDirection: "row", gap: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  fresh: { borderColor: colors.brand, borderWidth: 1.5, backgroundColor: "#FFFCF8" },
  from: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, flex: 1 },
  newBadge: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.brand },
  newText: { ...font.caption, fontWeight: "800", color: "#FFFFFF" },
});
