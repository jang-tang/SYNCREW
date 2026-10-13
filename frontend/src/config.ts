/** 서버 주소. .env 의 EXPO_PUBLIC_API_BASE_URL (기본: Android 에뮬레이터에서 본 이 컴퓨터) */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:4000").replace(/\/+$/, "");

/**
 * mock: 서버 없이 앱 안의 데모 데이터로 동작 (서버 Phase 2–5 완료 전 기본값)
 * live: Supabase 인증 + SYNCREW 서버 API·실시간 연결
 */
export const API_MODE: "mock" | "live" = process.env.EXPO_PUBLIC_API_MODE === "live" ? "live" : "mock";

/** 1:1 통화 스트리밍 통역 (기본 켜짐). off 면 항상 발화 단위 방식 — 서버 STREAMING=off 와 같은 효과 */
export const STREAMING_ENABLED = process.env.EXPO_PUBLIC_STREAMING !== "off";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** 비밀번호 재설정 메일 링크가 돌아올 앱 주소 */
export const PASSWORD_RESET_REDIRECT = "syncrew://reset-password";
