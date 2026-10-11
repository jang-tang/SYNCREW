import { Platform, type ViewStyle } from "react-native";

// SyncField 로고 기반 디자인 토큰: 차콜(Sync) + 주황(Field)
export const colors = {
  brand: "#F8801A",
  brandPressed: "#E06D0C",
  brandSoft: "#FFF1E5",
  brandBorder: "#FFD9B8",

  ink: "#30323A",
  inkPressed: "#1F2026",
  inkSoft: "#5B5E6B",
  muted: "#8D909B",
  placeholder: "#A9ABB4",

  background: "#F6F6F8",
  surface: "#FFFFFF",
  surfaceAlt: "#F1F1F4",
  border: "#E8E8EE",
  divider: "#F0F0F3",

  success: "#159A4B",
  successSoft: "#E7F6EE",
  warning: "#C77700",
  warningSoft: "#FFF3DF",
  danger: "#D93636",
  dangerSoft: "#FDECEC",
  info: "#2F6FEB",
  infoSoft: "#E9F0FE",

  onBrand: "#FFFFFF",
  onInk: "#FFFFFF",
} as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

/** 주요 버튼 최소 높이 (현장 장갑 착용 고려) */
export const touchTarget = 56;

export const font = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: "800" as const, letterSpacing: -0.6 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: "800" as const, letterSpacing: -0.4 },
  headline: { fontSize: 18, lineHeight: 26, fontWeight: "700" as const, letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: "600" as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
  message: { fontSize: 19, lineHeight: 28, fontWeight: "600" as const },
};

export const shadow: Record<"card" | "floating", ViewStyle> = {
  card: Platform.select<ViewStyle>({
    android: { elevation: 1 },
    default: { shadowColor: "#1F2026", shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  })!,
  floating: Platform.select<ViewStyle>({
    android: { elevation: 6 },
    default: { shadowColor: "#1F2026", shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  })!,
};

/** 사용자 id로 아바타 색을 고른다 (브랜드 톤 안에서) */
const AVATAR_COLORS = ["#F8801A", "#30323A", "#2F6FEB", "#159A4B", "#8B5CF6", "#D9467A", "#0E9AA7"];
export function avatarColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}
