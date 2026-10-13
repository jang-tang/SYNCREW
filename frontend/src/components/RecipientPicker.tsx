import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DeviceChip, InfoNotice } from "@/components/live/LiveParts";
import { Avatar } from "@/components/ui/Avatar";
import { Card, Divider, SectionTitle } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { TextField } from "@/components/ui/TextField";
import { useMe, useMembers } from "@/hooks/queries";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import {
  bulkSelect,
  filterByName,
  groupActive,
  lastTargetsKey,
  parseLastTargets,
  quickGroups,
  summarize,
  toggleGroup,
  type QuickGroup,
} from "@/lib/recipients";
import { secureStorage } from "@/lib/storage";
import { colors, font, radius, spacing } from "@/theme";

// 일괄 지시 대상 선택 (문자 지시·실시간 지시 화면 공통).
// 서버로는 지금처럼 "all" 또는 { userIds }만 보낸다. 지난 선택은 단말에만 저장한다.

export function useRecipientPicker(siteId: string) {
  const me = useMe();
  const members = useMembers(siteId);
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [last, setLast] = useState<string[] | null>(null);
  const myId = me.data?.id;

  useEffect(() => {
    if (!myId) return;
    let alive = true;
    secureStorage
      .getItem(lastTargetsKey(myId, siteId))
      .then((raw) => alive && setLast(parseLastTargets(raw)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [myId, siteId]);

  const candidates = useMemo(
    () => members.data?.filter((m) => m.status === "active" && m.userId !== myId && m.role === "member") ?? [],
    [members.data, myId],
  );
  const targets = mode === "all" ? candidates : candidates.filter((m) => selected.has(m.userId));
  const summary = useMemo(() => summarize(targets), [targets]);
  const groups = useMemo(() => quickGroups(candidates, last), [candidates, last]);
  const visible = useMemo(() => filterByName(candidates, query), [candidates, query]);

  return {
    mode,
    setMode,
    selected,
    query,
    setQuery,
    candidates,
    visible,
    groups,
    targets,
    summary,
    target: mode === "all" ? ("all" as const) : { userIds: targets.map((m) => m.userId) },
    toggle: (userId: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(userId)) next.delete(userId);
        else next.add(userId);
        return next;
      }),
    pressGroup: (group: QuickGroup) => {
      // 현장 전체 상태에서 칩을 누르면 그 묶음만 고른 직접 선택으로 바꾼다
      if (mode === "all") {
        setMode("select");
        setSelected(new Set(group.userIds));
      } else setSelected((current) => toggleGroup(current, group));
    },
    bulk: (action: "all" | "none" | "invert") => setSelected((current) => bulkSelect(current, visible, action)),
    /** 보내기에 성공하면 호출: 직접 선택한 대상을 다음 지시의 "지난번 대상"으로 저장 */
    remember: () => {
      if (!myId || mode !== "select") return;
      const userIds = targets.map((m) => m.userId);
      secureStorage.setItem(lastTargetsKey(myId, siteId), JSON.stringify(userIds)).catch(() => {});
    },
  };
}

export type RecipientPickerState = ReturnType<typeof useRecipientPicker>;

export function RecipientPicker({ picker }: { picker: RecipientPickerState }) {
  const { t } = useT();
  const { mode, selected, candidates, visible, groups, summary } = picker;

  const groupLabel = (group: QuickGroup) => {
    const n = group.userIds.length;
    if (group.kind === "last") return t("recip.last", { n });
    if (group.kind === "online") return t("recip.online", { n });
    if (group.kind === "headset") return t("recip.headset", { n });
    return `${nativeNameOf(group.lang!)} · ${n}`;
  };

  return (
    <View style={{ gap: spacing.md }}>
      <SectionTitle
        title={t("instr.target")}
        right={<Text style={styles.count}>{t("bc.connected", { a: summary.online, b: summary.total })}</Text>}
      />
      <Segmented
        value={mode}
        onChange={picker.setMode}
        options={[
          { value: "all", label: `${t("instr.targetAll")} · ${candidates.length}` },
          { value: "select", label: t("instr.targetSelect") },
        ]}
      />

      {groups.length > 0 && (
        <View style={styles.chips} accessibilityLabel={t("recip.quick")}>
          {groups.map((group) => {
            const active = mode === "select" && groupActive(group, selected);
            return (
              <Pressable
                key={group.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                onPress={() => picker.pressGroup(group)}
                style={[styles.chip, active && styles.chipActive]}
              >
                {group.kind === "last" && <Ionicons name="time-outline" size={14} color={active ? colors.onBrand : colors.inkSoft} />}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{groupLabel(group)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {mode === "select" && candidates.length > 0 && (
        <>
          <TextField value={picker.query} onChangeText={picker.setQuery} placeholder={t("recip.search")} autoCorrect={false} />
          <View style={styles.bulkRow}>
            <BulkButton label={t("recip.selectAll")} onPress={() => picker.bulk("all")} />
            <BulkButton label={t("recip.selectNone")} onPress={() => picker.bulk("none")} />
            <BulkButton label={t("recip.invert")} onPress={() => picker.bulk("invert")} />
          </View>
        </>
      )}

      <Card padded={false}>
        {visible.map((member, index) => {
          const checked = mode === "all" || selected.has(member.userId);
          return (
            <View key={member.userId}>
              {index > 0 && <Divider inset={72} />}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: mode === "all" }}
                disabled={mode === "all"}
                onPress={() => picker.toggle(member.userId)}
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
        {candidates.length === 0 && <Text style={styles.empty}>{t("instr.noRecipients")}</Text>}
        {candidates.length > 0 && visible.length === 0 && <Text style={styles.empty}>{t("recip.noMatch")}</Text>}
      </Card>

      {summary.langs.length > 0 && (
        <View style={styles.langs}>
          <Ionicons name="language" size={16} color={colors.muted} />
          {summary.langs.map(([lang, count]) => (
            <View key={lang} style={styles.langChip}>
              <Text style={styles.langText}>
                {nativeNameOf(lang)} {count}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** 보내기 버튼 위 요약: "5명 · 3개 언어 · 연결 4명" + 연결 끊긴 사람이 있으면 안내 */
export function RecipientSummary({ picker }: { picker: RecipientPickerState }) {
  const { t } = useT();
  const { total, langs, online } = picker.summary;
  if (total === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.summary}>
        <Ionicons name="people" size={16} color={colors.inkSoft} />
        <Text style={styles.summaryText}>{t("recip.summary", { n: total, l: langs.length, o: online })}</Text>
      </View>
      {online < total && <InfoNotice text={t("bc.offlineNote")} />}
    </View>
  );
}

function BulkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.bulk, pressed && { backgroundColor: colors.surfaceAlt }]}>
      <Text style={styles.bulkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  count: { ...font.caption, fontWeight: "700", color: colors.success },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...font.label, color: colors.inkSoft },
  chipTextActive: { color: colors.onBrand },
  bulkRow: { flexDirection: "row", gap: spacing.sm },
  bulk: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  bulkText: { ...font.caption, fontWeight: "700", color: colors.ink },
  pick: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 68 },
  sub: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  lang: { ...font.caption, color: colors.muted },
  offline: { ...font.caption, fontWeight: "700", color: colors.danger },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: colors.brand, borderColor: colors.brand },
  empty: { ...font.body, padding: spacing.lg, color: colors.muted },
  langs: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  langChip: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  langText: { ...font.caption, fontWeight: "700", color: colors.inkSoft },
  summary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs + 2 },
  summaryText: { ...font.caption, fontWeight: "700", color: colors.inkSoft },
});
