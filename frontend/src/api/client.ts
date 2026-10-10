import type { ApiErrorBody, ErrorCode } from "@shared/api";
import { API_BASE_URL } from "@/config";

/** 서버 오류 응답 또는 네트워크 오류 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK_ERROR" | "TIMEOUT",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; acceptStatuses?: number[] } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, acceptStatuses = [], ...requestInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestInit,
      headers: { Accept: "application/json", ...requestInit.headers },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError("TIMEOUT", "서버 응답 시간이 초과되었습니다.");
    throw new ApiError("NETWORK_ERROR", error instanceof Error ? error.message : "네트워크 오류");
  } finally {
    clearTimeout(timer);
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok || acceptStatuses.includes(response.status)) {
    return body as T;
  }
  const errorBody = body as Partial<ApiErrorBody> | undefined;
  throw new ApiError(
    errorBody?.error?.code ?? "INTERNAL_ERROR",
    errorBody?.error?.message ?? `HTTP ${response.status}`,
    response.status,
  );
}
