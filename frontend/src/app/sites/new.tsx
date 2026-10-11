import { router } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useCreateSite } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { useSessionStore } from "@/stores/session";
import { colors, font } from "@/theme";

export default function NewSite() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const create = useCreateSite();
  const setSiteId = useSessionStore((state) => state.setSiteId);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const submit = () =>
    create.mutate(
      { name: name.trim(), ...(address.trim() ? { address: address.trim() } : {}) },
      {
        onSuccess: (site) => {
          setSiteId(site.id);
          router.replace("/site");
          router.push("/site/join-code");
        },
      },
    );

  return (
    <Screen
      scroll
      footer={<Button title={t("siteNew.submit")} onPress={submit} disabled={!name.trim()} loading={create.isPending} />}
    >
      <StackHeader />
      <Text style={font.display}>{t("siteNew.title")}</Text>
      <Text style={[font.body, { color: colors.inkSoft }]}>{t("siteNew.desc")}</Text>
      <TextField
        label={t("siteNew.name")}
        placeholder={t("siteNew.namePlaceholder")}
        value={name}
        onChangeText={setName}
        maxLength={60}
        autoFocus
      />
      <TextField
        label={t("siteNew.address")}
        value={address}
        onChangeText={setAddress}
        maxLength={120}
        error={create.isError ? errorMessage(create.error) : null}
      />
    </Screen>
  );
}
