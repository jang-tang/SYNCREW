import type { StringKey } from "@/i18n";
import { useT } from "@/i18n";
import { STRINGS } from "@/i18n/strings";
import { ApiError } from "@/services";

/** 오류를 현재 화면 언어의 안내 문구로 바꾼다. */
export function useErrorMessage() {
  const { t } = useT();
  return (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.code === "NETWORK_ERROR" || error.code === "TIMEOUT") return t("error.network");
      const key = `error.${error.code}`;
      if (key in STRINGS) return t(key as StringKey);
    }
    return t("error.generic");
  };
}
