import { router } from "expo-router";
import { View } from "react-native";
import { InfoNotice } from "@/components/live/LiveParts";
import { RecipientPicker, RecipientSummary, useRecipientPicker } from "@/components/RecipientPicker";
import { Button } from "@/components/ui/Button";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { useSiteId, useStartBroadcast } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { toast } from "@/stores/toast";
import { spacing } from "@/theme";

// 관리자 일괄 지시 시작: 수신 대상(전체·선택)과 각자의 언어·이어폰 연결 상태를 확인한 뒤 시작한다.

export default function NewBroadcast() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const picker = useRecipientPicker(siteId);
  const start = useStartBroadcast(siteId);
  const { targets } = picker;

  const begin = () =>
    start.mutate(picker.target, {
      onSuccess: (session) => {
        picker.remember();
        router.replace(`/site/broadcast/${session.id}`);
      },
      onError: (error) => toast(errorMessage(error), "error"),
    });

  return (
    <Screen
      scroll
      footer={
        <View style={{ gap: spacing.sm }}>
          <RecipientSummary picker={picker} />
          <Button title={t("bc.startN", { n: targets.length })} icon="radio" disabled={targets.length === 0} loading={start.isPending} onPress={begin} />
        </View>
      }
    >
      <StackHeader title={t("bc.title")} backIcon="close" />
      <InfoNotice tone="info" text={t("bc.startDesc")} />
      <RecipientPicker picker={picker} />
    </Screen>
  );
}
