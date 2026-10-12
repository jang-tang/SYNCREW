import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Lang } from "@shared/languages";
import { DeviceChip, InfoNotice } from "@/components/live/LiveParts";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card, Divider, SectionTitle } from "@/components/ui/Card";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { useMe, useMembers, useSiteId, useStartBroadcast } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

// 관리자 일괄 지시 시작: 수신 대상(전체·선택)과 각자의 언어·이어폰 연결 상태를 확인한 뒤 시작한다.

export default function NewBroadcast() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const me = useMe();
  const members = useMembers(siteId);
  const start = useStartBroadcast(siteId);
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const candidates = useMemo(
    () => members.data?.filter((m) => m.status === "active" && m.userId !== me.data?.id && m.role === "member") ?? [],
    [members.data, me.data?.id],
  );
  const targets = mode === "all" ? candidates : candidates.filter((m) => selected.has(m.userId));
  const online = targets.filter((m) => m.online).length;
  const langs = useMemo(() => {
    const counts = new Map<Lang, number>();
    targets.forEach((m) => counts.set(m.lang, (counts.get(m.lang) ?? 0) + 1));
    return [...counts];
  }, [targets]);

  const toggle = (userId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const begin = () =>
    start.mutate(mode === "all" ? "all" : { userIds: [...selected] }, {
      onSuccess: (session) => router.replace(`/site/broadcast/${session.id}`),
      onError: (error) => toast(errorMessage(error), "error"),
    });

  return (
    <Screen
      scroll
      footer={
        <Button
          title={t("bc.startN", { n: targets.length })}
          icon="radio"
          disabled={targets.length === 0}
          loading={start.isPending}
          onPress={begin}
        />
      }
    >
      <StackHeader title={t("bc.title")} backIcon="close" />
      <InfoNotice tone="info" text={t("bc.startDesc")} />

      <View style={{ gap: spacing.md }}>
        <SectionTitle title={t("instr.target")} right={<Text style={styles.count}>{t("bc.connected", { a: online, b: targets.length })}</Text>} />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "all", label: `${t("instr.targetAll")} · ${candidates.length}` },
            { value: "select", label: t("instr.targetSelect") },
          ]}
        />
        <Card padded={false}>
          {candidates.map((member, index) => {
            const checked = mode === "all" || selected.has(member.userId);
            return (
              <View key={member.userId}>
                {index > 0 && <Divider inset={72} />}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: mode === "all" }}
                  disabled={mode === "all"}
                  onPress={() => toggle(member.userId)}
                  style={styles.pick}
                >
                  <Avatar id={member.userId} name={member.displayName} size={40} online={member.online} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={font.bodyStrong} numberOfLines={1}>
                      {member.displayName}
                    </Text>
                    <View style={styles.sub}>
                      <Text style={styles.lang}>{nativeNameOf(member.lang)}</Text>
                      {member.online ? <DeviceChip device={member.device} /> : <Text style={styles.offline}>{t("bc.offline")}</Text>}
                    </View>
                  </View>
                  {mode === "select" && (
                    <View style={[styles.check, checked && styles.checked]}>
                      {checked && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                    </View>
                  )}
                </Pressable>
              </View>
            );
          })}
          {candidates.length === 0 && <Text style={[font.body, { padding: spacing.lg, color: colors.muted }]}>{t("instr.noRecipients")}</Text>}
        </Card>
        {langs.length > 0 && (
          <View style={styles.langs}>
            <Ionicons name="language" size={16} color={colors.muted} />
            {langs.map(([lang, count]) => (
              <View key={lang} style={styles.langChip}>
                <Text style={styles.langText}>
                  {nativeNameOf(lang)} {count}
                </Text>
              </View>
            ))}
          </View>
        )}
        {online < targets.length && <InfoNotice text={t("bc.offlineNote")} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: { ...font.caption, fontWeight: "700", color: colors.success },
  pick: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 68 },
  sub: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  lang: { ...font.caption, color: colors.muted },
  offline: { ...font.caption, fontWeight: "700", color: colors.danger },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: colors.brand, borderColor: colors.brand },
  langs: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  langChip: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  langText: { ...font.caption, fontWeight: "700", color: colors.inkSoft },
});
