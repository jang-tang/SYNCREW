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

/**
 * 사용자 id로 아바타 색을 고른다: 브랜드 주황 한 가지의 밝기만 다르게 (2026-10-26 사용자 요청 — 여러 색은 "AI 티" 가 난다).
 * 밝은 단계는 흰 글자가 안 보이므로 글자색을 함께 돌려준다.
 */
const AVATAR_TONES: { background: string; text: string }[] = [
  { background: "#C25A08", text: "#FFFFFF" },
  { background: "#E06D0C", text: "#FFFFFF" },
  { background: "#F8801A", text: "#FFFFFF" },
  { background: "#FA9A47", text: "#FFFFFF" },
  { background: "#FCB679", text: "#7A3A05" },
  { background: "#FED3AC", text: "#7A3A05" },
];
export function avatarTone(id: string): { background: string; text: string } {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}
