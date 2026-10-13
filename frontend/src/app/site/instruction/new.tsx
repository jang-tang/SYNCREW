import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { RecipientPicker, RecipientSummary, useRecipientPicker } from "@/components/RecipientPicker";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { ListRow, Toggle } from "@/components/ui/ListRow";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { newClientMessageId, useCreateInstruction, useSiteId } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { toast } from "@/stores/toast";
import { spacing } from "@/theme";

export default function NewInstruction() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const picker = useRecipientPicker(siteId);
  const create = useCreateInstruction(siteId);
  const [text, setText] = useState("");
  const [requiresAck, setRequiresAck] = useState(true);
  const { targets } = picker;

  const done = () => {
    picker.remember();
    toast(t("instr.sent"), "success");
    if (router.canGoBack()) router.back();
    else router.replace("/site/instructions");
  };
  const onError = (error: unknown) => toast(errorMessage(error), "error");

  return (
    <Screen
      scroll
      footer={
        <View style={{ gap: spacing.sm }}>
          <RecipientSummary picker={picker} />
          <Button
            title={t("instr.send", { n: targets.length })}
            icon="send"
            disabled={!text.trim() || targets.length === 0}
            loading={create.isPending}
            onPress={() =>
              create.mutate(
                { clientMessageId: newClientMessageId(), target: picker.target, requiresAck, text: text.trim() },
                { onSuccess: done, onError },
              )
            }
          />
        </View>
      }
    >
      <StackHeader title={t("instr.new")} backIcon="close" />

      <RecipientPicker picker={picker} />

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
