import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import type { Lang } from "@shared/languages";
import { Button } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";
import { LanguageGrid } from "@/components/ui/LanguageGrid";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useSaveProfile } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { colors, font, spacing } from "@/theme";

/** 최초 1회: 이름과 언어 */
export default function Onboarding() {
  const { t, lang: uiLang } = useT();
  const errorMessage = useErrorMessage();
  const authStatus = useSessionStore((state) => state.authStatus);
  const setUiLang = useSessionStore((state) => state.setUiLang);
  const save = useSaveProfile();
  const [name, setName] = useState("");
  const [lang, setLang] = useState<Lang>(uiLang);
  if (authStatus === "signedOut") return <Redirect href="/welcome" />;

  const valid = name.trim().length > 0 && name.trim().length <= 40;
  const submit = () =>
    save.mutate(
      { displayName: name.trim(), preferredLang: lang },
      { onSuccess: () => router.replace("/") },
    );

  return (
    <Screen
      scroll
      footer={
        <Button
          title={t("profile.start")}
          onPress={submit}
          disabled={!valid}
          loading={save.isPending}
        />
      }
    >
      <StackHeader backIcon="close" onBack={() => void services.auth.signOut()} />
      <View style={{ gap: spacing.sm }}>
        <Text style={font.display}>{t("profile.title")}</Text>
        <Text style={[font.body, { color: colors.inkSoft }]}>{t("profile.desc")}</Text>
      </View>
      <TextField
        label={t("profile.name")}
        placeholder={t("profile.namePlaceholder")}
        value={name}
        onChangeText={setName}
        maxLength={40}
        autoComplete="name"
        error={save.isError ? errorMessage(save.error) : null}
      />
      <View>
        <SectionTitle title={t("lang.title")} />
        <LanguageGrid
          value={lang}
          onChange={(next) => {
            setLang(next);
            setUiLang(next);
          }}
        />
        <Text style={[font.caption, { color: colors.muted, marginTop: spacing.sm }]}>{t("lang.hint")}</Text>
      </View>
    </Screen>
  );
}
