import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { InboxCard, SentInstructionCard } from "@/components/InstructionCards";
import { InfoNotice, SiteBanners } from "@/components/live/LiveParts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LargeHeader, Screen } from "@/components/ui/Screen";
import { SiteEyebrow } from "@/components/SiteEyebrow";
import { useCurrentSite, useInbox, useInstructions, useRespondInstruction, useSiteId } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { services } from "@/services";
import { demoIncomingBroadcast } from "@/services/mock/demo";
import { toast } from "@/stores/toast";
import { colors, spacing } from "@/theme";

export default function Instructions() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const { site } = useCurrentSite();
  const manager = site?.role === "manager";
  const sent = useInstructions(siteId, manager);
  const inbox = useInbox(siteId, !manager);
  const respond = useRespondInstruction(siteId);
  const query = manager ? sent : inbox;

  return (
    <Screen edges={["top"]}>
      <LargeHeader eyebrow={<SiteEyebrow />} title={t("instr.title")} />
      <SiteBanners />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.brand} />}
      >
        {manager && (
          <>
            <Button title={t("bc.start")} icon="radio" onPress={() => router.push("/site/broadcast/new")} />
            <InfoNotice tone="info" text={t("bc.startDesc")} />
            <Button
              title={t("instr.written")}
              icon="create-outline"
              variant="secondary"
              onPress={() => router.push("/site/instruction/new")}
              style={{ marginBottom: spacing.sm }}
            />
          </>
        )}
        {!manager && services.mode === "mock" && (
          <Button title={t("bc.demoReceive")} icon="sparkles-outline" variant="ghost" onPress={() => demoIncomingBroadcast(siteId)} />
        )}
        {manager
          ? sent.data?.map((item) => <SentInstructionCard key={item.id} item={item} />)
          : inbox.data?.map((item) => (
              <InboxCard
                key={item.id}
                item={item}
                acking={respond.isPending && respond.variables?.messageId === item.id}
                onAck={() => respond.mutate({ messageId: item.id, action: "ack" }, { onError: (e) => toast(errorMessage(e), "error") })}
              />
            ))}
        {!query.isPending && (query.data?.length ?? 0) === 0 && (
          <Card>
            <EmptyState icon="megaphone-outline" message={t(manager ? "instr.emptyManager" : "instr.emptyMember")} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
});
