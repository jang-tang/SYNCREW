import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors, font, spacing } from "@/theme";

/** 화면 공통 틀: 안전 영역 + 배경 + (선택) 스크롤 + 키보드 회피 */
export function Screen({
  children,
  scroll = false,
  edges = ["top", "bottom"],
  background = colors.background,
  contentStyle,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  background?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** 하단 고정 영역 (주요 버튼) */
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
        )}
        {footer && <View style={styles.footer}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** 하위 화면 상단: 뒤로 + 제목 + 오른쪽 동작 */
export function StackHeader({
  title,
  subtitle,
  right,
  onBack = () => (router.canGoBack() ? router.back() : router.replace("/")),
  backIcon = "chevron-back",
}: {
  title?: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  onBack?: (() => void) | null;
  backIcon?: "chevron-back" | "close";
}) {
  return (
    <View style={styles.stackHeader}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="back" hitSlop={12} onPress={onBack} style={styles.back}>
          <Ionicons name={backIcon} size={26} color={colors.ink} />
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}
      <View style={{ flex: 1 }}>
        {title && (
          <Text style={font.headline} numberOfLines={1}>
            {title}
          </Text>
        )}
        {typeof subtitle === "string" ? <Text style={styles.subtitle}>{subtitle}</Text> : subtitle}
      </View>
      {right}
    </View>
  );
}

/** 탭 화면 상단: 큰 제목 */
export function LargeHeader({ eyebrow, title, right }: { eyebrow?: ReactNode; title: string; right?: ReactNode }) {
  return (
    <View style={styles.large}>
      {/* 현장 알약(eyebrow)과 큰 제목 사이: 4px 는 붙어 보여 16px 로 (2026-10-19 발표 화면 검토) */}
      <View style={{ flex: 1, gap: spacing.lg }}>
        {eyebrow}
        <Text style={font.title} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  stackHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  subtitle: { ...font.caption, color: colors.muted, marginTop: 2 },
  large: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
});
