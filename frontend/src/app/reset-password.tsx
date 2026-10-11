import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n";
import { MIN_PASSWORD } from "@/lib/validation";
import { services } from "@/services";
import { toast } from "@/stores/toast";
import { colors, font } from "@/theme";

/** 비밀번호 재설정 메일 링크(syncrew://reset-password)로 들어오는 화면 */
export default function ResetPassword() {
  const { t } = useT();
  const url = Linking.useLinkingURL();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) return;
    services.auth
      .handleAuthRedirect(url)
      .then((ok) => (ok ? setReady(true) : setError(t("error.generic"))))
      .catch((e) => setError(e instanceof Error ? e.message : t("error.generic")));
  }, [url, t]);

  const submit = async () => {
    if (password.length < MIN_PASSWORD) return setError(t("auth.passwordTooShort"));
    setLoading(true);
    try {
      await services.auth.updatePassword(password);
      toast(t("reset.updated"), "success");
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll footer={ready && <Button title={t("reset.update")} onPress={submit} loading={loading} />}>
      <StackHeader onBack={() => router.replace("/")} />
      <Text style={font.display}>{t("reset.title")}</Text>
      {ready ? (
        <TextField
          label={t("reset.newPassword")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          hint={t("auth.passwordHint")}
          error={error}
          onSubmitEditing={submit}
        />
      ) : error ? (
        <Text style={[font.body, { color: colors.danger }]}>{error}</Text>
      ) : (
        <ActivityIndicator color={colors.brand} />
      )}
    </Screen>
  );
}
