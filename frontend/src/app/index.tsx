import { Redirect } from "expo-router";
import { useEffect } from "react";
import { Splash } from "@/components/Splash";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useMe, useMySites } from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { useSessionStore } from "@/stores/session";

/** 시작 분기: 로그인 → 프로필 → 현장 선택 → 현장 화면 */
export default function Gate() {
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const authStatus = useSessionStore((state) => state.authStatus);
  const hydrated = useSessionStore((state) => state.hydrated);
  const siteId = useSessionStore((state) => state.siteId);
  const setUiLang = useSessionStore((state) => state.setUiLang);
  const signedIn = authStatus === "signedIn";

  const me = useMe(signedIn);
  const sites = useMySites();

  useEffect(() => {
    if (me.data) setUiLang(me.data.preferredLang);
  }, [me.data, setUiLang]);

  if (!hydrated || authStatus === "loading") return <Splash />;
  if (!signedIn) return <Redirect href="/welcome" />;

  if (me.isError || sites.isError) {
    return (
      <Screen>
        <EmptyState
          icon="cloud-offline-outline"
          message={errorMessage(me.error ?? sites.error)}
          action={<Button title={t("common.retry")} fullWidth={false} onPress={() => void Promise.all([me.refetch(), sites.refetch()])} />}
        />
      </Screen>
    );
  }
  if (me.isPending) return <Splash />;
  if (me.data === null) return <Redirect href="/onboarding" />;
  if (sites.isPending) return <Splash />;

  const current = sites.data.find((site) => site.id === siteId && site.membershipStatus === "active");
  return <Redirect href={current ? "/site" : "/sites"} />;
}
