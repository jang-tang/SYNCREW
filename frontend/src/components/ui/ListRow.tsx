import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { colors, font, radius, spacing } from "@/theme";

/** 설정·목록 한 줄 */
export function ListRow({
  icon,
  leading,
  title,
  subtitle,
  value,
  onPress,
  onLongPress,
  right,
  danger,
  chevron = !!onPress,
}: {
  icon?: ComponentProps<typeof Ionicons>["name"];
  /** 아이콘 대신 앞에 둘 요소 (아바타 등) */
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  /** 길게 누르기 (멤버 화면: 누르면 연결, 길게 누르면 메뉴) */
  onLongPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
  chevron?: boolean;
}) {
  const content = (
    <>
      {leading}
      {icon && (
        <View style={[styles.icon, danger && { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.ink} />
        </View>
      )}
      {/* 오른쪽 칩이 많아도 이름이 사라지지 않게 최소 폭 (10-27 멤버 목록에서 관리자 이름이 통째로 사라짐) */}
      <View style={{ flex: 1, minWidth: 96 }}>
        <Text style={[font.bodyStrong, danger && { color: colors.danger }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {value && (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      )}
      {right}
      {chevron && <Ionicons name="chevron-forward" size={18} color={colors.placeholder} />}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}>
      {content}
    </Pressable>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: colors.brand, false: colors.border }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={colors.border}
      // react-native-web 전용 (켜짐 상태 손잡이 색)
      {...({ activeThumbColor: "#FFFFFF" } as object)}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  icon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt },
  subtitle: { ...font.caption, color: colors.muted, marginTop: 2 },
  value: { ...font.label, color: colors.muted, maxWidth: 160 },
});
