# 구현 계획 (MVP)

## 0. 진행 규칙

- Phase 단위로 구현하고, 각 Phase 종료 시 구현 내용, 변경 파일, 실행한 테스트와 결과, 미검증 항목, 알려진 문제를 보고한다.
- 아키텍처·기술 스택·DB 구조의 큰 변경은 이유와 대안을 먼저 설명하고 승인을 받는다.
- 기존 저장소는 수정하지 않는다. 데이터셋만 `server/data/legacy-workplace/`로 원본 복사한다.

## 1. Phase 요약

| Phase | 목표 | 선행 | 상태 |
|---|---|---|---|
| 1 | 프로젝트 기반 + 통역 엔진 골격 | — | 완료 `9371620` |
| 앱 | 프론트엔드 전체 화면 (데모 모드 + live 연동 계층) | 1 | 완료 `3fea4e7` |
| 2 | 인증·현장·멤버십 | 1 | 완료 `c637a6b` |
| 3 | 실시간 통신 (Socket.IO) | 2 | 완료 `92e3620` |
| 4 | 통역 파이프라인 + 1:1 대화 | 3 | **다음** |
| 5 | N:N 그룹 대화 + 1:N 일괄 지시 | 4 | 대기 |
| 6 | 안정화·실기기 검증 | 1–5 | 대기 |

## Phase 1. 기반 — 완료 (2026-10-10, 커밋 `9371620`)

- 구현 내용
  - `server/`: Express 5 + TS, zod 환경 변수 검증, pino 로깅(키·토큰 마스킹), 공통 오류 형식, `/health`
  - 로컬 DB: `embedded-postgres`(Docker 불필요, `npm run db:start`) + Prisma 7, 마이그레이션 2개(`openai_usage` 테이블과 CHECK 제약)
  - 통역 엔진(`server/src/engine`): 현장 특화 처리(감지·보정·컨텍스트), 데이터셋 어댑터 2종(기존 데이터, 정규화 JSON), 노이즈 필터 인터페이스와 안전 실행, STT·번역기 인터페이스, 비용 한도(BudgetGuard, $5)
  - 플러그인 연결 지점(`server/src/plugins`): 노이즈 필터, 데이터셋, 보존 정책(매일 실행 스케줄러)
  - OpenAI 키 입력 스크립트(`npm run setup:openai`, 입력 숨김, `.env` 권한 600)
  - 공유 계약(`server/src/shared`): 언어 코드 5개, 오류 코드, `/health` 응답 타입
  - `frontend/`: Expo SDK 57 + expo-router, 4개 탭(대화·지시·멤버·설정) 자리 화면, 상단 서버 연결 상태 바, 설정 탭의 서버 상태·지원 언어 표시, 5개 언어 UI 문구 구조
- 계획 대비 변경
  - 모노레포(apps/packages) 대신 `frontend/`·`server/` 2폴더 (사용자 요청). 공유 코드는 `server/src/shared`를 앱이 경로 별칭으로 참조
  - Docker 대신 `embedded-postgres` (이 PC에 Docker·Postgres 없음)
  - ESLint·Prettier, TanStack Query·Zustand는 실제로 필요한 Phase 2로 미룸
- 검증 결과
  - 서버: `tsc --noEmit` 통과, Vitest 6개 파일 42개 테스트 통과(실제 Postgres 통합 테스트 포함), 실제 서버 기동 후 `/health` 200 응답 확인
  - 앱: `tsc --noEmit` 통과, `expo-doctor` 21/21 통과, Android 번들 빌드(`expo export`) 성공 및 공유 코드 포함 확인
- 미검증
  - Android 에뮬레이터·실기기 실행 (이 PC에 Android SDK 미설치)
  - 앱 ↔ 서버 실제 통신 (위와 같은 이유)
  - OpenAI 호출 (Phase 4 범위, 키 없음)

## 프론트엔드 MVP — 완료 (2026-10-11, 커밋 `3fea4e7`)

사용자 요청으로 서버 Phase 2–5보다 앞서 앱 화면 전체를 완성했다. 서버가 준비될 때까지는 데모(mock) 모드로 동작하고,
서버가 완성되면 `EXPO_PUBLIC_API_MODE=live`로 바꿔 같은 화면을 실서버에 연결한다.

