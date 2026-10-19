import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ConversationSummary } from "@shared/api";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LargeHeader, Screen } from "@/components/ui/Screen";
import { SiteBanners } from "@/components/live/LiveParts";
import { SiteEyebrow } from "@/components/SiteEyebrow";
import { useConversations, useSiteId } from "@/hooks/queries";
import { useT } from "@/i18n";
import { formatTime } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";

function Unread({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={styles.unread}>
      <Text style={styles.unreadText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

function GroupCard({ conversation }: { conversation: ConversationSummary }) {
  const { t, lang } = useT();
  return (
    <Card onPress={() => router.push(`/site/chat/${conversation.id}`)} style={styles.group}>
      <View style={styles.groupTop}>
        <View style={styles.groupIcon}>
          <Ionicons name="people" size={24} color={colors.ink} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[font.headline, { color: "#FFFFFF" }]}>{t("conv.group")}</Text>
          <Text style={styles.groupDesc}>
            {t("conv.groupDesc")} · {t("common.people", { n: conversation.participantCount })}
          </Text>
        </View>
        <Unread count={conversation.unreadCount} />
      </View>
      {conversation.lastMessage && (
        <View style={styles.groupLast}>
          <Text style={styles.groupLastText} numberOfLines={2}>
            <Text style={{ fontWeight: "700", color: "#FFFFFF" }}>{conversation.lastMessage.senderName}</Text>
            {"  "}
            {conversation.lastMessage.text}
          </Text>
          <Text style={styles.groupTime}>{formatTime(conversation.lastMessage.createdAt, lang)}</Text>
        </View>
      )}
    </Card>
  );
}

function DirectRow({ conversation }: { conversation: ConversationSummary }) {
  const { lang } = useT();
  const peer = conversation.peer!;
  return (
    <Card padded={false} onPress={() => router.push(`/site/chat/${conversation.id}`)} style={styles.rowCard}>
      <View style={styles.row}>
        <Avatar id={peer.userId} name={peer.displayName} lang={peer.lang} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.rowTop}>
            <Text style={[font.bodyStrong, { flex: 1 }]} numberOfLines={1}>
              {peer.displayName}
            </Text>
            {conversation.lastMessage && <Text style={styles.time}>{formatTime(conversation.lastMessage.createdAt, lang)}</Text>}
          </View>
          <View style={styles.rowTop}>
            <Text style={[styles.preview, conversation.unreadCount > 0 && { color: colors.ink, fontWeight: "600" }]} numberOfLines={1}>
              {conversation.lastMessage?.text ?? " "}
            </Text>
            <Unread count={conversation.unreadCount} />
          </View>
        </View>
      </View>
    </Card>
  );
}

export default function Conversations() {
  const { t } = useT();
  const siteId = useSiteId();
  const conversations = useConversations(siteId);
  const group = conversations.data?.find((c) => c.type === "group");
  const directs = conversations.data?.filter((c) => c.type === "direct") ?? [];

  return (
    <Screen edges={["top"]}>
      <LargeHeader
        eyebrow={<SiteEyebrow />}
        title={t("tab.conversations")}
        right={<IconButton icon="create-outline" label={t("conv.new")} onPress={() => router.push("/site/chat/new")} />}
      />
      <SiteBanners />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={conversations.isRefetching} onRefresh={() => void conversations.refetch()} tintColor={colors.brand} />}
      >
        {group && <GroupCard conversation={group} />}
        <SectionTitle title={t("conv.direct")} />
        {directs.length === 0 && !conversations.isPending ? (
          <Card>
            <EmptyState icon="chatbubble-ellipses-outline" message={t("conv.emptyDirect")} />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {directs.map((conversation) => (
              <DirectRow key={conversation.id} conversation={conversation} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}


const styles = StyleSheet.create({
  // 제목 아래 목록이 바로 붙지 않게 약간의 위 여백 (헤더 자체 여백은 LargeHeader 가 가짐)
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  group: { backgroundColor: colors.ink, borderColor: colors.ink, gap: spacing.md },
  groupTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  groupIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand },
  groupDesc: { ...font.caption, color: "rgba(255,255,255,0.6)", marginTop: 2 },
  groupLast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  groupLastText: { ...font.label, fontWeight: "400", color: "rgba(255,255,255,0.8)", flex: 1 },
  groupTime: { ...font.caption, color: "rgba(255,255,255,0.45)" },
  rowCard: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  preview: { ...font.label, fontWeight: "400", color: colors.muted, flex: 1 },
  time: { ...font.caption, color: colors.placeholder },
  unread: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand },
  unreadText: { fontSize: 12, fontWeight: "800", color: "#FFFFFF" },
});
