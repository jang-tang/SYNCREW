// 현장 사용 기준: 큰 터치 영역, 높은 대비, 상태를 색으로 구분
export const colors = {
  brand: "#FF7A00",
  brandDark: "#D96500",
  background: "#F2F2F5",
  surface: "#FFFFFF",
  text: "#1B1B1F",
  textMuted: "#5F6170",
  border: "#E1E2E8",
  success: "#1E8E3E",
  warning: "#B26A00",
  danger: "#C62828",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

/** 주요 버튼 최소 높이 (dp) */
export const touchTarget = 56;

export const fontSize = { caption: 13, body: 16, title: 20, headline: 26 } as const;
