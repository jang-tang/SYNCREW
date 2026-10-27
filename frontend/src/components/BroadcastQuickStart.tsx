import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DeviceChip } from "@/components/live/LiveParts";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";
import { useMe, useMembers, useStartBroadcast } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

// 지시 탭 첫 화면의 실시간 지시 (2026-10-27 사용자 요청): 구성원이 처음부터 모두 골라져 있고(테두리로 표시)
// 누르면 빠지거나 다시 들어간다. 그 상태로 바로 시작한다.
// 예전에는 지시 탭 → 대상 선택 화면 → 지시 화면으로 화면이 두 번 바뀌었다.

export function BroadcastQuickStart({ siteId }: { siteId: string }) {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const members = useMembers(siteId);
  const start = useStartBroadcast(siteId);
  /** 뺀 사람 (기본은 모두 고름 — 새로 들어온 구성원도 골라진 채로 보인다) */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const myId = me.data?.id;

  const candidates = useMemo(
    () => members.data?.filter((m) => m.status === "active" && m.userId !== myId && m.role === "member") ?? [],
    [members.data, myId],
  );
  const targets = candidates.filter((m) => !excluded.has(m.userId));
  const allSelected = candidates.length > 0 && targets.length === candidates.length;

  const toggle = (userId: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const begin = () =>
    start.mutate(
      { userIds: targets.map((m) => m.userId) },
      {
        onSuccess: (session) => {
          setExcluded(new Set());
          router.push(`/site/broadcast/${session.id}`);
        },
        onError: (error) => toast(errorMessage(error), "error"),
      },
    );

  return (
    <View style={{ gap: spacing.md }}>
      <Button
        title={targets.length > 0 ? t("bc.startN", { n: targets.length }) : t("bc.start")}
        icon="radio"
        disabled={targets.length === 0}
        loading={start.isPending}
        onPress={begin}
      />
      <SectionTitle
        title={`${t("instr.target")} · ${targets.length}/${candidates.length}`}
        right={
          candidates.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setExcluded(allSelected ? new Set(candidates.map((m) => m.userId)) : new Set())}
            >
              <Text style={styles.all}>{t(allSelected ? "recip.selectNone" : "recip.selectAll")}</Text>
            </Pressable>
          ) : undefined
        }
      />
      {candidates.length === 0 && !members.isPending && <Text style={styles.empty}>{t("instr.noRecipients")}</Text>}
      <View style={styles.grid}>
        {candidates.map((member) => {
          const checked = !excluded.has(member.userId);
          return (
            <Pressable
              key={member.userId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => toggle(member.userId)}
              style={({ pressed }) => [styles.tile, checked ? styles.tileOn : styles.tileOff, pressed && { opacity: 0.7 }]}
            >
              <Avatar id={member.userId} name={member.displayName} size={44} online={member.online} highlighted={checked} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={font.bodyStrong} numberOfLines={1}>
                  {member.displayName}
                </Text>
                <View style={styles.sub}>
                  <Text style={styles.lang} numberOfLines={1}>
                    {nativeNameOf(member.lang)}
                  </Text>
                  {member.online ? member.device && <DeviceChip device={member.device} /> : <Text style={styles.offline}>{t("bc.offline")}</Text>}
                </View>
              </View>
              {checked && <Ionicons name="checkmark-circle" size={24} color={colors.brand} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  all: { ...font.caption, fontWeight: "700", color: colors.brand },
  empty: { ...font.body, color: colors.muted },
  grid: { gap: spacing.sm },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  /** 뺀 사람: 흐리게 (누르면 다시 들어간다) */
  tileOff: { opacity: 0.45 },
  sub: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  lang: { ...font.caption, color: colors.muted, flexShrink: 1 },
  offline: { ...font.caption, fontWeight: "700", color: colors.danger },
});
