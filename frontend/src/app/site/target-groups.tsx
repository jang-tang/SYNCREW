import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TargetGroup } from "@shared/api";
import { Card, Divider } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useDeleteTargetGroup, useMembers, useSaveTargetGroup, useSiteId, useTargetGroups } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

// 작업조 관리 (B2, 관리자): 이름 바꾸기·삭제. 구성원 바꾸기는 지시 화면에서 사람을 고른 뒤 같은 이름으로 저장(덮어쓰기).

export default function TargetGroups() {
  const { t } = useT();
  const siteId = useSiteId();
  const groups = useTargetGroups(siteId);
  const members = useMembers(siteId);
  const names = new Map((members.data ?? []).map((m) => [m.userId, m.displayName]));

  return (
    <Screen scroll>
      <StackHeader title={t("groups.title")} />
      <Text style={[font.caption, { color: colors.muted }]}>{t("groups.hint")}</Text>
      {groups.data && groups.data.length === 0 && <EmptyState icon="people-outline" message={t("groups.empty")} />}
      {groups.data && groups.data.length > 0 && (
        <Card padded={false}>
          {groups.data.map((group, index) => (
            <View key={group.id}>
              {index > 0 && <Divider />}
              <GroupRow group={group} names={names} siteId={siteId} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function GroupRow({ group, names, siteId }: { group: TargetGroup; names: Map<string, string>; siteId: string }) {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const save = useSaveTargetGroup(siteId);
  const remove = useDeleteTargetGroup(siteId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(group.name);
  const onError = (error: unknown) => toast(errorMessage(error), "error");

  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Ionicons name="people" size={18} color={colors.brand} />
        <Text style={[font.bodyStrong, { flex: 1 }]} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.count}>{t("common.people", { n: group.userIds.length })}</Text>
      </View>
      <Text style={styles.members} numberOfLines={2}>
        {group.userIds.map((id) => names.get(id) ?? "?").join(", ") || t("groups.noMembers")}
      </Text>

      {editing ? (
        <View style={{ gap: spacing.sm }}>
          <TextField value={name} onChangeText={setName} maxLength={30} autoCorrect={false} />
          <View style={styles.actions}>
            <Action
              label={t("common.save")}
              disabled={!name.trim() || save.isPending}
              onPress={() =>
                save.mutate({ id: group.id, name: name.trim() }, { onSuccess: () => setEditing(false), onError })
              }
            />
            <Action label={t("common.cancel")} onPress={() => (setEditing(false), setName(group.name))} />
          </View>
        </View>
      ) : confirming ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.danger}>{t("groups.deleteConfirm", { name: group.name })}</Text>
          <View style={styles.actions}>
            <Action label={t("groups.delete")} danger disabled={remove.isPending} onPress={() => remove.mutate(group.id, { onError })} />
            <Action label={t("common.cancel")} onPress={() => setConfirming(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Action label={t("groups.rename")} onPress={() => setEditing(true)} />
          <Action label={t("groups.delete")} danger onPress={() => setConfirming(true)} />
        </View>
      )}
    </View>
  );
}

function Action({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.surfaceAlt }, disabled && { opacity: 0.4 }]}
    >
      <Text style={[font.caption, { fontWeight: "700", color: danger ? colors.danger : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  count: { ...font.caption, color: colors.muted, fontWeight: "700" },
  members: { ...font.caption, color: colors.inkSoft },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  danger: { ...font.caption, color: colors.danger, fontWeight: "700" },
});
