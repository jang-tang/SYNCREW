/** 서버 주소. .env 의 EXPO_PUBLIC_API_BASE_URL (기본: Android 에뮬레이터에서 본 이 컴퓨터) */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:4000").replace(/\/+$/, "");
