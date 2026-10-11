import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, spacing } from "@/theme";

type Props = TextInputProps & { label?: string; hint?: string; error?: string | null };

export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, hint, error, secureTextEntry, style, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.field,
          focused && styles.focused,
          !!error && styles.errorBorder,
          props.multiline && { minHeight: 120, alignItems: "flex-start" },
        ]}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={secureTextEntry && hidden}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          style={[styles.input, props.multiline && styles.multiline, style]}
          {...props}
        />
        {secureTextEntry && (
          <Pressable hitSlop={10} onPress={() => setHidden((value) => !value)} accessibilityRole="button">
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + 2 },
  label: { ...font.label, color: colors.inkSoft },
  field: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  focused: { borderColor: colors.ink },
  errorBorder: { borderColor: colors.danger },
  input: { flex: 1, ...font.body, color: colors.ink, paddingVertical: spacing.md },
  multiline: { textAlignVertical: "top", minHeight: 110 },
  hint: { ...font.caption, color: colors.muted },
  error: { ...font.caption, color: colors.danger },
});
