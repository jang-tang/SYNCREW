import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SUPPORTED_LANGUAGES, type Lang } from "@shared/languages";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { useT } from "@/i18n";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { colors, font, radius, spacing } from "@/theme";

// 제품을 한눈에 보여 주는 예시: 한 문장이 각자의 언어로 전달된다.
const DEMO: { lang: Lang; text: string }[] = [
  { lang: "vi", text: "Hãy đội mũ bảo hộ rồi bắt đầu làm việc." },
  { lang: "ru", text: "Наденьте каску и приступайте к работе." },
  { lang: "zh", text: "请戴好安全帽后开始作业。" },
];

export default function Welcome() {
  const { t, lang } = useT();
  const setUiLang = useSessionStore((state) => state.setUiLang);
  const signedIn = useSessionStore((state) => state.authStatus === "signedIn");
  if (signedIn) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Logo height={24} variant="white" />
        {services.mode === "mock" && (
          <View style={styles.demo}>
            <Text style={styles.demoText}>{t("app.demoMode")}</Text>
          </View>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.langs}>
        {SUPPORTED_LANGUAGES.map((language) => {
          const active = language.code === lang;
          return (
            <Pressable
              key={language.code}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setUiLang(language.code)}
              style={[styles.langChip, active && styles.langChipActive]}
            >
              <Text style={[styles.langText, active && { color: colors.ink }]}>{language.nativeName}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.hero}>
        <Text style={styles.title}>{t("welcome.title")}</Text>
        <Text style={styles.subtitle}>{t("welcome.subtitle")}</Text>

        <View style={styles.demoCard}>
          <View style={styles.speaker}>
            <View style={styles.mic}>
              <Ionicons name="mic" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.speakerLabel}>KO</Text>
              <Text style={styles.speakerText}>안전모를 착용하고 작업을 시작하세요.</Text>
            </View>
          </View>
          {DEMO.map((item) => (
            <View key={item.lang} style={styles.out}>
              <View style={styles.connector} />
              <View style={styles.outBubble}>
                <Text style={styles.outLang}>{item.lang.toUpperCase()}</Text>
                <Text style={styles.outText} numberOfLines={1}>
                  {item.text}
                </Text>
                <Ionicons name="volume-high" size={14} color={colors.brand} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Button title={t("auth.signUp")} onPress={() => router.push("/sign-up")} />
        <Button title={t("auth.signIn")} variant="onDark" onPress={() => router.push("/sign-in")} />
        <Text style={styles.tagline}>{t("app.tagline")}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  demo: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: "rgba(248,128,26,0.18)" },
  demoText: { ...font.caption, fontWeight: "700", color: colors.brand },
  langs: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  langChip: {
    height: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  langChipActive: { backgroundColor: "#FFFFFF", borderColor: "#FFFFFF" },
  langText: { ...font.label, color: "rgba(255,255,255,0.8)" },
  hero: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: "center", gap: spacing.md },
  title: { ...font.display, fontSize: 32, lineHeight: 42, color: "#FFFFFF" },
  subtitle: { ...font.body, color: "rgba(255,255,255,0.62)" },
  demoCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: spacing.sm,
  },
  speaker: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  mic: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand },
  speakerLabel: { fontSize: 10, fontWeight: "800", color: colors.brand, letterSpacing: 0.6 },
  speakerText: { ...font.bodyStrong, color: "#FFFFFF" },
  out: { flexDirection: "row", alignItems: "center", paddingLeft: 17 },
  connector: { width: 18, height: 1.5, backgroundColor: "rgba(248,128,26,0.6)" },
  outBubble: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  outLang: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.5)", width: 20 },
  outText: { ...font.label, color: "#FFFFFF", flex: 1, fontWeight: "500" },
  actions: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm },
  tagline: { ...font.caption, color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: spacing.sm },
});
