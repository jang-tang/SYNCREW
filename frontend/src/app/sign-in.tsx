import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n";
import { services } from "@/services";
import { EMAIL_PATTERN } from "@/lib/validation";
import { useSessionStore } from "@/stores/session";
import { colors, font, spacing } from "@/theme";

export default function SignIn() {
  const { t } = useT();
  const signedIn = useSessionStore((state) => state.authStatus === "signedIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (signedIn) return <Redirect href="/" />;

  const submit = async () => {
    if (!EMAIL_PATTERN.test(email.trim())) return setError(t("auth.invalidEmail"));
    if (password.length < 8) return setError(t("auth.passwordTooShort"));
    setError(null);
    setLoading(true);
    try {
      await services.auth.signIn(email.trim(), password);
      router.replace("/");
    } catch {
      setError(t("auth.signInFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      scroll
      footer={
        <>
          <Button title={t("auth.signIn")} onPress={submit} loading={loading} />
          <Pressable onPress={() => router.replace("/sign-up")} style={styles.switch} accessibilityRole="link">
            <Text style={styles.switchText}>
              {t("auth.noAccount")} <Text style={styles.link}>{t("auth.signUp")}</Text>
            </Text>
          </Pressable>
        </>
      }
    >
      <StackHeader />
      <Text style={font.display}>{t("auth.signInTitle")}</Text>
      <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
        <TextField
          label={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <TextField
          label={t("auth.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
          error={error}
        />
        <Pressable onPress={() => router.push("/forgot-password")} accessibilityRole="link" style={{ alignSelf: "flex-end" }}>
          <Text style={styles.link}>{t("auth.forgot")}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  switch: { alignItems: "center", paddingVertical: spacing.sm },
  switchText: { ...font.label, color: colors.muted, fontWeight: "500" },
  link: { ...font.label, color: colors.brandPressed },
});