- 구현 내용
  - 디자인: SyncField 로고 색(주황·차콜) 기반 디자인 시스템, 5개 언어 UI (작업자는 자기 언어로 앱 사용)
  - 화면: 시작(언어 선택)·로그인·회원가입·비밀번호 재설정·프로필 / 현장 선택·만들기·코드 참여·QR 스캔 / 대화(그룹·1:1, 누르고 말하기, 다시 듣기) / 지시(관리자: 작성·진행률·작업자별 상태 / 구성원: 확인·완료) / 멤버(승인·언어 변경·제외) / 가입 코드·QR / 설정
  - 연동 계층: `services/live`(Supabase Auth, REST, Socket.IO — docs 명세 기준) + `services/mock`(데모), 공유 계약 `server/src/shared/api.ts`, `realtime.ts`
  - 실시간: 이벤트 → 화면 데이터 반영, 수신 확인 전송, 받은 통역 자동 재생, 재연결 시 전체 동기화
- 검증 결과
  - `tsc` 통과, `expo-doctor` 21/21, Android 번들 빌드 성공
  - 웹 빌드 + 헤드리스 Chrome 자동 시나리오 22개 통과(데모 모드, `frontend/e2e/flows.mjs` — `npm run bundle:web && npm run e2e`로 재실행): 회원가입→프로필→현장, 코드 참여→승인, 지시 전송→진행률 실시간 갱신→언어별 번역, 가입 승인, 구성원 확인→완료, 대화 전송→상대 응답 번역
  - 검증 중 고친 버그: 딥링크로 바로 들어오면 로그인 복원 전에 첫 화면으로 튕기던 문제, 데모 모드 프로필 복원 순서 문제(이름·번역 누락)
- 미검증
  - Android 실기기·에뮬레이터 실행, 실제 녹음·재생·블루투스, QR 카메라 스캔 (Android SDK 미설치)
  - live 모드 (서버 API Phase 2–5 미구현)

## Phase 2. 인증·현장·멤버십 — 완료 (2026-10-11, 커밋 `c637a6b`)

- 구현 내용
  - Supabase 토큰 검증: JWKS(ES256) 서명·만료·발급자·`aud=authenticated` (`server/src/auth/verifier.ts`), 서버에 비밀 키 불필요
  - DB: `profiles`, `sites`, `site_memberships`, `site_join_codes`, `conversations`, `conversation_participants` + CHECK·부분 UNIQUE 제약 (마이그레이션 `phase2_sites_memberships`)
  - API: `/me`, `/me/sites`, `/languages`, `/sites`, `/sites/:id`, 가입 코드 발급·목록·폐기, `/join`, 멤버 목록·승인·거절·제외·언어 지정
  - 현장 생성 시 관리자 멤버십·그룹 대화·첫 가입 코드(7일)를 한 트랜잭션으로 생성, 승인 시 그룹 대화 참여, 제외 시 모든 대화에서 나감
  - 가입 코드: 혼동 문자 제외 8자리, 만료·횟수·폐기, 사용 횟수 조건부 증가(동시 요청 대비), 사용자당 1분 5회 제한
  - 실시간 알림 연결 지점 `DomainEvents`(membershipChanged, joinRequested) — Phase 3에서 Socket.IO로 구현
- 검증 결과
  - 서버 테스트 64개 통과 (Phase 2 통합 테스트 22개: 시나리오 1–4, 11, 12의 API 부분, 가입 코드 규칙, 속도 제한, 권한, DB 제약)
  - 실제 서버 + 실제 Supabase JWKS: 토큰 없음·위조 토큰 401 확인
- 미검증
  - 실제 Supabase 계정으로 로그인한 토큰으로 API 호출 (사용자 Supabase 프로젝트에 테스트 계정을 만들지 않음)
  - 앱 live 모드 ↔ 서버 연동 (Android 환경 없음). 대화·지시 API는 Phase 4–5라 live 모드에서 해당 탭은 아직 동작하지 않음
  - 멤버 접속 상태(`online`)는 항상 false — Phase 3에서 채움


- 작업
  - 서버: Supabase JWT 검증 미들웨어, `/me`, 현장 CRUD, 가입 코드, `/join`, 멤버 승인/거절/제외/언어 수정, `requireMembership`
  - 앱: Supabase 로그인·회원가입·비밀번호 재설정, 프로필 설정, 현장 선택·생성·가입(코드 입력, QR 스캔), 가입 대기, 멤버 탭, 가입 코드·QR 화면
- 완료 기준: 시나리오 1–4, 11 API 통합 테스트 통과, 앱에서 관리자·구성원 계정으로 가입~승인 흐름 수동 확인
- 위험: Supabase 재설정 메일 딥링크 설정

## Phase 3. 실시간 통신 — 완료 (2026-10-11, 커밋 `92e3620`)

