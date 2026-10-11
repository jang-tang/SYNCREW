import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, font, radius, spacing, touchTarget } from "@/theme";

type Variant = "primary" | "dark" | "secondary" | "ghost" | "danger" | "onDark";
type Size = "lg" | "md" | "sm";

const VARIANTS: Record<Variant, { bg: string; pressed: string; fg: string; border?: string }> = {
  primary: { bg: colors.brand, pressed: colors.brandPressed, fg: colors.onBrand },
  dark: { bg: colors.ink, pressed: colors.inkPressed, fg: colors.onInk },
  secondary: { bg: colors.surface, pressed: colors.surfaceAlt, fg: colors.ink, border: colors.border },
  ghost: { bg: "transparent", pressed: colors.surfaceAlt, fg: colors.ink },
  danger: { bg: colors.dangerSoft, pressed: "#F9DADA", fg: colors.danger },
  onDark: { bg: "rgba(255,255,255,0.08)", pressed: "rgba(255,255,255,0.16)", fg: "#FFFFFF", border: "rgba(255,255,255,0.24)" },
};

const HEIGHT: Record<Size, number> = { lg: touchTarget, md: 48, sm: 36 };

export type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: ComponentProps<typeof Ionicons>["name"];
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  right?: ReactNode;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  loading,
  disabled,
  fullWidth = true,
  style,
  right,
}: ButtonProps) {
  const palette = VARIANTS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: size === "sm" ? spacing.md : spacing.xl,
          borderRadius: size === "sm" ? radius.sm : radius.md,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderWidth: palette.border ? 1 : 0,
          borderColor: palette.border,
          opacity: disabled ? 0.45 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={size === "sm" ? 16 : 20} color={palette.fg} />}
          <Text style={[size === "sm" ? font.label : font.bodyStrong, { color: palette.fg }]} numberOfLines={1}>
            {title}
          </Text>
          {right}
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  tone = "default",
  size = 44,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  onPress?: () => void;
  label: string;
  tone?: "default" | "brand" | "plain";
  size?: number;
}) {
  const bg = tone === "brand" ? colors.brandSoft : tone === "plain" ? "transparent" : colors.surface;
  const fg = tone === "brand" ? colors.brand : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.icon,
        { width: size, height: size, backgroundColor: pressed ? colors.surfaceAlt : bg },
        tone === "default" && styles.iconBorder,
      ]}
    >
      <Ionicons name={icon} size={22} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  icon: { borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  iconBorder: { borderWidth: 1, borderColor: colors.border },
});
