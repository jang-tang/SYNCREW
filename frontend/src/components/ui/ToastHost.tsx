import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToastStore } from "@/stores/toast";
import { colors, font, radius, shadow, spacing } from "@/theme";

const ICON = { default: "information-circle", success: "checkmark-circle", error: "alert-circle" } as const;
const ICON_COLOR = { default: "#FFFFFF", success: "#5BD38C", error: "#FF8A8A" } as const;

export function ToastHost() {
  const toast = useToastStore((state) => state.toast);
  const hide = useToastStore((state) => state.hide);
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => hide());
    }, 2600);
    return () => clearTimeout(timer);
  }, [toast, hide, opacity]);

  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { top: insets.top + spacing.sm, opacity, transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}
    >
      <Ionicons name={ICON[toast.tone]} size={20} color={ICON_COLOR[toast.tone]} />
      <Text style={styles.text}>{toast.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    ...shadow.floating,
  },
  text: { ...font.label, color: "#FFFFFF", flex: 1 },
});
