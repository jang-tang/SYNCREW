import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import request from "supertest";
import { inject } from "vitest";
import { createApp } from "../../src/app";
import { createJwtVerifier } from "../../src/auth/verifier";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createContext, type ContextOverrides } from "../../src/bootstrap";
import { loadEnv } from "../../src/config/env";
import type { AppContext, Limits } from "../../src/context";
import type { DomainEvents } from "../../src/events/domainEvents";
import { createLogger } from "../../src/lib/logger";

export const ISSUER = "https://test-project.supabase.co/auth/v1";

/** Supabase와 같은 형식(ES256, iss, aud=authenticated)의 토큰을 만드는 테스트용 발급자 */
export async function createTokenIssuer() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
  const verifier = createJwtVerifier({ keys: createLocalJWKSet({ keys: [jwk] }), issuer: ISSUER });
  const sign = (claims: { sub: string; email?: string }, options: { issuer?: string; expiresIn?: string | number } = {}) =>
    new SignJWT({ email: claims.email ?? `${claims.sub.slice(0, 8)}@test.dev`, role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(claims.sub)
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience("authenticated")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "1h")
      .sign(privateKey);
  return { verifier, sign, privateKey };
}

/** 도메인 이벤트 기록기 (실시간 알림이 호출됐는지 확인용) */
export function recordEvents() {
  const log: { type: string; payload: Record<string, unknown> }[] = [];
  const events: DomainEvents = {
    membershipChanged: (payload) => log.push({ type: "membershipChanged", payload }),
    joinRequested: (payload) => log.push({ type: "joinRequested", payload }),
    messageNew: (payload) => log.push({ type: "messageNew", payload }),
    messageStatus: (payload) => log.push({ type: "messageStatus", payload }),
    instructionRecipient: (payload) => log.push({ type: "instructionRecipient", payload }),
    sessionInvite: (payload) => log.push({ type: "sessionInvite", payload }),
    sessionUpdated: (payload) => log.push({ type: "sessionUpdated", payload }),
    deviceChanged: (payload) => log.push({ type: "deviceChanged", payload }),
  };
  return { events, log };
}

export type TestAppOptions = Omit<ContextOverrides, "limits" | "verifier" | "events"> & { limits?: Partial<Limits> };

export async function createTestApp(options: TestAppOptions = {}) {
  const { limits, ...engine } = options;
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: inject("databaseUrl"),
    LOG_LEVEL: "silent",
    // 테스트마다 임시 저장소 (업로드·번역 음성)
    STORAGE_DIR: mkdtempSync(path.join(tmpdir(), "syncrew-test-storage-")),
  });
  const issuer = await createTokenIssuer();
  const recorder = recordEvents();
  const context: AppContext = await createContext(env, createLogger("silent"), {
    verifier: issuer.verifier,
    events: recorder.events,
    limits: { joinPerMinute: 100, messagesPerMinute: 1000, ...limits },
    // 기본은 엔진 없음(=OpenAI 키 없음과 같음). 통역 테스트는 Fake 엔진을 넣는다.
    stt: null,
    translator: null,
    ...engine,
  });
  const app = createApp(context);

  /** 테스트 사용자: 고유 id로 만들어 다른 테스트 파일과 데이터가 섞이지 않는다 */
  const user = async (name = "사용자", lang = "ko") => {
    const id = randomUUID();
    const token = await issuer.sign({ sub: id });
    const as = (method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
      request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
    const withProfile = async () => {
      const res = await as("put", "/me").send({ displayName: name, preferredLang: lang });
      if (res.status !== 200) throw new Error(`profile setup failed: ${res.status} ${JSON.stringify(res.body)}`);
      return api;
    };
    const api = { id, token, as, withProfile };
    return api;
  };

  return {
    app,
    context,
    issuer,
    events: recorder.log,
    user,
    close: async () => {
      context.sessions.dispose();
      await context.pipeline.idle();
      await context.prisma.$disconnect();
    },
  };
}

// ─── 실시간 (Socket.IO) ─────────────────────────────

import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { attachRealtime } from "../../src/realtime/gateway";
import { REALTIME_NAMESPACE, type ClientToServerEvents, type ServerToClientEvents } from "../../src/shared/realtime";

export type RtClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

/** REST + Socket.IO 를 실제 포트(임의)로 띄운다 */
export async function createRealtimeTestApp(options: TestAppOptions = {}) {
  const base = await createTestApp(options);
  const server: HttpServer = createServer(base.app);
  const gateway = attachRealtime(server, base.context);
  base.context.events = gateway.events;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${REALTIME_NAMESPACE}`;
  const clients: RtClient[] = [];

  const client = (token: string | undefined): RtClient => {
    const socket: RtClient = connect(url, {
      transports: ["websocket"],
      auth: token === undefined ? {} : { token },
      reconnection: false,
      forceNew: true,
    });
    clients.push(socket);
    return socket;
  };

  /** 연결이 성공할 때까지 기다린다 */
  const connected = async (token: string) => {
    const socket = client(token);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  };

  return {
    ...base,
    gateway,
    client,
    connected,
    close: async () => {
      clients.forEach((socket) => socket.disconnect());
      await gateway.close();
      await base.close();
    },
  };
}

/** 이벤트 하나를 기다린다 (시간 초과 시 실패) */
export function nextEvent<E extends keyof ServerToClientEvents>(socket: RtClient, event: E, timeoutMs = 3000) {
  return new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`이벤트 ${event} 를 받지 못함`)), timeoutMs);
    socket.once(event as never, ((payload: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

/** 일정 시간 동안 이벤트가 오지 않아야 함을 확인한다 */
export function noEvent(socket: RtClient, event: keyof ServerToClientEvents, waitMs = 400) {
  return new Promise<void>((resolve, reject) => {
    const handler = () => reject(new Error(`받으면 안 되는 이벤트 ${event} 를 받음`));
    socket.on(event as never, handler as never);
    setTimeout(() => {
      socket.off(event as never, handler as never);
      resolve();
    }, waitMs);
  });
}
