import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastHost } from "@/components/ui/ToastHost";
import { AppProviders } from "@/providers/AppProviders";
import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="welcome" options={{ animation: "fade" }} />
          </Stack>
          <ToastHost />
        </View>
      </AppProviders>
    </SafeAreaProvider>
  );
}
