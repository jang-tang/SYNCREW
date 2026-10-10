import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { ServerStatusBar } from "@/components/ServerStatusBar";
import { ServerHealthProvider } from "@/providers/ServerHealthProvider";
import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <ServerHealthProvider>
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.surface }}>
        <ServerStatusBar />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaView>
    </ServerHealthProvider>
  );
}
