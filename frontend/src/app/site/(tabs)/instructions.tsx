import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { BroadcastQuickStart } from "@/components/BroadcastQuickStart";
import { InboxCard } from "@/components/InstructionCards";
import { InfoNotice, SiteBanners } from "@/components/live/LiveParts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListRow";
import { LargeHeader, Screen } from "@/components/ui/Screen";
import { SiteEyebrow } from "@/components/SiteEyebrow";
import { useCurrentSite, useInbox, useInstructions, useMembers, useRespondInstruction, useSiteId } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { services } from "@/services";
import { demoIncomingBroadcast } from "@/services/mock/demo";
import { toast } from "@/stores/toast";
import { colors, spacing } from "@/theme";

// 관리자: 첫 화면에서 사람을 고르고 바로 실시간 지시 + 문자 지시, 보낸 기록은 따로 (2026-10-27 사용자 요청)
// 구성원: 받은 지시 목록

export default function Instructions() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const { site } = useCurrentSite();
  const manager = site?.role === "manager";
  const sent = useInstructions(siteId, manager);
  const inbox = useInbox(siteId, !manager);
  const members = useMembers(siteId);
  const respond = useRespondInstruction(siteId);
  const refresh = () => {
    void (manager ? sent : inbox).refetch();
    void members.refetch();
  };
  const refreshing = (manager ? sent : inbox).isRefetching || members.isRefetching;

  return (
    <Screen edges={["top"]}>
      <LargeHeader eyebrow={<SiteEyebrow />} title={t("instr.title")} />
      <SiteBanners />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        {manager ? (
          <>
            <BroadcastQuickStart siteId={siteId} />
            <InfoNotice tone="info" text={t("bc.startDesc")} />
            <Button title={t("instr.written")} icon="create-outline" variant="secondary" onPress={() => router.push("/site/instruction/new")} />
            <Card padded={false}>
              <ListRow
                icon="time-outline"
                title={t("instr.history")}
                value={sent.data ? String(sent.data.length) : undefined}
                onPress={() => router.push("/site/instruction/history")}
              />
            </Card>
          </>
        ) : (
          <>
            {services.mode === "mock" && (
              <Button title={t("bc.demoReceive")} icon="sparkles-outline" variant="ghost" onPress={() => demoIncomingBroadcast(siteId)} />
            )}
            {inbox.data?.map((item) => (
              <InboxCard
                key={item.id}
                item={item}
                acking={respond.isPending && respond.variables?.messageId === item.id}
                onAck={() => respond.mutate({ messageId: item.id, action: "ack" }, { onError: (e) => toast(errorMessage(e), "error") })}
              />
            ))}
            {!inbox.isPending && (inbox.data?.length ?? 0) === 0 && (
              <Card>
                <EmptyState icon="megaphone-outline" message={t("instr.emptyMember")} />
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
});
