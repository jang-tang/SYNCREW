import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useJoin } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { toast } from "@/stores/toast";
import { colors, font } from "@/theme";

const clean = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

export default function JoinSite() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const params = useLocalSearchParams<{ code?: string }>();
  const join = useJoin();
  const [code, setCode] = useState(clean(params.code ?? ""));

  useEffect(() => {
    if (params.code) setCode(clean(params.code));
  }, [params.code]);

  const submit = () =>
    join.mutate(code, {
      onSuccess: (result) => {
        toast(t("join.requested", { site: result.siteName }), "success");
        router.dismissTo("/sites");
      },
    });

  return (
    <Screen
      scroll
      footer={
        <>
          <Button title={t("join.submit")} onPress={submit} disabled={code.length !== 8} loading={join.isPending} />
          <Button title={t("join.scan")} icon="scan-outline" variant="secondary" onPress={() => router.push("/sites/scan")} />
        </>
      }
    >
      <StackHeader />
      <Text style={font.display}>{t("join.title")}</Text>
      <Text style={[font.body, { color: colors.inkSoft }]}>{t("join.desc")}</Text>
      <TextField
        value={code}
        onChangeText={(value) => setCode(clean(value))}
        placeholder="A7K92QXM"
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus={!params.code}
        maxLength={8}
        style={styles.code}
        onSubmitEditing={() => code.length === 8 && submit()}
        error={join.isError ? errorMessage(join.error) : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 28, lineHeight: 36, fontWeight: "800", letterSpacing: 6, textAlign: "center", color: colors.ink },
});
