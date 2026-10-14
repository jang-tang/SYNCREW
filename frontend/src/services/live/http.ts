import { Platform } from "react-native";
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

type RequestOptions = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit;
  token?: string | null;
  timeoutMs?: number;
  acceptStatuses?: number[];
};

type MinimalResponse = Pick<Response, "status" | "ok" | "json">;

/**
 * 휴대폰(iOS·Android)에서 파일을 붙인 multipart 요청은 XMLHttpRequest 로 보낸다.
 * Expo SDK 57 의 기본 fetch(expo/fetch)는 React Native 파일 형식({uri,name,type})을 지원하지 않아
 * "Unsupported FormDataPart implementation" 으로 실패한다 (2026-10-14 Galaxy S22 실기기에서 발견).
 * React Native 의 XMLHttpRequest 는 이 형식을 그대로 업로드한다.
 */
function xhrSend(url: string, init: { method?: string; headers: Record<string, string>; body: FormData; signal: AbortSignal }) {
  return new Promise<MinimalResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "POST", url);
    for (const [key, value] of Object.entries(init.headers)) xhr.setRequestHeader(key, value);
    xhr.onload = () => {
      const text = xhr.responseText;
      resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        json: async () => JSON.parse(text),
      });
    };
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.onabort = () => reject(new Error("Aborted"));
    init.signal.addEventListener("abort", () => xhr.abort());
    xhr.send(init.body);
  });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, token, timeoutMs = 15_000, acceptStatuses = [], headers, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: MinimalResponse;
  const allHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers as Record<string, string> | undefined),
  };
  try {
    response =
      Platform.OS !== "web" && init.body instanceof FormData
        ? await xhrSend(`${API_BASE_URL}${path}`, { method: init.method, headers: allHeaders, body: init.body, signal: controller.signal })
        : await fetch(`${API_BASE_URL}${path}`, {
            ...init,
            body: json !== undefined ? JSON.stringify(json) : init.body,
            headers: allHeaders,
            signal: controller.signal,
          });
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError("TIMEOUT", "서버 응답 시간이 초과되었습니다.");
    throw new ApiError("NETWORK_ERROR", error instanceof Error ? error.message : "네트워크 오류");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok || acceptStatuses.includes(response.status)) return body as T;

  const errorBody = body as Partial<ApiErrorBody> | undefined;
  throw new ApiError(
    errorBody?.error?.code ?? "INTERNAL_ERROR",
    errorBody?.error?.message ?? `HTTP ${response.status}`,
    response.status,
  );
}
