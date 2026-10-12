import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Lang } from "@shared/languages";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card, Divider, SectionTitle } from "@/components/ui/Card";
import { ListRow, Toggle } from "@/components/ui/ListRow";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { TextField } from "@/components/ui/TextField";
import { newClientMessageId, useCreateInstruction, useMe, useMembers, useSiteId } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

export default function NewInstruction() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const me = useMe();
  const members = useMembers(siteId);
  const create = useCreateInstruction(siteId);
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [requiresAck, setRequiresAck] = useState(true);

  const candidates = useMemo(
    () => members.data?.filter((m) => m.status === "active" && m.userId !== me.data?.id && m.role === "member") ?? [],
    [members.data, me.data?.id],
  );
  const targets = mode === "all" ? candidates : candidates.filter((m) => selected.has(m.userId));
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

  const target = mode === "all" ? ("all" as const) : { userIds: [...selected] };
  const done = () => {
    toast(t("instr.sent"), "success");
    if (router.canGoBack()) router.back();
    else router.replace("/site/instructions");
  };
  const onError = (error: unknown) => toast(errorMessage(error), "error");

  return (
    <Screen
      scroll
      footer={
        <Button
          title={t("instr.send", { n: targets.length })}
          icon="send"
          disabled={!text.trim() || targets.length === 0}
          loading={create.isPending}
          onPress={() =>
            create.mutate({ clientMessageId: newClientMessageId(), target, requiresAck, text: text.trim() }, { onSuccess: done, onError })
          }
        />
      }
    >
      <StackHeader title={t("instr.new")} backIcon="close" />

      <View style={{ gap: spacing.md }}>
        <SectionTitle title={t("instr.target")} />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "all", label: `${t("instr.targetAll")} · ${candidates.length}` },
            { value: "select", label: t("instr.targetSelect") },
          ]}
        />
        {mode === "select" && (
          <Card padded={false}>
            {candidates.map((member, index) => {
              const checked = selected.has(member.userId);
              return (
                <View key={member.userId}>
                  {index > 0 && <Divider inset={72} />}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => toggle(member.userId)}
                    style={styles.pick}
                  >
                    <Avatar id={member.userId} name={member.displayName} lang={member.lang} size={40} />
                    <Text style={[font.bodyStrong, { flex: 1 }]} numberOfLines={1}>
                      {member.displayName}
                    </Text>
                    <View style={[styles.check, checked && styles.checked]}>
                      {checked && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
                    </View>
                  </Pressable>
                </View>
              );
            })}
            {candidates.length === 0 && <Text style={[font.body, { padding: spacing.lg, color: colors.muted }]}>{t("instr.noRecipients")}</Text>}
          </Card>
        )}
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
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionTitle title={t("instr.message")} />
        <TextField value={text} onChangeText={setText} placeholder={t("instr.placeholder")} multiline maxLength={500} />
        <Card padded={false}>
          <ListRow icon="checkmark-done-outline" title={t("instr.requireAck")} right={<Toggle value={requiresAck} onChange={setRequiresAck} />} />
        </Card>
      </View>

    </Screen>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 64 },
  check: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: colors.brand, borderColor: colors.brand },
  langs: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  langChip: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  langText: { ...font.caption, fontWeight: "700", color: colors.inkSoft },
});