- 구현 내용 (`server/src/realtime/`)
  - REST와 같은 포트에 Socket.IO `/rt`. 연결 시 Supabase 토큰 검증, 실패 시 `connect_error: UNAUTHORIZED`
  - 연결되면 `user:{id}` 방 자동 참여. `site:subscribe`는 DB에서 활성 멤버십을 확인한 뒤 `site:{id}`(관리자는 `site:{id}:managers`도) 참여
  - 도메인 이벤트 → 실시간 알림: `membership:changed`(본인 + 관리자 방), `join:requested`(관리자 방). 제외·거절 시 해당 사용자의 모든 연결을 현장 방에서 즉시 제거
  - 접속 상태: 사용자별 연결 수 추적, 처음 접속·마지막 종료 때만 `presence:changed`. 멤버 목록 `online`에 반영
  - 토큰 만료 시각에 `auth:expired` 후 연결 종료 (앱은 토큰 갱신 후 재연결 — `frontend/src/services/live/socketRealtime.ts`)
  - `sync:required` 발행 함수, `GET /api/v1/sync` (멤버십 변경분. 대화·메시지 변경분은 Phase 4)
  - `receipt:delivered`는 형식 검증만 (메시지 테이블이 생기는 Phase 4에서 상태 반영)
- 검증 결과
  - 서버 테스트 75개 통과 (실시간 통합 테스트 11개: 실제 HTTP 서버 + Socket.IO 클라이언트)
  - 시나리오 12 실시간 부분: 제외 후 현장 알림 차단을 대조군(관리자는 수신)과 함께 확인, 차단 코드를 제거하면 테스트가 실패함을 확인(변이 검증)
  - 실제 서버 기동: 토큰 없음·위조 토큰 `UNAUTHORIZED`, 잘못된 네임스페이스 거부, 오류 로그 0건
- 미검증
  - 실제 Supabase 계정 토큰으로 실시간 연결, 앱 live 모드 ↔ 서버 실통신 (Android 환경 없음)
  - Android 백그라운드 전환 시 연결 끊김 (실기기 필요). 앱은 포그라운드 복귀 시 전체 다시 불러오기로 보완


- 작업
  - Socket.IO `/rt` 네임스페이스, 핸드셰이크 인증, `user:` 자동 참여, `site:subscribe` 권한 검증
  - `membership:changed`, `join:requested`, `presence:changed`, `auth:expired`, `sync:required`
  - `GET /sync`
  - 앱: 전역 소켓 연결, 상태 바, 재연결 시 재구독·동기화, 이벤트 → 쿼리 캐시 반영
- 완료 기준: 소켓 통합 테스트(인증 거부, 권한 없는 구독 거부, 제외 시 즉시 차단 = 시나리오 12) 통과
- 위험: Android 백그라운드 전환 시 연결 끊김 → 포그라운드 복귀 시 동기화로 보완

## Phase 4. 통역 파이프라인 + 1:1 대화 — 다음 차례 (사용자 승인 후 착수)

### 착수 전 확인
- **OpenAI API 키**: 아직 미입력. 사용자에게 `cd server && npm run setup:openai` 입력을 요청한다. 키가 없어도 Fake 엔진으로 개발·테스트는 가능하다.
- **`gpt-realtime-2` 세부 규격**: Realtime API 이벤트 이름·세션 파라미터(출력 모달리티, 음성 포맷, 추론 강도)는 구현 시점에 OpenAI 공식 문서로 확인한다 (기억에 의존하지 말 것). 단가는 `server/src/engine/budget/pricing.ts`.
- 비용 한도 $5/월: 실제 API 호출 테스트는 최소한으로 하고, 호출 전후 `/health`의 `budget`을 기록한다.

### 이미 있는 것 (재사용)
- 엔진 인터페이스: `SttProvider`(`server/src/engine/stt/sttProvider.ts`), `Translator`(`engine/translation/translator.ts`), `AudioPreprocessor` + `runPreprocessorSafely`(`engine/audio/`), `DomainProcessor`(용어 감지·보정·컨텍스트), `BudgetGuard`(reserve → commit/release)
- DB: `conversations`(현장 그룹 자동 생성), `conversation_participants`(승인 시 참여, 제외 시 `left_at`)
- 실시간: `server/src/realtime/gateway.ts` — `user:{id}` 방으로 개인 발행, `receipt:delivered` 핸들러 자리(현재 형식 검증만)
- 계약: `server/src/shared/api.ts`(`MessageView`, `SendResult`, `ConversationSummary` …), `shared/realtime.ts`(`message:new`, `message:status`)
- **앱은 이미 완성**: 대화 목록·대화방·누르고 말하기·자동 재생·다시 듣기·재시도. live 모드 호출은 `frontend/src/services/live/httpApi.ts`(경로·본문 형식 확인용). 서버는 이 호출 형식에 맞춘다.

