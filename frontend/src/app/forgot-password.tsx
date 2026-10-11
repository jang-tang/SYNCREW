import { useState } from "react";
import { Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n";
import { EMAIL_PATTERN } from "@/lib/validation";
import { services } from "@/services";
import { colors, font } from "@/theme";

export default function ForgotPassword() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!EMAIL_PATTERN.test(email.trim())) return setError(t("auth.invalidEmail"));
    setError(null);
    setLoading(true);
    try {
      await services.auth.requestPasswordReset(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll footer={!sent && <Button title={t("reset.send")} onPress={submit} loading={loading} />}>
      <StackHeader />
      <Text style={font.display}>{t("reset.title")}</Text>
      <Text style={[font.body, { color: colors.inkSoft }]}>{t("reset.desc")}</Text>
      {sent ? (
        <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.successSoft }}>
          <Text style={[font.bodyStrong, { color: colors.success }]}>{t("reset.sent")}</Text>
        </Card>
      ) : (
        <TextField
          label={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          error={error}
          onSubmitEditing={submit}
        />
      )}
    </Screen>
  );
}
