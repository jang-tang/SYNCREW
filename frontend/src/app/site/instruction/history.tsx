import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { SentInstructionCard } from "@/components/InstructionCards";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { useInstructions, useSiteId } from "@/hooks/queries";
import { useT } from "@/i18n";
import { colors, spacing } from "@/theme";

// 관리자가 보낸 지시 기록 (2026-10-27: 지시 탭 첫 화면에서 따로 떼어 냄 — 첫 화면은 사람 고르기·시작만)

export default function InstructionHistory() {
  const { t } = useT();
  const siteId = useSiteId();
  const sent = useInstructions(siteId, true);

  return (
    <Screen>
      <StackHeader title={t("instr.history")} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={sent.isRefetching} onRefresh={() => void sent.refetch()} tintColor={colors.brand} />}
      >
        {sent.data?.map((item) => <SentInstructionCard key={item.id} item={item} />)}
        {!sent.isPending && (sent.data?.length ?? 0) === 0 && (
          <Card>
            <EmptyState icon="megaphone-outline" message={t("instr.emptyManager")} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
});
