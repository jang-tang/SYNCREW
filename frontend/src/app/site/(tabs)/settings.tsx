import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { playNow } from "@/audio/playback";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, Divider, SectionTitle } from "@/components/ui/Card";
import { LanguageGrid } from "@/components/ui/LanguageGrid";
import { ListRow, Toggle } from "@/components/ui/ListRow";
import { Logo } from "@/components/ui/Logo";
import { LargeHeader, Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { TextField } from "@/components/ui/TextField";
import { useCurrentSite, useHealth, useMe, useSaveProfile } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { translate, useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { colors, font, spacing } from "@/theme";

const RATES = [
  { value: "0.8", key: "settings.slow" },
  { value: "1", key: "settings.normal" },
  { value: "1.2", key: "settings.fast" },
] as const;

export default function Settings() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const me = useMe();
  const { site } = useCurrentSite();
  const save = useSaveProfile();
  const health = useHealth();
  const connection = useSessionStore((state) => state.connection);
  const setSiteId = useSessionStore((state) => state.setSiteId);
  const [nameSheet, setNameSheet] = useState(false);
  const [langSheet, setLangSheet] = useState(false);
  const [name, setName] = useState("");
  const profile = me.data;
  if (!profile) return null;

  const update = (patch: Partial<typeof profile>) =>
    save.mutate(
      { displayName: profile.displayName, preferredLang: profile.preferredLang, autoPlay: profile.autoPlay, speechRate: profile.speechRate, ...patch },
      { onError: (e) => toast(errorMessage(e), "error") },
    );

  const signOut = async () => {
    setSiteId(null);
    await services.auth.signOut();
    router.replace("/welcome");
  };

  const rate = RATES.reduce((best, item) => (Math.abs(Number(item.value) - profile.speechRate) < Math.abs(Number(best.value) - profile.speechRate) ? item : best)).value;
  const connectionLabel = connection === "connected" ? t("net.connected") : connection === "offline" ? t("net.offline") : t("net.connecting");

  return (
    <Screen edges={["top"]}>
      <LargeHeader title={t("tab.settings")} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.profile}>
          <Avatar id={profile.id} name={profile.displayName} size={60} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={font.headline} numberOfLines={1}>
              {profile.displayName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {profile.email || " "}
            </Text>
            {site && <Badge label={t(`role.${site.role}`)} tone={site.role === "manager" ? "dark" : "neutral"} />}
          </View>
          <IconButton
            icon="pencil"
            label={t("profile.name")}
            onPress={() => {
              setName(profile.displayName);
              setNameSheet(true);
            }}
          />
        </Card>

        <SectionTitle title={t("lang.title")} />
        <Card padded={false}>
          <ListRow icon="language" title={nativeNameOf(profile.preferredLang)} subtitle={t("lang.hint")} onPress={() => setLangSheet(true)} />
        </Card>

        <SectionTitle title={t("settings.voice")} />
        <Card padded={false}>
          <ListRow icon="volume-high-outline" title={t("settings.autoPlay")} right={<Toggle value={profile.autoPlay} onChange={(autoPlay) => update({ autoPlay })} />} />
          <Divider inset={64} />
          <View style={styles.rate}>
            <Text style={font.bodyStrong}>{t("settings.speechRate")}</Text>
            <Segmented
              value={rate}
              onChange={(value) => update({ speechRate: Number(value) })}
              options={RATES.map((item) => ({ value: item.value, label: t(item.key) }))}
            />
            <Button
              title={t("settings.testVoice")}
              icon="play"
              variant="secondary"
              size="md"
              onPress={() =>
                playNow({
                  id: "voice-test",
                  text: translate(profile.preferredLang, "settings.voiceSample"),
                  lang: profile.preferredLang,
                  audioUrl: null,
                  rate: profile.speechRate,
                })
              }
            />
          </View>
        </Card>

        <SectionTitle title={t("settings.site")} />
        <Card padded={false}>
          <ListRow icon="business-outline" title={site?.name ?? "—"} subtitle={site?.address ?? undefined} />
          <Divider inset={64} />
          {site?.role === "manager" && (
            <>
              <ListRow icon="qr-code-outline" title={t("members.invite")} onPress={() => router.push("/site/join-code")} />
              <Divider inset={64} />
            </>
          )}
          <ListRow icon="swap-horizontal" title={t("settings.switchSite")} onPress={() => router.push("/sites")} />
        </Card>

        <SectionTitle title={t("settings.system")} />
        <Card padded={false}>
          <ListRow icon="hardware-chip-outline" title={t("settings.mode")} value={services.mode === "mock" ? t("app.demoMode") : t("settings.live")} />
          <Divider inset={64} />
          <ListRow
            icon="pulse-outline"
            title={t("settings.realtime")}
            right={<Badge label={connectionLabel} tone={connection === "connected" ? "success" : connection === "offline" ? "warning" : "neutral"} dot />}
          />
          {services.mode === "live" && (
            <>
              <Divider inset={64} />
              <ListRow
                icon="server-outline"
                title={t("settings.server")}
                right={<Badge label={health.data?.status === "ok" ? t("server.online") : t("server.offline")} tone={health.data?.status === "ok" ? "success" : "danger"} dot />}
              />
            </>
          )}
        </Card>

        <Card padded={false} style={{ marginTop: spacing.lg }}>
          <ListRow icon="log-out-outline" title={t("settings.signOut")} danger onPress={() => void signOut()} chevron={false} />
        </Card>

        <View style={styles.footer}>
          <Logo height={18} />
          <Text style={styles.meta}>SYNCREW 0.1.0</Text>
        </View>
      </ScrollView>

      <Sheet visible={nameSheet} onClose={() => setNameSheet(false)} title={t("profile.name")}>
        <TextField value={name} onChangeText={setName} maxLength={40} autoFocus />
        <Button
          title={t("common.save")}
          disabled={!name.trim()}
          loading={save.isPending}
          onPress={() => {
            update({ displayName: name.trim() });
            setNameSheet(false);
          }}
        />
      </Sheet>

      <Sheet visible={langSheet} onClose={() => setLangSheet(false)} title={t("lang.title")}>
        <LanguageGrid
          value={profile.preferredLang}
          onChange={(preferredLang) => {
            update({ preferredLang });
            setLangSheet(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  meta: { ...font.caption, color: colors.muted },
  rate: { padding: spacing.lg, gap: spacing.md },
  footer: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xxl, opacity: 0.7 },
});
