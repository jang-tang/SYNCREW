import { Redirect, Stack } from "expo-router";
import { Splash } from "@/components/Splash";
import { useSessionStore } from "@/stores/session";
import { colors } from "@/theme";

/** 현장 선택·생성·참여: 로그인 상태 복원 후에만 표시 */
export default function SitesLayout() {
  const authStatus = useSessionStore((state) => state.authStatus);
  const hydrated = useSessionStore((state) => state.hydrated);
  if (!hydrated || authStatus === "loading") return <Splash />;
  if (authStatus === "signedOut") return <Redirect href="/welcome" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="scan" options={{ presentation: "fullScreenModal" }} />
    </Stack>
  );
}
