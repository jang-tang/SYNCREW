import { isAllowedReleaseApiUrl } from "./releaseApiUrl";

/** 서버 주소. .env 의 EXPO_PUBLIC_API_BASE_URL (기본: Android 에뮬레이터에서 본 이 컴퓨터) */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:4000").replace(/\/+$/, "");

/**
 * mock: 서버 없이 앱 안의 데모 데이터로 동작 (서버 Phase 2–5 완료 전 기본값)
 * live: Supabase 인증 + SYNCREW 서버 API·실시간 연결
 */
export const API_MODE: "mock" | "live" = process.env.EXPO_PUBLIC_API_MODE === "live" ? "live" : "mock";

// 릴리스 빌드(웹 export 포함)의 live 모드는 토큰·음성을 평문으로 보내지 않도록 https 서버 주소만 받는다.
// 잘못 빌드했으면 토큰을 보내기 전, 앱 시작 단계에서 멈춘다. 개발 빌드는 그대로 http 허용 (에뮬레이터 10.0.2.2, 같은 Wi-Fi 의 PC IP)
if (API_MODE === "live" && !__DEV__ && !isAllowedReleaseApiUrl(API_BASE_URL)) {
  throw new Error(
    `EXPO_PUBLIC_API_BASE_URL 은 릴리스 빌드에서 https 주소여야 합니다 (http 는 localhost·127.0.0.1·[::1] 만). 받은 값: ${API_BASE_URL}`,
  );
}

/** 1:1 통화 스트리밍 통역 (기본 켜짐). off 면 항상 발화 단위 방식 — 서버 STREAMING=off 와 같은 효과 */
export const STREAMING_ENABLED = process.env.EXPO_PUBLIC_STREAMING !== "off";

/** iOS 실기기 시험용 이중 오디오 후보 (예: "inPlace,connect48", docs/streaming-plan.md 5-7절). 개발 빌드에서만 쓴다 */
export const DUPLEX_EXPERIMENTS = process.env.EXPO_PUBLIC_DUPLEX_EXPERIMENTS ?? "";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** 비밀번호 재설정 메일 링크가 돌아올 앱 주소 */
export const PASSWORD_RESET_REDIRECT = "syncrew://reset-password";
