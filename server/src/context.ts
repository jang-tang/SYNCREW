import type { TokenVerifier } from "./auth/verifier";
import type { Env } from "./config/env";
import type { AudioPreprocessor } from "./engine/audio/audioPreprocessor";
import type { BudgetGuard } from "./engine/budget/budgetGuard";
import type { DomainProcessor } from "./engine/domain/domainProcessor";
import type { DomainEvents } from "./events/domainEvents";
import type { Logger } from "./lib/logger";
import type { PrismaClient } from "./lib/prisma";
import type { SttProvider } from "./engine/stt/sttProvider";
import type { Translator } from "./engine/translation/translator";
import type { AudioUrlSigner } from "./messaging/audioUrls";
import type { MessagePipeline } from "./messaging/pipeline";
import type { FileStorage } from "./messaging/storage";
import type { DeviceRegistry, PresenceRegistry } from "./realtime/presence";
import type { LiveSessionService } from "./sessions/liveSessions";
import type { StreamEngine } from "./streaming/engine";
import type { StreamHub } from "./streaming/streamHub";

export type Limits = {
  /** 가입 코드 입력: 사용자당 1분 횟수 */
  joinPerMinute: number;
  /** 메시지 전송: 사용자당 1분 횟수 */
  messagesPerMinute: number;
};

/** 서버 전역 의존성. 테스트에서는 일부를 가짜로 바꿔 넣는다. */
export type AppContext = {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  budget: BudgetGuard;
  domain: DomainProcessor;
  audioPreprocessor: AudioPreprocessor;
  verifier: TokenVerifier;
  /** 실시간 알림. 서버가 Socket.IO를 붙이면 그 구현으로 교체된다 (그 전에는 noop). */
  events: DomainEvents;
  /** 사용자 접속 상태 (실시간 연결 수 기준) */
  presence: PresenceRegistry;
  /** 사용자별 오디오 장치 상태 (헤드셋·마이크 권한) */
  devices: DeviceRegistry;
  /** 실시간 통역 세션 (1:1 통화, 일괄 지시) */
  sessions: LiveSessionService;
  limits: Limits;
  /** 음성 인식. OpenAI 키가 없으면 null (음성 메시지 503) */
  stt: SttProvider | null;
  /** 번역. OpenAI 키가 없으면 null (다른 언어 대상 메시지 503) */
  translator: Translator | null;
  /** 통역 파이프라인 (메시지 처리 작업 큐) */
  pipeline: MessagePipeline;
  storage: FileStorage;
  audioUrls: AudioUrlSigner;
  /** 스트리밍 통역 엔진 (1:1 통화). OpenAI 키가 없으면 null, ENGINE=fake 면 가짜 */
  streamEngine: StreamEngine | null;
  /** 스트리밍 통역 허브. 서버가 Socket.IO 를 붙일 때 만든다 (그 전에는 null) */
  streams: StreamHub | null;
};
