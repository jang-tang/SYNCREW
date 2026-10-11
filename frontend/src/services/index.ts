import { API_MODE } from "@/config";
import { createHttpApi } from "./live/httpApi";
import { createSocketRealtime } from "./live/socketRealtime";
import { createSupabaseAuth } from "./live/supabaseAuth";
import { createMockApi } from "./mock/mockApi";
import { createMockAuth } from "./mock/mockAuth";
import { createMockRealtime } from "./mock/mockRealtime";
import type { Services } from "./types";

function createServices(): Services {
  if (API_MODE === "live") {
    const auth = createSupabaseAuth();
    return { mode: "live", auth, api: createHttpApi(auth), realtime: createSocketRealtime(auth) };
  }
  return { mode: "mock", auth: createMockAuth(), api: createMockApi(), realtime: createMockRealtime() };
}

/** 앱 전체에서 쓰는 서비스 (EXPO_PUBLIC_API_MODE 로 mock / live 선택) */
export const services = createServices();
export { ApiError } from "./live/http";