### 할 일 (서버)
1. DB: `messages`, `message_translations`, `message_recipients` (docs/database-design.md) + CHECK·UNIQUE(sender_id, client_message_id)
2. 엔진 구현: `OpenAiStt`(기존 PoC `requestAudioTranscription` 이식), `RealtimeTranslator`(서버→OpenAI WebSocket), 오디오 디코딩(`ffmpeg-static`, m4a→PCM16), 번역 음성 WAV 저장(`server/storage/audio`), 모든 호출에 BudgetGuard
3. 테스트용 `FakeStt`·`FakeTranslator`(지연·실패 주입)
4. 팬아웃 작업 큐: 대상 언어별 1회 번역, 동시성 제한, 재시도 2회, 서버 재시작 시 `pending`/`processing` 복구
5. API: `GET /sites/:siteId/conversations`, `POST /sites/:siteId/conversations/direct`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`(JSON 텍스트 / multipart 음성), `POST /messages/:id/retry`, `GET /messages/:id/audio`
6. 실시간: `message:new`(수신자별 `user:` 방), `message:status`(발신자), `receipt:delivered` 실제 반영, `GET /sync`에 대화·메시지 변경분 추가
7. 앱 mock(`frontend/src/services/mock/`)과 동작이 다르면 계약 쪽으로 맞추고 둘 다 고친다

### 완료 기준
- 시나리오 5, 6, 13, 14, 15 자동 테스트 통과 (Fake 엔진)
- 실제 OpenAI로 5개 언어 왕복 수동 확인 + 단계별 지연(ms) 기록 — 키가 있을 때
- 위험: Realtime 세션 연결 지연, 우즈베크어 번역·음성 품질, 블루투스 마이크 입력(실기기 필요)

## Phase 5. N:N 그룹 대화 + 1:N 일괄 지시

- 작업
  - 서버: 현장 기본 그룹 대화(승인 시 자동 참여, 제외 시 퇴장), 일괄 지시 API(대상 선택, 언어별 1회 번역), inbox, ack/complete, 지시 목록·상세 집계, `instruction:recipient`
  - 앱: 그룹 대화(대화 화면 재사용), 지시 작성·목록·상세(관리자), 받은 지시·확인·완료(구성원)
- 완료 기준: 시나리오 7–10 통과, 실기기 3대 이상(서로 다른 언어)으로 그룹·지시 수동 확인
- 위험: 대상자 수가 많을 때 처리 시간 → 언어별 1회 번역으로 완화

## Phase 6. 안정화

- 작업: 권한 매트릭스 테스트 보강, 네트워크 단절 시나리오, 실기기 체크리스트 전체 수행, 성능 측정(동시 메시지), 운영 문서(환경 설정, 배포, 플러그인 연결 방법: 노이즈 필터·데이터셋·보존 정책)
- 완료 기준: 시나리오 1–16 결과표(자동/수동/미검증 구분), 알려진 문제 목록
- 위험: 실기기·외부 API 접근 환경

## 2. 다른 개발자 연결 지점

| 담당 | 연결 지점 | 계약 |
|---|---|---|
| 딥러닝 노이즈 필터 | `server/src/plugins/audioPreprocessor.ts` (서버) 또는 `frontend/src/audio/preprocess.ts` (단말, Phase 4에서 생성) | `AudioPreprocessor.process(PcmAudio) → PcmAudio` / `preprocessRecording(uri) → uri` |
| 데이터 보존 정책 | `server/src/plugins/retentionPolicy.ts` | `RetentionPolicy.run(ctx)` |
| 현장 데이터셋 | `server/src/plugins/datasetAdapter.ts`에 어댑터 등록 또는 정규화 JSON 제공(`DATASET_ADAPTER=normalized-json`) | `DatasetAdapter.load() → {lexicon, phrases}` |

## 3. 남은 확인사항

1. 노이즈 필터 실행 위치(서버 / 단말)와 입력 형식 — 양쪽 훅을 준비해 두고, 담당 개발자와 확정
2. Supabase 대시보드에서 비밀번호 재설정 메일의 앱 딥링크(`syncrew://reset-password`) Redirect URL 허용 — 사용자 확인 필요 (프로젝트 URL·키는 `.env`에 입력 완료)
3. 앱 실행 검증을 위한 Android SDK(에뮬레이터) 또는 실기기 준비 (사용자가 추후 준비)
4. OpenAI API 키 입력 (Phase 4 실제 번역 확인에 필요)
5. 실제 Supabase 계정 토큰으로 API·실시간 연결 확인 — 테스트 계정 생성은 사용자 허락 후
