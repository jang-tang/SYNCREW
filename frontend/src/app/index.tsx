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

/**
 * 개발 빌드 전용: 앱을 열면 바로 이 경로로 간다 (예: EXPO_PUBLIC_DEV_START_ROUTE="/audio-check?auto=1" npx expo start).
 * 화면을 누를 수 없는 iOS 시뮬레이터에서 오디오 점검 화면을 자동으로 열 때 쓴다. 보통은 비워 둔다.
 */
const DEV_START_ROUTE = __DEV__ ? process.env.EXPO_PUBLIC_DEV_START_ROUTE : undefined;

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

  if (DEV_START_ROUTE) return <Redirect href={DEV_START_ROUTE as never} />;
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
