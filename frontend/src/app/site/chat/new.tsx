import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { useMe, useMembers, useOpenDirect, useSiteId } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { toast } from "@/stores/toast";
import { colors, font, spacing } from "@/theme";

export default function NewConversation() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const me = useMe();
  const members = useMembers(siteId);
  const open = useOpenDirect(siteId);
  const people = members.data?.filter((m) => m.status === "active" && m.userId !== me.data?.id) ?? [];

  const start = (userId: string) =>
    open.mutate(userId, {
      onSuccess: (conversation) => router.replace(`/site/chat/${conversation.id}`),
      onError: (error) => toast(errorMessage(error), "error"),
    });

  return (
    <Screen edges={["top", "bottom"]}>
      <StackHeader title={t("conv.pick")} backIcon="close" />
      <ScrollView contentContainerStyle={styles.content}>
        {people.length === 0 && !members.isPending && <EmptyState icon="people-outline" message={t("members.empty")} />}
        {people.map((member) => (
          <Card key={member.userId} padded={false} onPress={() => start(member.userId)} style={styles.card}>
            <View style={styles.row}>
              <Avatar id={member.userId} name={member.displayName} size={48} online={member.online} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={font.bodyStrong} numberOfLines={1}>
                  {member.displayName}
                </Text>
                <Text style={styles.meta}>{nativeNameOf(member.lang)}</Text>
              </View>
              {member.role === "manager" && <Badge label={t("role.manager")} tone="dark" />}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.sm },
  card: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  meta: { ...font.caption, color: colors.muted },
});
