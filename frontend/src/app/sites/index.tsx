import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MySite } from "@shared/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Logo } from "@/components/ui/Logo";
import { Screen } from "@/components/ui/Screen";
import { useMe, useMySites } from "@/hooks/queries";
import { useT } from "@/i18n";
import { useSessionStore } from "@/stores/session";
import { colors, font, radius, spacing } from "@/theme";

function SiteCard({ site, current, onPress }: { site: MySite; current: boolean; onPress: () => void }) {
  const { t } = useT();
  const active = site.membershipStatus === "active";
  return (
    <Card onPress={active ? onPress : undefined} style={[current && styles.current, !active && styles.inactive]}>
      <View style={styles.row}>
        <View style={[styles.siteIcon, site.role === "manager" && { backgroundColor: colors.ink }]}>
          <Ionicons name="business" size={22} color={site.role === "manager" ? colors.brand : colors.ink} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={font.headline} numberOfLines={1}>
            {site.name}
          </Text>
          {site.address && (
            <Text style={styles.meta} numberOfLines={1}>
              {site.address}
            </Text>
          )}
        </View>
        {active && <Ionicons name="chevron-forward" size={20} color={colors.placeholder} />}
      </View>
      <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
        {active ? (
          <>
            <Badge label={t(`role.${site.role}`)} tone={site.role === "manager" ? "dark" : "neutral"} />
            <Badge label={t("common.people", { n: site.memberCount })} />
          </>
        ) : site.membershipStatus === "pending" ? (
          <>
            <Badge label={t("sites.pending")} tone="warning" dot />
            <Text style={[styles.meta, { flex: 1 }]} numberOfLines={2}>
              {t("sites.pendingDesc")}
            </Text>
          </>
        ) : (
          <Badge label={t(site.membershipStatus === "rejected" ? "sites.rejected" : "sites.removed")} tone="danger" />
        )}
      </View>
    </Card>
  );
}

export default function Sites() {
  const { t } = useT();
  const me = useMe();
  const sites = useMySites();
  const siteId = useSessionStore((state) => state.siteId);
  const setSiteId = useSessionStore((state) => state.setSiteId);

  const open = (site: MySite) => {
    setSiteId(site.id);
    router.replace("/site");
  };

  const ordered = [...(sites.data ?? [])].sort((a, b) => Number(b.membershipStatus === "active") - Number(a.membershipStatus === "active"));

  return (
    <Screen
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button title={t("sites.join")} icon="qr-code-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push("/sites/join")} />
          <Button title={t("sites.create")} icon="add" variant="dark" style={{ flex: 1 }} onPress={() => router.push("/sites/new")} />
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={sites.isRefetching} onRefresh={() => void sites.refetch()} tintColor={colors.brand} />}
      >
        <View style={styles.header}>
          <Logo height={22} />
          {me.data && <Text style={styles.greeting}>{t("sites.greeting", { name: me.data.displayName })}</Text>}
          <Text style={font.title}>{t("sites.title")}</Text>
        </View>
        {ordered.length === 0 && !sites.isPending ? (
          <EmptyState icon="business-outline" message={t("sites.empty")} />
        ) : (
          ordered.map((site) => <SiteCard key={site.id} site={site} current={site.id === siteId} onPress={() => open(site)} />)
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.md },
  header: { gap: spacing.sm, marginBottom: spacing.md },
  greeting: { ...font.body, color: colors.muted, marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  siteIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft },
  meta: { ...font.caption, color: colors.muted },
  current: { borderColor: colors.brand, borderWidth: 1.5 },
  inactive: { backgroundColor: colors.surfaceAlt, borderStyle: "dashed" },
});
