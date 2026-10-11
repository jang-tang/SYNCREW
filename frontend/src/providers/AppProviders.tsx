import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { services } from "@/services";
import { useSessionStore } from "@/stores/session";
import { RealtimeBridge } from "./RealtimeBridge";

/** 인증 세션을 복원하고 변화에 따라 상태를 맞춘다. */
function AuthBootstrap() {
  const hydrate = useSessionStore((state) => state.hydrate);
  const setAuth = useSessionStore((state) => state.setAuth);

  useEffect(() => {
    let active = true;
    void hydrate().then(async () => {
      const session = await services.auth.getSession().catch(() => null);
      if (active) setAuth(session?.user ?? null);
    });
    const unsubscribe = services.auth.onChange((session) => setAuth(session?.user ?? null));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [hydrate, setAuth]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
          mutations: { retry: 0 },
        },
      }),
  );
  const signedIn = useSessionStore((state) => state.authStatus === "signedIn");

  // 로그아웃하면 이전 사용자의 캐시를 비운다.
  useEffect(() => {
    if (!signedIn) client.clear();
  }, [signedIn, client]);

  return (
    <QueryClientProvider client={client}>
      <AuthBootstrap />
      {signedIn && <RealtimeBridge />}
      {children}
    </QueryClientProvider>
  );
}
