import { Redirect, Stack } from "expo-router";
import { Splash } from "@/components/Splash";
import { useCurrentSite } from "@/hooks/queries";
import { useSessionStore } from "@/stores/session";
import { colors } from "@/theme";

/** 현장 화면 공통: 선택된 활성 현장이 없으면 현장 선택으로 */
export default function SiteLayout() {
  const authStatus = useSessionStore((state) => state.authStatus);
  const hydrated = useSessionStore((state) => state.hydrated);
  const siteId = useSessionStore((state) => state.siteId);
  const { site, isPending } = useCurrentSite();

  // 앱을 다시 열거나 딥링크로 바로 들어온 경우: 로그인 상태 복원이 끝날 때까지 기다린다.
  if (!hydrated || authStatus === "loading") return <Splash />;
  if (authStatus === "signedOut") return <Redirect href="/welcome" />;
  if (!siteId) return <Redirect href="/sites" />;
  if (isPending) return <Splash />;
  if (!site || site.membershipStatus !== "active") return <Redirect href="/sites" />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/new" options={{ presentation: "modal" }} />
      <Stack.Screen name="instruction/new" options={{ presentation: "modal" }} />
    </Stack>
  );
}
