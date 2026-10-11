import { create } from "zustand";
import type { Lang } from "@shared/languages";
import { isLang } from "@shared/languages";
import { secureStorage } from "@/lib/storage";

export type AuthUser = { id: string; email: string };
export type ConnectionState = "idle" | "connecting" | "connected" | "offline";

type SessionState = {
  authStatus: "loading" | "signedOut" | "signedIn";
  user: AuthUser | null;
  /** 화면 언어. 로그인 후에는 프로필 언어를 따른다. */
  uiLang: Lang;
  /** 현재 선택한 현장 */
  siteId: string | null;
  connection: ConnectionState;
  hydrated: boolean;

  setAuth: (user: AuthUser | null) => void;
  setUiLang: (lang: Lang) => void;
  setSiteId: (siteId: string | null) => void;
  setConnection: (state: ConnectionState) => void;
  hydrate: () => Promise<void>;
};

const KEYS = { uiLang: "syncrew.uiLang", siteId: "syncrew.siteId" };

/** 기기 언어가 지원 언어면 그 언어로 시작한다. */
function deviceLang(): Lang {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  return isLang(locale) ? locale : "ko";
}

export const useSessionStore = create<SessionState>((set) => ({
  authStatus: "loading",
  user: null,
  uiLang: deviceLang(),
  siteId: null,
  connection: "idle",
  hydrated: false,

  setAuth: (user) => set({ user, authStatus: user ? "signedIn" : "signedOut" }),
  setUiLang: (uiLang) => {
    set({ uiLang });
    void secureStorage.setItem(KEYS.uiLang, uiLang);
  },
  setSiteId: (siteId) => {
    set({ siteId });
    void (siteId ? secureStorage.setItem(KEYS.siteId, siteId) : secureStorage.removeItem(KEYS.siteId));
  },
  setConnection: (connection) => set({ connection }),
  hydrate: async () => {
    const [uiLang, siteId] = await Promise.all([
      secureStorage.getItem(KEYS.uiLang).catch(() => null),
      secureStorage.getItem(KEYS.siteId).catch(() => null),
    ]);
    set((state) => ({ uiLang: isLang(uiLang) ? uiLang : state.uiLang, siteId, hydrated: true }));
  },
}));
