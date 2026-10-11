import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { InboxItem, InstructionDetail, RecipientStatus } from "@shared/api";
import { playNow, usePlaybackStore } from "@/audio/playback";
import { Avatar } from "@/components/ui/Avatar";
import { LangBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Divider, SectionTitle } from "@/components/ui/Card";
import { RecipientProgress } from "@/components/ui/ProgressBar";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useCurrentSite, useInbox, useInstruction, useMe, useRespondInstruction, useRetryInstruction, useSiteId } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { formatDateTime, formatTime, nativeNameOf } from "@/lib/format";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

const STAT_ORDER: { key: RecipientStatus; color: string }[] = [
  { key: "delivered", color: colors.info },
  { key: "acknowledged", color: colors.brand },
  { key: "completed", color: colors.success },
  { key: "failed", color: colors.danger },
];

function ManagerDetail({ detail }: { detail: InstructionDetail }) {
  const { t, lang } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const retry = useRetryInstruction(siteId, detail.id);
  const reached = (status: RecipientStatus) => {
    const order: RecipientStatus[] = ["delivered", "acknowledged", "completed"];
    return detail.recipients.filter((r) => r.status !== "failed" && order.indexOf(r.status) >= order.indexOf(status)).length;
  };
  const latest = (r: InstructionDetail["recipients"][number]) => r.completedAt ?? r.acknowledgedAt ?? r.deliveredAt;

  return (
    <>
      <Card style={{ gap: spacing.md }}>
        <Text style={styles.meta}>{formatDateTime(detail.createdAt, lang)}</Text>
        <Text style={font.headline}>{detail.text}</Text>
        <RecipientProgress counts={detail.counts} total={detail.total} />
        <View style={styles.stats}>
          {STAT_ORDER.map(({ key, color }) => (
            <View key={key} style={styles.stat}>
              <Text style={[styles.statValue, { color }]}>{key === "failed" ? detail.counts.failed : reached(key)}</Text>
              <Text style={styles.meta}>{t(`status.${key}`)}</Text>
            </View>
          ))}
        </View>
        {detail.counts.failed > 0 && (
          <Button
            title={t("instr.retryFailed")}
            icon="refresh"
            variant="danger"
            loading={retry.isPending}
            onPress={() => retry.mutate(undefined, { onError: (e) => toast(errorMessage(e), "error") })}
          />
        )}
      </Card>

      <SectionTitle title={t("instr.languages")} />
      <Card padded={false}>
        {detail.translations.map((item, index) => (
          <View key={item.lang}>
            {index > 0 && <Divider inset={spacing.lg} />}
            <View style={styles.translation}>
              <View style={styles.translationTop}>
                <LangBadge lang={item.lang} />
                <Text style={[font.label, { flex: 1 }]}>{nativeNameOf(item.lang)}</Text>
                {item.status === "processing" || item.status === "pending" ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : item.status === "failed" ? (
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                ) : (
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                )}
              </View>
              {item.text && <Text style={[font.body, { color: colors.inkSoft }]}>{item.text}</Text>}
            </View>
          </View>
        ))}
      </Card>

      <SectionTitle title={t("instr.recipients")} />
      <Card padded={false}>
        {detail.recipients.map((recipient, index) => (
          <View key={recipient.userId}>
            {index > 0 && <Divider inset={72} />}
            <View style={styles.recipient}>
              <Avatar id={recipient.userId} name={recipient.displayName} lang={recipient.lang} size={40} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={font.bodyStrong} numberOfLines={1}>
                  {recipient.displayName}
                </Text>
                {recipient.responseNote && (
                  <Text style={styles.meta} numberOfLines={2}>
                    “{recipient.responseNote}”
                  </Text>
                )}
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <StatusBadge status={recipient.status} />
                {latest(recipient) && <Text style={styles.meta}>{formatTime(latest(recipient)!, lang)}</Text>}
              </View>
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}

function Timeline({ label, done, at, last }: { label: string; done: boolean; at?: string | null; last?: boolean }) {
  const { lang } = useT();
  return (
    <View style={styles.timeline}>
      <View style={{ alignItems: "center" }}>
        <View style={[styles.node, done && styles.nodeDone]}>{done && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}</View>
        {!last && <View style={[styles.line, done && { backgroundColor: colors.success }]} />}
      </View>
      <Text style={[font.bodyStrong, { flex: 1, color: done ? colors.ink : colors.muted }]}>{label}</Text>
      {at && <Text style={styles.meta}>{formatTime(at, lang)}</Text>}
    </View>
  );
}

function MemberDetail({ item }: { item: InboxItem }) {
  const { t, lang } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const me = useMe();
  const respond = useRespondInstruction(siteId);
  const playingId = usePlaybackStore((state) => state.playingId);
  const [note, setNote] = useState("");
  const onError = (e: unknown) => toast(errorMessage(e), "error");
  const acknowledged = item.myStatus === "acknowledged" || item.myStatus === "completed";
  const completed = item.myStatus === "completed";
  const translated = item.sourceLang !== me.data?.preferredLang;

  return (
    <>
      <Card style={styles.hero}>
        <View style={styles.from}>
          <Ionicons name="megaphone" size={16} color={colors.brand} />
          <Text style={[font.label, { color: colors.brandPressed }]}>{t("instr.from", { name: item.senderName })}</Text>
        </View>
        <Text style={[font.title, { fontSize: 26, lineHeight: 36 }]}>{item.text ?? "…"}</Text>
        {translated && item.originalText && (
          <View style={styles.original}>
            <Text style={styles.meta}>
              {t("chat.original")} · {nativeNameOf(item.sourceLang)}
            </Text>
            <Text style={[font.body, { color: colors.inkSoft }]}>{item.originalText}</Text>
          </View>
        )}
        <Button
          title={t("chat.replay")}
          icon={playingId === item.id ? "volume-high" : "play"}
          variant="secondary"
          onPress={() =>
            me.data && playNow({ id: item.id, text: item.text, lang: me.data.preferredLang, audioUrl: item.audioUrl, rate: me.data.speechRate })
          }
        />
        <Text style={styles.meta}>{formatDateTime(item.createdAt, lang)}</Text>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Timeline label={t("status.delivered")} done />
        <Timeline label={t("status.acknowledged")} done={acknowledged} at={item.acknowledgedAt} />
        <Timeline label={t("status.completed")} done={completed} at={item.completedAt} last />
      </Card>

      {!acknowledged && (
        <Button title={t("instr.ack")} icon="checkmark" loading={respond.isPending} onPress={() => respond.mutate({ messageId: item.id, action: "ack" }, { onError })} />
      )}
      {acknowledged && !completed && (
        <View style={{ gap: spacing.md }}>
          <TextField value={note} onChangeText={setNote} placeholder={t("instr.notePlaceholder")} maxLength={200} />
          <Button
            title={t("instr.complete")}
            icon="flag"
            variant="dark"
            loading={respond.isPending}
            onPress={() => respond.mutate({ messageId: item.id, action: "complete", note: note.trim() || undefined }, { onError })}
          />
        </View>
      )}
    </>
  );

}

export default function InstructionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const siteId = useSiteId();
  const { site } = useCurrentSite();
  const manager = site?.role === "manager";
  const detail = useInstruction(manager ? id : "");
  const inbox = useInbox(siteId, !manager);
  const item = inbox.data?.find((entry) => entry.id === id);

  return (
    <Screen scroll edges={["top", "bottom"]} contentStyle={{ paddingTop: 0 }}>
      <StackHeader title={t("instr.title")} />
      {manager ? (
        detail.data ? <ManagerDetail detail={detail.data} /> : <ActivityIndicator color={colors.brand} />
      ) : item ? (
        <MemberDetail item={item} />
      ) : (
        <ActivityIndicator color={colors.brand} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { ...font.caption, color: colors.muted },
  stats: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1, gap: 2 },
  statValue: { fontSize: 24, fontWeight: "800" },
  translation: { padding: spacing.lg, gap: spacing.sm },
  translationTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recipient: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  hero: { gap: spacing.lg, borderColor: colors.brandBorder, borderWidth: 1.5 },
  from: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  original: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  timeline: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  node: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  nodeDone: { backgroundColor: colors.success, borderColor: colors.success },
  line: { width: 2, height: 18, backgroundColor: colors.border, marginTop: 2 },
});
