import { router } from "expo-router";
import { useState } from "react";
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Member } from "@shared/api";
import { Avatar } from "@/components/ui/Avatar";
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
import { useCurrentSite, useMe, useMembers, useOpenDirect, useSiteId, useStartCall, useUpdateMember } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
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

export default function Members() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const me = useMe();
  const { site } = useCurrentSite();
  const manager = site?.role === "manager";
  const members = useMembers(siteId);
  const update = useUpdateMember(siteId);
  const openDirect = useOpenDirect(siteId);
  const startCall = useStartCall(siteId);
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

  /** 1:1 실시간 통역 통화 (상대가 접속해 있어야 한다) */
  const call = (member: Member) => {
    setSelected(null);
    startCall.mutate(member.userId, { onSuccess: (session) => router.push(`/site/call/${session.id}`), onError });
  };

  return (
    <Screen edges={["top"]}>
      <LargeHeader
        eyebrow={<SiteEyebrow />}
        title={t("tab.members")}
        right={manager && <IconButton icon="qr-code-outline" tone="brand" label={t("members.invite")} onPress={() => router.push("/site/join-code")} />}
      />
      <SiteBanners />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={members.isRefetching} onRefresh={() => void members.refetch()} tintColor={colors.brand} />}
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
            return (
              <View key={member.userId}>
                {index > 0 && <Divider inset={76} />}
                <ListRow
                  title={member.displayName}
                  subtitle={nativeNameOf(member.lang)}
                  onPress={isMe ? undefined : () => setSelected(member)}
                  right={
                    <View style={styles.badges}>
                      {!isMe && member.online && <DeviceChip device={member.device} />}
                      {isMe && <Badge label={t("common.you")} tone="brand" />}
                      {member.role === "manager" && <Badge label={t("role.manager")} tone="dark" />}
                    </View>
                  }
                  leading={<Avatar id={member.userId} name={member.displayName} size={44} online={member.online} />}
                />
              </View>
            );
          })}
        </Card>
      </ScrollView>

      <Sheet visible={!!selected && !langSheet} onClose={() => setSelected(null)} title={selected?.displayName}>
        {selected && (
          <View style={{ gap: spacing.sm }}>
            <Button
              title={t("call.start")}
              icon="call"
              disabled={!selected.online}
              loading={startCall.isPending}
              onPress={() => call(selected)}
            />
            <Button title={t("members.message")} icon="chatbubble-ellipses" variant="secondary" onPress={() => message(selected)} />
            {manager && (
              <>
                <Button title={`${t("members.changeLang")} · ${nativeNameOf(selected.lang)}`} icon="language" variant="secondary" onPress={() => setLangSheet(true)} />
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

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.sm },
  pending: { gap: spacing.md, borderColor: colors.brandBorder },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  meta: { ...font.caption, color: colors.muted, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
