import { Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { useCreateJoinCode, useCurrentSite, useJoinCodes, useRevokeJoinCode, useSiteId } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

export default function JoinCodeScreen() {
  const { t, lang } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const { site } = useCurrentSite();
  const codes = useJoinCodes(siteId);
  const create = useCreateJoinCode(siteId);
  const revoke = useRevokeJoinCode(siteId);
  // 가장 최근에 발급한 유효 코드
  const code = codes.data?.at(-1);
  const onError = (e: unknown) => toast(errorMessage(e), "error");

  return (
    <Screen scroll edges={["top", "bottom"]} contentStyle={{ paddingTop: 0 }}>
      <StackHeader title={t("code.title")} />
      <Text style={[font.body, { color: colors.inkSoft }]}>{t("code.desc")}</Text>
      {code ? (
        <>
          <Card style={styles.card}>
            <Text style={styles.site} numberOfLines={1}>
              {site?.name}
            </Text>
            <View style={styles.qr}>
              <QRCode value={code.qrPayload} size={200} color={colors.ink} backgroundColor="#FFFFFF" />
            </View>
            <Text style={styles.code} selectable>
              {code.code.slice(0, 4)} {code.code.slice(4)}
            </Text>
            <Text style={styles.meta}>
              {code.expiresAt ? t("code.expires", { time: formatDateTime(code.expiresAt, lang) }) : t("code.noExpiry")} ·{" "}
              {t("code.uses", { n: code.useCount })}
            </Text>
          </Card>
          <Button
            title={t("code.share")}
            icon="share-outline"
            onPress={() => void Share.share({ message: `${t("code.shareMessage", { site: site?.name ?? "", code: code.code })}\n${code.qrPayload}` })}
          />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title={t("code.new")} icon="refresh" variant="secondary" style={{ flex: 1 }} loading={create.isPending} onPress={() => create.mutate(undefined, { onError })} />
            <Button title={t("code.revoke")} icon="close-circle-outline" variant="danger" style={{ flex: 1 }} loading={revoke.isPending} onPress={() => revoke.mutate(code.id, { onError })} />
          </View>
        </>
      ) : (
        !codes.isPending && (
          <Card>
            <EmptyState
              icon="qr-code-outline"
              message={t("code.desc")}
              action={<Button title={t("code.new")} icon="add" fullWidth={false} loading={create.isPending} onPress={() => create.mutate(undefined, { onError })} />}
            />
          </Card>
        )
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", gap: spacing.lg, paddingVertical: spacing.xxl },
  site: { ...font.label, color: colors.muted },
  qr: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: colors.border },
  code: { fontSize: 34, lineHeight: 42, fontWeight: "800", letterSpacing: 4, color: colors.ink },
  meta: { ...font.caption, color: colors.muted, textAlign: "center" },
});
