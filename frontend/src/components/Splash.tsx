import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Logo } from "@/components/ui/Logo";
import { colors, spacing } from "@/theme";

export function Splash() {
  return (
    <View style={styles.root}>
      <Logo height={40} />
      <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
