import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { EMAIL_PATTERN, MIN_PASSWORD } from "@/lib/validation";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { colors, font, spacing } from "@/theme";

export default function SignUp() {
  const { t, lang } = useT();
  const signedIn = useSessionStore((state) => state.authStatus === "signedIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  if (signedIn) return <Redirect href="/" />;

  const submit = async () => {
    const next: typeof errors = {};
    if (!EMAIL_PATTERN.test(email.trim())) next.email = t("auth.invalidEmail");
    if (password.length < MIN_PASSWORD) next.password = t("auth.passwordTooShort");
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      const { needsConfirmation } = await services.auth.signUp(email.trim(), password);
      if (needsConfirmation) {
        toast(t("auth.checkEmail"), "success");
        router.replace("/sign-in");
      } else {
        router.replace("/");
      }
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : t("error.generic") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          <Button title={t("auth.signUp")} onPress={submit} loading={loading} />
          <Pressable onPress={() => router.replace("/sign-in")} style={styles.switch} accessibilityRole="link">
            <Text style={styles.switchText}>
              {t("auth.haveAccount")} <Text style={styles.link}>{t("auth.signIn")}</Text>
            </Text>
          </Pressable>
        </>
      }
    >
      <StackHeader />
      <Text style={font.display}>{t("auth.signUpTitle")}</Text>
      <Card style={styles.langCard} padded={false}>
        <Text style={styles.langLabel}>{t("lang.title")}</Text>
        <Text style={font.bodyStrong}>{nativeNameOf(lang)}</Text>
      </Card>
      <View style={{ gap: spacing.lg }}>
        <TextField
          label={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          error={errors.email}
        />
        <TextField
          label={t("auth.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          hint={t("auth.passwordHint")}
          error={errors.password ?? errors.form}
          onSubmitEditing={submit}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  langCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, backgroundColor: colors.brandSoft, borderColor: colors.brandBorder },
  langLabel: { ...font.label, color: colors.brandPressed },
  switch: { alignItems: "center", paddingVertical: spacing.sm },
  switchText: { ...font.label, color: colors.muted, fontWeight: "500" },
  link: { ...font.label, color: colors.brandPressed },
});
