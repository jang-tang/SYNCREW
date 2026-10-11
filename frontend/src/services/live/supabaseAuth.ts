import { createClient, type Session } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { PASSWORD_RESET_REDIRECT, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/config";
import { secureStorage } from "@/lib/storage";
import type { AuthService, AuthSession } from "../types";

const toSession = (session: Session | null): AuthSession | null =>
  session ? { user: { id: session.user.id, email: session.user.email ?? "" }, accessToken: session.access_token } : null;

export function createSupabaseAuth(): AuthService {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 없습니다 (.env 확인).");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });

  // 앱이 화면에 있을 때만 토큰 자동 갱신 (Supabase 권장)
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });

  const check = (result: { error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
  };

  return {
    async getSession() {
      const { data } = await supabase.auth.getSession();
      return toSession(data.session);
    },
    onChange(listener) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => listener(toSession(session)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      check(await supabase.auth.signInWithPassword({ email, password }));
    },
    async signUp(email, password) {
      const result = await supabase.auth.signUp({ email, password });
      check(result);
      return { needsConfirmation: !result.data.session };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    async requestPasswordReset(email) {
      check(await supabase.auth.resetPasswordForEmail(email, { redirectTo: PASSWORD_RESET_REDIRECT }));
    },
    async updatePassword(password) {
      check(await supabase.auth.updateUser({ password }));
    },
    async handleAuthRedirect(url) {
      // PKCE: ?code=... / 암시적 흐름: #access_token=...&refresh_token=...
      const parsed = new URL(url.replace("#", "?"));
      const code = parsed.searchParams.get("code");
      if (code) {
        check(await supabase.auth.exchangeCodeForSession(code));
        return true;
      }
      const accessToken = parsed.searchParams.get("access_token");
      const refreshToken = parsed.searchParams.get("refresh_token");
      if (accessToken && refreshToken) {
        check(await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
        return true;
      }
      return false;
    },
  };
}
