import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Member } from "@shared/api";
import { Avatar } from "@/components/ui/Avatar";
import { DirectRow, GroupCard } from "@/components/chat/ConversationCards";
import { ConnectionPanel } from "@/components/live/ConnectionPanel";
import { DeviceChip, SiteBanners } from "@/components/live/LiveParts";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, Divider, SectionTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LanguageGrid } from "@/components/ui/LanguageGrid";
import { ListRow } from "@/components/ui/ListRow";
import { LargeHeader, Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { SiteEyebrow } from "@/components/SiteEyebrow";
import {
  useConnect,
  useConversations,
  useCurrentSite,
  useGroupCall,
  useJoinGroup,
  useMe,
  useMembers,
  useOpenDirect,
  useSiteId,
  useSwitchConnection,
  useUpdateMember,
} from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { useConnection } from "@/providers/ConnectionProvider";
import { ApiError } from "@/services/live/http";
import { toast } from "@/stores/toast";
import { colors, font, spacing } from "@/theme";

function confirm(message: string, onConfirm: () => void, confirmLabel: string, cancelLabel: string) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(message)) onConfirm();
    return;
  }
  Alert.alert("", message, [
    { text: cancelLabel, style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}

/**
 * 연결 탭 = 현장의 첫 화면 (2026-10-27: 대화 탭을 없애고 합침).
 * 위에서부터 연결 패널 → 현장 전체 연결(2026-10-27, 각자 눌러서 들어감) → 멤버(누르면 바로 1:1 연결) → 음성 기록(현장 전체 대화·1:1 대화 기록).
 * 처음 1:1 메시지를 보낼 때는 멤버 줄의 ⋯ → 1:1 대화.
 */
export default function Connect() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const me = useMe();
  const { site } = useCurrentSite();
  const manager = site?.role === "manager";
  const members = useMembers(siteId);
  const conversations = useConversations(siteId);
  const group = conversations.data?.find((c) => c.type === "group");
  const directs = conversations.data?.filter((c) => c.type === "direct") ?? [];
  const update = useUpdateMember(siteId);
  const openDirect = useOpenDirect(siteId);
  const connection = useConnection();
  const connect = useConnect(siteId);
  const switchConnection = useSwitchConnection();
  const groupCall = useGroupCall(siteId);
  const joinGroup = useJoinGroup(siteId);
  /** 현장 전체 연결에 들어가 있는 사람들 (멤버 줄에 표시 — 이 사람들에게는 1:1 을 걸 수 없다) */
  const inGroup = new Set(groupCall.data?.participants.filter((p) => !p.leftAt).map((p) => p.userId) ?? []);
  const [selected, setSelected] = useState<Member | null>(null);
  const [langSheet, setLangSheet] = useState(false);
  const onError = (e: unknown) => toast(errorMessage(e), "error");

  const pending = members.data?.filter((m) => m.status === "pending") ?? [];
  const active = (members.data?.filter((m) => m.status === "active") ?? []).sort(
    (a, b) => Number(b.userId === me.data?.id) - Number(a.userId === me.data?.id) || Number(b.role === "manager") - Number(a.role === "manager"),
  );

  const message = (member: Member) => {
    setSelected(null);
    openDirect.mutate(member.userId, { onSuccess: (c) => router.push(`/site/chat/${c.id}`), onError });
  };

  const connectedTo = connection.group ? undefined : connection.peer?.userId;
  /**
   * 1:1 연결 (C2 "연결" 방식, 2026-10-26): 사람을 누르면 바로 연결, 연결 중에 다른 사람을 누르면 그 사람으로 전환.
   * 상대가 다른 사람과 연결 중이거나 접속하지 않았으면 안내만 하고 지금 연결은 그대로.
   */
  const connectTo = (member: Member) => {
    if (connect.isPending || switchConnection.isPending || member.userId === connectedTo) return;
    const name = member.displayName;
    if (!member.online) return toast(t("conn.offline", { name }), "default");
    const onFail = (error: unknown) => {
      if (error instanceof ApiError && error.code === "BUSY") toast(t("conn.busy", { name }), "default");
      else if (error instanceof ApiError && error.code === "CONFLICT") toast(t("conn.offline", { name }), "default");
      else onError(error);
    };
    // 1:1 중이면 전환, 아니면(현장 전체 연결 중이어도) 새로 연결 — 현장 전체 연결에서는 서버가 빼 준다
    if (connection.session && !connection.group) switchConnection.mutate({ sessionId: connection.session.id, userId: member.userId }, { onError: onFail });
    else connect.mutate(member.userId, { onError: onFail });
  };

  return (
    <Screen edges={["top"]}>
      <LargeHeader
        eyebrow={<SiteEyebrow />}
        title={t("tab.connect")}
        right={manager && <IconButton icon="qr-code-outline" tone="brand" label={t("members.invite")} onPress={() => router.push("/site/join-code")} />}
      />
      <SiteBanners hideConnection />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={members.isRefetching || conversations.isRefetching}
            onRefresh={() => void Promise.all([members.refetch(), conversations.refetch()])}
            tintColor={colors.brand}
          />
        }
      >
        {manager && pending.length > 0 && (
          <>
            <SectionTitle title={`${t("members.pending")} · ${pending.length}`} />
            {pending.map((member) => (
              <Card key={member.userId} style={styles.pending}>
                <View style={styles.row}>
                  <Avatar id={member.userId} name={member.displayName} lang={member.lang} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={font.bodyStrong}>{member.displayName}</Text>
                    <Text style={styles.meta}>{nativeNameOf(member.lang)}</Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <Button
                    title={t("members.reject")}
                    variant="secondary"
                    size="md"
                    style={{ flex: 1 }}
                    onPress={() => update.mutate({ userId: member.userId, action: { action: "reject" } }, { onError })}
                  />
                  <Button
                    title={t("members.approve")}
                    size="md"
                    icon="checkmark"
                    style={{ flex: 1 }}
                    onPress={() => update.mutate({ userId: member.userId, action: { action: "approve" } }, { onError })}
                  />
                </View>
              </Card>
            ))}
          </>
        )}

        <ConnectionPanel />

        {!connection.group && (
          <GroupConnectCard
            count={inGroup.size}
            joining={joinGroup.isPending}
            onJoin={() => joinGroup.mutate(undefined, { onError })}
          />
        )}

        <SectionTitle title={`${t("members.active")} · ${active.length}`} />
        {active.length <= 1 && !members.isPending && (
          <Card>
            <EmptyState
              icon="person-add-outline"
              message={t("members.empty")}
              action={manager && <Button title={t("members.invite")} icon="qr-code-outline" fullWidth={false} onPress={() => router.push("/site/join-code")} />}
            />
          </Card>
        )}
        <Card padded={false}>
          {active.map((member, index) => {
            const isMe = member.userId === me.data?.id;
            const connected = member.userId === connectedTo;
            return (
              <View key={member.userId} style={connected && styles.connected}>
                {index > 0 && <Divider inset={76} />}
                <ListRow
                  title={member.displayName}
                  subtitle={nativeNameOf(member.lang)}
                  // 누르면 바로 연결·전환, 길게 누르거나 ⋯ 를 누르면 메뉴 (메시지·언어·관리)
                  onPress={isMe ? undefined : () => connectTo(member)}
                  onLongPress={isMe ? undefined : () => setSelected(member)}
                  chevron={false}
                  right={
                    <View style={styles.badges}>
                      {connected && <Badge label={t("conn.badge")} tone="brand" />}
                      {!isMe && !connected && inGroup.has(member.userId) && <Badge label={t("conn.groupInside")} tone="brand" />}
                      {/* 기기를 아직 모르면 칩을 빼서 이름 자리를 남긴다 (10-27 Note 9 에서 이름이 "…" 로 잘림) */}
                      {!isMe && member.online && !connected && member.device && <DeviceChip device={member.device} />}
                      {isMe && <Badge label={t("common.you")} tone="brand" />}
                      {member.role === "manager" && <Badge label={t("role.manager")} tone="dark" />}
                      {!isMe && <IconButton icon="ellipsis-horizontal" label={t("conn.more")} tone="plain" size={36} onPress={() => setSelected(member)} />}
                    </View>
                  }
                  leading={<Avatar id={member.userId} name={member.displayName} size={44} online={member.online} highlighted={connected} />}
                />
              </View>
            );
          })}
        </Card>

        <SectionTitle title={t("conv.messages")} />
        {group && <GroupCard conversation={group} />}
        {directs.map((conversation) => (
          <DirectRow key={conversation.id} conversation={conversation} />
        ))}
      </ScrollView>

      <Sheet visible={!!selected && !langSheet} onClose={() => setSelected(null)} title={selected?.displayName}>
        {selected && (
          <View style={{ gap: spacing.sm }}>
            <Button title={t("members.message")} icon="chatbubble-ellipses" variant="secondary" onPress={() => message(selected)} />
            {manager && (
              <>
                <Button title={`${t("members.changeLang")} · ${nativeNameOf(selected.lang)}`} icon="language" variant="secondary" onPress={() => setLangSheet(true)} />
                <Button
                  title={t(selected.role === "manager" ? "members.unsetManager" : "members.setManager")}
                  icon={selected.role === "manager" ? "shield-outline" : "shield-checkmark"}
                  variant="secondary"
                  onPress={() =>
                    confirm(
                      t(selected.role === "manager" ? "members.unsetManagerConfirm" : "members.setManagerConfirm", { name: selected.displayName }),
                      () => {
                        update.mutate(
                          { userId: selected.userId, action: { role: selected.role === "manager" ? "member" : "manager" } },
                          { onError },
                        );
                        setSelected(null);
                      },
                      t(selected.role === "manager" ? "members.unsetManager" : "members.setManager"),
                      t("common.cancel"),
                    )
                  }
                />
                {selected.role !== "manager" && (
                  <Button
                    title={t("members.remove")}
                    icon="person-remove"
                    variant="danger"
                    onPress={() =>
                      confirm(
                        t("members.removeConfirm", { name: selected.displayName }),
                        () => {
                          update.mutate({ userId: selected.userId, action: { action: "remove" } }, { onError });
                          setSelected(null);
                        },
                        t("members.remove"),
                        t("common.cancel"),
                      )
                    }
                  />
                )}
              </>
            )}
          </View>
        )}
      </Sheet>

      <Sheet visible={langSheet} onClose={() => setLangSheet(false)} title={t("members.changeLang")}>
        {selected && (
          <LanguageGrid
            value={selected.lang}
            onChange={(lang) => {
              update.mutate({ userId: selected.userId, action: { langOverride: lang } }, { onError });
              setLangSheet(false);
              setSelected(null);
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}

/** 현장 전체 연결 카드: 열려 있으면 인원, 누르면 들어간다 (없으면 연다). 들어가 있을 때는 연결 패널이 대신한다 */
function GroupConnectCard({ count, joining, onJoin }: { count: number; joining: boolean; onJoin: () => void }) {
  const { t } = useT();
  return (
    <Card style={[styles.groupCard, count > 0 && styles.groupLive]}>
      <View style={styles.row}>
        <View style={styles.groupIcon}>
          <Ionicons name="people" size={22} color={colors.onBrand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={font.bodyStrong} numberOfLines={1}>
            {t("conn.group")}
          </Text>
          <Text style={styles.meta} numberOfLines={2}>
            {count > 0 ? t("conn.groupLive", { n: count }) : t("conn.groupDesc")}
          </Text>
        </View>
        <Button title={t("conn.groupJoin")} icon="enter-outline" size="md" fullWidth={false} loading={joining} onPress={onJoin} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.sm },
  pending: { gap: spacing.md, borderColor: colors.brandBorder },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  meta: { ...font.caption, color: colors.muted, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  connected: { backgroundColor: colors.brandSoft },
  groupCard: { gap: spacing.sm },
  groupLive: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
  groupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
