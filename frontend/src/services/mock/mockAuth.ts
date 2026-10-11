import { secureStorage } from "@/lib/storage";
import type { AuthService, AuthSession } from "../types";
import { ME, mockDb } from "./mockDb";

const KEY = "syncrew.mockSession";

/** 데모 모드: 어떤 이메일·비밀번호(8자 이상)든 로그인된다. 세션은 기기에 저장. */
export function createMockAuth(): AuthService {
  let session: AuthSession | null = null;
  const listeners = new Set<(session: AuthSession | null) => void>();
  const set = (next: AuthSession | null) => {
    session = next;
    void (next ? secureStorage.setItem(KEY, next.user.email) : secureStorage.removeItem(KEY));
    listeners.forEach((listener) => listener(next));
  };
  const make = (email: string): AuthSession => {
    mockDb.sessionEmail = email;
    return { user: { id: ME, email }, accessToken: "demo" };
  };

  return {
    async getSession() {
      if (session) return session;
      const email = await secureStorage.getItem(KEY).catch(() => null);
      session = email ? make(email) : null;
      return session;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email) {
      set(make(email));
    },
    async signUp(email) {
      set(make(email));
      return { needsConfirmation: false };
    },
    async signOut() {
      await secureStorage.removeItem("syncrew.mockProfile");
      mockDb.profile = null;
      set(null);
    },
    async requestPasswordReset() {},
    async updatePassword() {},
    async handleAuthRedirect() {
      return false;
    },
  };
}
