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
| 4 | 통역 파이프라인 + 1:1 대화 | 3 | 완료 `fd2caf0` (실제 OpenAI 확인은 Phase 6에서 완료) |
| 5 | 실시간 통역 (1:1 통화 + 실시간 일괄 지시) | 4 | 완료 `d7f29a4` |
| 6 | 안정화·실제 OpenAI·live 모드·기기 확인 | 1–5 | 완료 `022f261` (실기기는 추후) |
| 7 | 진짜 스트리밍 통역(1:1 통화) + 일괄 지시 대상 선택 UX | 6 | 진행 중 — S1·S2·S3 구현 완료, S3 실기기 iOS 일부 통과·Android 미실시 (2026-10-22, 아래 Phase 7 절) |

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

## Phase 4. 통역 파이프라인 + 1:1 대화 — 완료 (2026-10-12, 커밋 `fd2caf0`)

작업 정리(비용 추정·결정 사항 포함): [phase4-report.md](phase4-report.md)

- 구현 내용 (서버)
  - DB 마이그레이션 `phase4_messages`: `messages`, `message_translations`, `message_recipients` + CHECK(종류·상태·언어·instruction↔conversation_id·audio↔원본 경로)·UNIQUE(sender_id, client_message_id), `conversation_participants.last_read_seq`(안 읽은 수)
  - 엔진: `OpenAiStt`(PoC `requestAudioTranscription` 이식, WAV 업로드), `RealtimeTranslator`(gpt-realtime-2.1 GA WebSocket, 음성+전사, 공식 문서로 이벤트·파라미터 확인), `codec.ts`(ffmpeg-static 디코딩 16kHz, WAV 인코딩), `metered.ts`(모든 OpenAI 호출을 BudgetGuard 예약→기록), `FakeStt`·`FakeTranslator`(지연·실패 주입)
  - 파이프라인 `messaging/pipeline.ts`: 디코딩 → 노이즈 필터 플러그인(실패 시 원본) → STT → 현장 특화 처리 → 언어별 1회 번역(동시성 4, 1회+재시도 2회, 15초 제한) → 번역 음성 WAV 저장 → 언어별 수신자 전달. 서버 시작 시 멈춘 메시지 복구
  - API: 대화 목록·1:1 열기(멱등)·메시지 목록(읽음 처리)·전송(JSON 텍스트 / multipart 음성, 1분 30회)·재시도·음성 다운로드(서명 URL), `GET /sync`에 대화·메시지 변경분
  - 실시간: `message:new`(수신자 `user:` 방), `message:status`(발신자), `receipt:delivered` 실제 반영
  - `ENGINE=fake`: 키 없이 서버·앱 live 모드 확인용 가짜 엔진
  - 앱: 서버가 주는 상대 경로 음성 URL에 서버 주소를 붙여 재생 (`frontend/src/audio/playback.ts`)
- 계획 대비 변경·결정
  - 음성 URL: 앱 플레이어가 Authorization 헤더를 못 붙이므로 **조회자별 서명 URL**(HMAC, 24시간)로 인증하고, 다운로드 시 권한을 다시 확인
  - `last_read_seq` 컬럼 추가 (DB 문서에 없던 안 읽은 수 계산용)
  - m4a는 파이프가 아닌 파일 경로로 디코딩 (휴대폰 녹음은 moov가 파일 끝)
  - STT 단가를 공식 값으로 갱신 ($3 추정 → $1.25)
  - 같은 대화 경로라 그룹 대화 메시지도 동작하지만(시나리오 9 테스트에 사용), 시나리오 7 테스트는 Phase 5에서 추가
- 버그 수정 (기존 코드)
  - **DB 시각 9시간 어긋남**: Prisma pg 어댑터가 시각을 시간대 없이 주고받는데 로컬 DB 시간대가 Asia/Seoul이라 저장값이 9시간 밀리고 DB `now()` 비교가 틀어짐 → 연결 세션 시간대를 UTC로 고정. 회귀 테스트 추가, 수정 제거 시 실패함을 확인(변이 검증). **기존 개발 DB(`server/.pgdata`)에 이미 저장된 시각은 9시간 어긋나 있음** (개발 데이터라 그대로 둠)
- 검증 결과
  - 서버 `tsc` 통과, 테스트 **106개 통과** (Phase 4 추가 31개)
    - 통합(실제 Postgres + Socket.IO, Fake 엔진) 20개: 시나리오 5(텍스트·음성 양방향, 실제 m4a→16kHz→STT→번역→WAV 재생), 6(대조군 포함), 9(부분 실패·재시도 시 실패 언어만 재전달·STT 실패 후 재시도), 12(제외 후 대화·음성 URL 차단), 13(순차·동시 중복 전송), 14(필터 교체·오류 시 원본 진행), 15(데이터셋 교체 시 보정·용어 컨텍스트, 대조군 포함), 수신 확인, 동기화, 재시작 복구, 엔진 없음 503, 입력 검증, 안 읽은 수, 서명 위조 거부
    - OpenAI 엔진 프로토콜 7개(로컬 가짜 Realtime·STT 서버): 세션 설정·이벤트 처리·사용량→비용 기록, 오류·실패·시간 초과 시 비용 미기록, 한도 초과 시 미연결, 요청 형식(WAV·language·prompt·json)
    - 오디오 변환·URL 서명 4개
  - 실제 서버 기동(`ENGINE=fake`): `/health` 정상, 토큰 없음 401, 위조 음성 URL 401, 경고·오류 로그 없음
  - **앱 실행 (처음으로 에뮬레이터·시뮬레이터에서 확인, 데모 모드)**: Android 에뮬레이터 빌드·실행 후 언어 전환·로그인·프로필·현장 목록·대화·1:1 대화·지시 탭 조작 확인, 오류 0건. iOS 시뮬레이터 빌드·실행 후 첫 화면 확인. 앱 코드 수정 없음. 상세·명령: [phase4-report.md](phase4-report.md) 7절
- 미검증
  - **실제 OpenAI 호출** (API 키 미입력): 5개 언어 왕복, 단계별 지연(ms), 우즈베크어 STT(`language=uz`) 수용 여부, 실제 비용
  - 실제 Supabase 계정 토큰으로 대화 API·실시간 연결, 앱 live 모드 ↔ 서버 실통신
  - 블루투스 헤드셋 녹음·재생 (실기기 필요)
  - iOS 시뮬레이터 화면 이동(조작 도구 없음), 에뮬레이터에서 마이크 녹음·음성 재생·QR 카메라
- 알려진 문제·제약
  - **iOS 빌드는 한글이 든 프로젝트 경로에서 `pod install` 실패** → 영문 경로 복사본에서 빌드함. **Android 빌드는 JDK 21 필요** (JDK 25·26은 CMake 단계 실패)
  - 음성 URL 서명 키를 비워 두면 서버 재시작 후 이전 URL이 무효 (앱이 목록을 다시 받으면 새 URL)
  - 그룹에 나중에 들어온 사람은 가입 전 메시지를 보지 않는다 (수신자 행이 없음 — 의도된 동작)
  - 작업 큐·비용 예약은 서버 1대 메모리 기준

## Phase 5. 실시간 통역 (1:1 통역 통화 + 관리자 실시간 일괄 지시) — 완료 (2026-10-12, 커밋 `d7f29a4`)

사용자 요청으로 범위를 "N:N 그룹 대화 + 1:N 일괄 지시"에서 바꿨다. 상세: [live-interpretation.md](live-interpretation.md)

- 결정 (사용자 승인)
  - 방식: **핸즈프리 발화 단위 통역** — 통화가 연결된 동안 계속 듣다가 말이 끝나면 자동 전송, 상대 이어폰에서 자동 재생. 진짜 스트리밍은 expo-audio 스트리밍이 iOS에서 재생·블루투스를 막아 네이티브 모듈이 필요하므로 추후 과제
  - 원래 Phase 5의 일괄 지시 API(작성·목록·상세·받은 지시·확인·완료)도 함께 구현. 그룹 대화는 기존 경로로 동작(테스트 추가), 그룹용 실시간은 범위 밖
- 구현 내용
  - 서버: `live_sessions`·`live_session_participants`·`messages.session_id`, 세션 서비스(통화 울림·수락·거절·끊기·부재중 30초, 일괄 지시, 연결 끊김 20초 유예·복구, 제외 시 처리, 시작 시 정리), 세션·지시 API, `device:status`·`session:*`·`device:changed`·`instruction:recipient`, 메시지 생성 공통화
  - 앱: 발화 감지(VAD), 핸즈프리 녹음·자동 전송(통역 재생 중 일시 정지, 블루투스 헤드셋 입력 우선 선택·상태 보고), 통화 화면, 일괄 지시 시작·관리자 콘솔·구성원 수신 화면, 수신 시 화면 자동 열림·강제 자동 재생, 멤버 탭 통화 버튼·헤드셋 상태, 진행 중 세션·연결 끊김 배너, 기록의 통화/실시간 표시, 1:1 대화방은 누르고 말하기 대신 통화 버튼, 문자 지시는 텍스트 전용, 데모 모드 전체 지원
- 검증 결과
  - 서버 테스트 **126개 통과** (추가 20개: 시나리오 A–G, 작성 지시·확인·완료, 시나리오 7·8·10), 변이 검증 2건
  - 앱: 타입 검사, expo-doctor 21/21, 발화 감지 단위 테스트 11개, 웹 e2e **50개 통과**(추가 28개: 통화·일괄 지시·구성원 수신), 콘솔 오류 0
- 기기 확인 (사용자 요청으로 중간에 중단, 추후): Android 에뮬레이터 빌드·실행, 통화 화면 네이티브 녹음기 "듣고 있어요" 동작·데모 발화·통화 표시 확인, 강제 종료 없음. 실제 말소리 자동 감지·일괄 지시·구성원 수신·iOS 실행은 미확인, `Error: undefined` 로그 1회 조사 필요 (live-interpretation.md 8절)
- 미검증: 실기기·블루투스 헤드셋 입출력, 실제 OpenAI 지연, live 모드 ↔ 서버 실통신, 백그라운드 동작 (live-interpretation.md 9절)
- 알려진 제약: 동시에 말하기(전이중) 미지원, 구간 전환 시 말 앞부분이 잘릴 수 있음, VAD 기준값 현장 조정 필요

## Phase 6. 안정화 + 실제 OpenAI + live 모드 + 기기 확인 — 완료 (2026-10-12, 커밋 `022f261`, 상세: [phase6-report.md](phase6-report.md))

사용자 지시: "남은 모든 일 마무리", OpenAI 잔액 $1.44 — 그 이상 쓰지 말 것 → 서버 한도 `OPENAI_BUDGET_USD=0.5`(누적)로 낮춤. 누적 사용 $0.070.

- 실제 OpenAI: 5개 언어 왕복 실제 호출(`server/scripts/openai-check.ts`). **우즈베크어 STT가 `language=uz`를 거부 → 언어 지정 없이 프롬프트로 인식하도록 수정.** vi·ru·zh는 의미 유지, **uz는 의미가 바뀌는 오류**(사용자 결정: 보류). 음성 메시지 1건 약 $0.010–0.013
- live 모드 ↔ 서버: 사용자 허락 후 Supabase 테스트 계정 생성, 2인 live e2e(`frontend/e2e/live.mjs`) **27개 통과**. **웹 음성 업로드 버그 수정**(RN 전용 FormData 파일 형식이 웹에서 깨짐). 서버 경로 실제 지연: 업로드 → 상대 수신 **5.1초**, 말 끝 기준 약 6초(`e2e/latency.mjs`)
- 기기: 에뮬레이터에서 일괄 지시·구성원 수신·통화 전 과정 확인, `Error: undefined` 재현 안 됨. 실제 말소리 자동 전송은 웹 가짜 마이크로 확인(`npm run e2e:mic`). iOS 시뮬레이터 빌드·실행 확인(로고 표시 문제 1건). 실기기·블루투스 미검증
- 안정화: 서버 테스트 **157개 통과**(추가 31: 권한 매트릭스 23, 안정성 7, uz STT 1), 처리량 측정(40건 동시 1.2초, 유실·중복 0), 시나리오 1–17·A–G 결과표, 운영 문서 [operations.md](operations.md)
- 남은 것: 실기기 체크리스트, `closeStale` 자동 테스트, iOS 로고, 우즈베크어 품질(보류)

## Phase 7. 진짜 스트리밍 통역 (1:1 통화) + 일괄 지시 대상 선택 UX — 계획 승인 (2026-10-12)

상세 계획·결정: [streaming-plan.md](streaming-plan.md)

- 목표: 1:1 통역 통화의 말 끝 → 상대 이어폰 지연 약 6초 → 1.5초 안팎 (P50 목표, S0에서 확정)
- 결정 (사용자 승인): 음성 경로 A안(우리 서버 경유, Socket.IO + PCM 조각, 서버가 OpenAI Realtime 세션 유지), 네이티브 오디오는 라이브러리 실기기 검증 → 안 되면 자체 Expo 모듈, **스트리밍 범위는 1:1 통화만**(일괄 지시는 발화 단위 방식 유지), 발화 단위 방식은 폴백으로 유지
- 단계: S0 기술 검증(OpenAI 측정 + 실기기 2026-10-13~) → S1 서버(가짜 엔진) → S2 웹 검증 클라이언트 → S3 네이티브 오디오 → S4 1:1 통화 통합 → S6 실기기 튜닝. 각 단계 끝에 멈추고 승인
- 추가 (사용자 요청): 일괄 지시 대상 선택 UX — B1 앱(빠른 선택 칩·전체 선택·검색·지난 선택 기억·요약), B2 작업조 저장(DB 변경, 별도 승인)
- 전제: 실기기·블루투스 헤드셋, OpenAI 충전·한도 상향(S2 실제 확인 전), 영문 경로 이동(S3 전 권장)

### B1 일괄 지시 대상 선택 UX — 완료 (2026-10-13, 커밋 `b1eb6d6`)

- 공통 컴포넌트 `frontend/src/components/RecipientPicker.tsx`(문자 지시·실시간 지시 화면 공통) + 계산 로직 `frontend/src/lib/recipients.ts`
- 빠른 선택 칩(지난번 대상·접속 중·이어폰 연결됨·언어별, 조합 가능: 켜진 칩을 다시 누르면 그 묶음만 해제, 현장 전체 상태에서 누르면 그 묶음만 고른 직접 선택으로 전환), 전체 선택·선택 해제·선택 반전(검색 결과에만 적용), 이름 검색(선택 유지), 지난 선택 기억(관리자·현장별 단말 저장, 제외된 사람 자동 제외), 보내기 버튼 위 요약("5명 · 3개 언어 · 연결 4명") + 연결 끊김 안내(문자 지시 화면에도 추가)
- 서버 계약 변경 없음 (`"all"` 또는 `{userIds}`). 직접 선택 시 보내는 `userIds`는 지금 후보에 있는 사람만 (이전에는 선택 집합을 그대로 보냄)
- 검증: 앱 타입 검사, 단위 테스트 17개(VAD 11 + 대상 선택 6), 데모 e2e 75개(기존 50 + 대상 선택 25: 선택하지 않은 사람이 받는 사람에 없는지 대조군 포함), live e2e 29개(기존 27 + 실제 서버 접속 상태 칩·요약 2), 서버 157개
- 미검증: 네이티브(에뮬레이터·실기기) 화면 확인, 구성원이 많은 현장(수십 명)에서의 스크롤·칩 줄바꿈

### S0 ① OpenAI Realtime 스트리밍 측정 — 완료 (2026-10-13, 커밋 `b1eb6d6`, 상세: [s0-report.md](s0-report.md))

- 스크립트 `server/scripts/stream-measure.ts`: 합성 음성을 실시간 속도 100ms 조각으로 Realtime 세션에 흘려 여러 턴 측정 (BudgetGuard 경유, `--max-usd` 상한, `--dry-run` 비용 0)
- 결과: 말 끝 → 첫 번역 음성 P50 1.83초(server_vad, 11턴) / 2.06초(semantic_vad, 5턴), 입력 음성 10토큰/초·출력 20토큰/초, 턴당 $0.0102, 말한 1분당 약 $0.175, 함정 질문 4/4 번역만 함, 세션 중간 끊김 1회(재현 안 됨)
- 비용: $0.1651 기록 (승인 상한 $0.2), 서버 한도 누적 $0.2348 / $0.5
- 계획 변경 제안 P1–P7 (server_vad, 목표 P50 ≤ 2.0초로 조정, 컨텍스트 유지 0턴, 원문 전사 용어 보정 등) — **승인 대기**
- 계획 변경 중 P2·P3·P4 결정, P1·P5–P7 확인 대기

### 계획 수정 (2026-10-13, 사용자 결정 — [streaming-plan.md](streaming-plan.md) 0-2절)

- 목표 지연 P50 ≤ 2.0초·P90 ≤ 3.0초 (1.5초는 S6 튜닝 목표)
- OpenAI 세션 안 문맥은 응답마다 모두 삭제, 직전 1–2문장을 텍스트로 지시문에 넣음 (DB 기록은 그대로)
- OpenAI 충전 완료 (서버 한도 새 금액은 미정)
- 실기기·헤드셋 검증(S0 ②)을 앞에서 빼고 **S1 → S2 → S3 → S4 → S6**로 바로 구축. 라이브러리 실기기 확인은 S3(헤드셋 없이), 블루투스 헤드셋은 S6
- P1(server_vad)·P5(원문 전사 용어 보정)·P6(세션 끊김 → 재연결·폴백)·P7(S6 추론 minimal 실험) 승인
- 실기기 시험 방식: 먼저 구현, 실기기 시험(2026-10-13 오후부터)에서 고침. S3은 1순위 라이브러리로 바로 구현, 헤드셋도 그 시험에서 함께 확인
- 서버 한도: **$3 누적으로 상향 적용** (사용자 승인, [s0-report.md](s0-report.md) 3-1절)
- 실기기 시험은 **iOS·Android 모두** (사용자 지시)

### S1 서버 스트리밍 경로 — 완료 (2026-10-13, 커밋 `b1eb6d6`, 상세: [streaming-plan.md](streaming-plan.md) 4-1절)

- `server/src/streaming/` (엔진 계약·OpenAI 어댑터·가짜 엔진·표본률 변환·기록 저장·허브), 실시간 이벤트 `stream:*` ([realtime-protocol.md](realtime-protocol.md) 10절), 환경 변수 `STREAMING`·`STREAM_MAX_SESSIONS`·`STREAM_VAD_SILENCE_MS`
- 서버 테스트 **181개** 통과 (스트리밍 24 추가, 12회 반복 안정). DB 구조 변경 없음
- 사용자 결정 반영(2026-10-13): **같은 언어 통화는 OpenAI 없이 음성 직접 전달(relay)**, 실패한 턴은 기록 안 함, 용어집 미리 넣기 보류, **S2에서 스트림으로 들은 문장의 `message:new` 재생 금지(필수)**

### S2 웹 검증 클라이언트 — 완료 (2026-10-14, 커밋 `713c5e3` + 후속 수정, 상세: [streaming-plan.md](streaming-plan.md) 5-1절)

- 앱: `audio/duplex/`(이중 오디오 인터페이스 + 웹 구현), `audio/useStreamingCall.ts`, `audio/streamed.ts`(**중복 재생 방지**), 통화 화면(방식 표시·실시간 자막·폴백 안내), 서비스 `openStream` 등, 5개 언어 문구. 데모 모드는 발화 단위 그대로
- 서버: 기록 알림이 턴 끝 알림보다 먼저 나가던 버그 수정 + 순서 테스트 (서버 182개)
- 검증(비용 0): live e2e 35(2회), 폴백 e2e 33, 데모 75, 마이크 2, 단위 17, Android 번들
- 실제 OpenAI 확인 2회($0.0253): 스트리밍 통화 동작, **앱이 조각을 버리던 버그(volatile emit) 발견·수정** → 빠진 조각 0, 문장 전체 통역. 누적 $0.2602
- **다음: S3 네이티브 오디오** (iOS·Android, 1순위 react-native-audio-api 1.0 nightly — 실기기 필요)

### B2 작업조 저장 — 완료 (2026-10-14, 커밋 `d47b83d`, DB 변경: 사용자 "모두 마무리" 지시로 승인)

- DB: `target_groups`(현장·이름 유일)·`target_group_members` (마이그레이션 `20261013160349_b2_target_groups`, 기존 표 변경 없음)
- API (관리자만): `GET/POST /sites/:siteId/target-groups`, `PATCH/DELETE /sites/:siteId/target-groups/:groupId` — [api-specification.md](api-specification.md) 12절. 다른 현장 사용자·가입 대기자 넣기 400, 같은 이름 409, 다른 현장 작업조 id 404, 현장당 50개. 구성원이 현장에서 제외되면 작업조에서도 빠진다
- 앱: 대상 선택에 작업조 칩(지난번 다음, 이름순), "작업조로 저장"(같은 이름이면 확인 문구 후 그 작업조를 지금 선택으로 덮어쓰기 = 구성원 수정), 작업조 관리 화면(`site/target-groups`: 이름 바꾸기·삭제, 두 단계 확인). 데모 모드에 예시 작업조 1개. 5개 언어 문구
- 검증: 서버 작업조 테스트 4 + 권한 매트릭스 4줄(서버 192), 단위 +1(18), 데모 e2e +21(96), live e2e +2(37, 실제 서버로 저장·칩)

### 안정화 (2026-10-14, 커밋 `d47b83d`)

- 서버 시작 시 정리를 `src/startup.ts` 로 분리하고 자동 테스트 추가 (열린 세션 connection_lost·끝난 세션 유지·범위 밖 대조군·멈춘 메시지 재처리·두 번 불러도 안전)
- 업로드 음성 형식 허용 목록 (`http/upload.ts`: audio/mp4·m4a·aac·webm(코덱 표기 허용)·ogg·wav·mpeg·3gpp, 그 밖 400) + 테스트
- **알림(토스트) 사라짐 버그 수정**: 앞 알림이 사라지는 동안 새 알림이 오면 새 알림까지 지워지던 문제 (작업조 e2e 에서 발견, `stores/toast.ts`·`ToastHost.tsx`)
- iOS 시작 화면 로고 "Sync" 어둡게 보임: **재현 안 됨** (2026-10-14 iPhone 17 Pro 시뮬레이터, 기존 개발 빌드 + 현재 JS — 흰색 정상). 원인은 확정하지 못함
- Expo 패치 업데이트 4개 (expo 57.0.28, expo-crypto 57.0.4, expo-router 57.0.26, expo-splash-screen 57.0.10): `expo install --fix` 후 `expo-modules-core` 가 하위 폴더로 들어가 타입이 깨져 의존성을 새로 설치(잠금 파일 재생성). doctor 21/21, Android 번들·전체 e2e 통과. **iOS·Android 네이티브 개발 빌드는 다시 하지 않음**(다음 실기기 빌드 때 새 버전으로)
- 실제 청구액 대조: 서버 기록(UTC 날짜별) 10-12 $0.0697, 10-13 $0.1905, 누적 $0.2602 (+ S0 미기록 약 $0.005). **대조는 하지 않기로 함** (사용자 결정 2026-10-14)

### 실기기 없이 마무리 (2026-10-14 후반)

사용자 지시: "실기기 없이 할 수 있는 모든 작업 마무리". 결정: 충전 잔액 $80(막 쓰지 않기), 청구액 대조 안 함, 프로젝트를 `/Users/taewoongjang/PlayGround/SYNCREW` 로 이동(완료), 노이즈 필터는 서버, 원어민 검수는 나중에.

- **Supabase 비밀번호 재설정**: 사용자가 대시보드에서 Redirect URL(`syncrew://reset-password`)·메일 문구·Gmail SMTP 설정. 메일 수신(대시보드 발송) 확인, 관리자 링크로 앱 주소 이동 확인(대조군: 미등록 주소는 Site URL) — `docs/operations.md` 8절. 남은 것: 실기기에서 링크로 앱 열림
- **관리자 지정·해제**: `PATCH /sites/:siteId/members/:userId { role }` (마지막 관리자 해제 불가), 실시간 관리자 방 이동, 멤버 화면 버튼 + 확인, 데모 모드. 서버 역할 테스트 3 + 권한 매트릭스 1, 데모 e2e +3
- **같은 언어 통화 앱 쪽 e2e**: live e2e +6 (직접 전달 표시·음성 조각 수신·기록 없음)
- **서버 노이즈 필터 조각 단위 연결 지점**: `STREAM_AUDIO_FILTER` (`docs/streaming-plan.md` 5-2절), 서버 테스트 +4
- **원문 받아쓰기**: STT_MODEL → gpt-4o-transcribe, 용어 힌트는 측정 결과 쓰지 않음, 받아쓰기 단가 수정 (`docs/streaming-plan.md` 5-2절). OpenAI 비용 $0.0221, 누적 $0.3371
- 시험 도구 수정: 헤드리스 Chrome 이 확인 창을 수락 전에 닫는 문제 → 데모 e2e 는 `window.confirm` 을 "확인"으로 바꿔 둠, 확인 창 처리 오류로 e2e 전체가 멈추던 문제 수정
- 검증: 서버 200, 데모 e2e 99, live e2e 43, 마이크 2, 단위 18, Android 번들, expo-doctor 21/21

### T2 실기기 기준선 (2026-10-14 밤 – 10-15, 상세: [device-test-log.md](device-test-log.md))

기기: Galaxy S22 (SM-S901N) + Galaxy Buds2, iPhone 17 Pro (iOS 26.7.1) + AirPods Pro. 서버 `ENGINE=fake` (OpenAI 비용 0).

| 시나리오 | Android | iPhone |
|---|---|---|
| 설치·실행·로그인 (live) | 통과 (USB 터널 `adb reverse`) | 통과 (Galaxy 핫스팟에 Mac·iPhone 무선) |
| A 상대 문자 실시간 수신 | 통과 | 통과 |
| B 휴대폰 마이크 통화 (문장 단위) | 수정 후 통과 | 수정 후 통과 |
| C 헤드셋 마이크 통화 | **실패 — 헤드셋 마이크 무음 (SCO 미시작) → S3** | 수정 후 통과 (입력 AirPods Pro HFP 확인) |
| D 일괄 지시 / E 비밀번호 메일 링크 | 미실시 | 미실시 |
| 헤드셋으로 통역 듣기 | 미확인 (가짜 엔진 음성은 0.1초 무음) | 미확인 |

실기기에서만 드러나 고친 문제 (커밋 번호는 `CLAUDE.md` 상태표):
1. **휴대폰 음성 업로드 전부 실패** — Expo SDK 57 기본 fetch(expo/fetch)가 RN 파일 첨부 `{uri,name,type}` 미지원 ("Unsupported FormDataPart implementation", 화면엔 "네트워크 연결을 확인해 주세요"). 휴대폰 multipart 는 `XMLHttpRequest` 로 (`frontend/src/services/live/http.ts`)
2. Android 음량 값에 `-160`(값 없음)이 끼어들어 말 감지가 끊김 → 건너뜀 (`useHandsFree.ts`)
3. 역순 목록 빈 화면 안내문이 거울 글자 — 최신 RN 은 네이티브에서 빈 화면을 이미 바로 세움 → 웹에서만 뒤집기 (통화·대화 화면)
4. **iOS 에서 서버 번역 음성 재생 불가** — 서버가 `Range` 요청에 206 을 주지 않아 AVPlayer 가 파일을 열지 못함 → 재생 끝 이벤트가 없어 통화 마이크가 "재생 중"으로 멈춤. 서버 Range(206/416) 지원 + 시험 (`server/src/routes/v1/conversations.ts`), 앱 재생 끝 감시 안전장치 (`playback.ts`)
5. **iOS 빈 음성 파일(28바이트) 업로드** — iOS 녹음기가 다음 녹음을 같은 파일 경로에 다시 씀 → iOS 는 업로드가 끝난 뒤 다음 녹음 시작 (`useHandsFree.ts`, 통화·일괄 지시 화면 `mutateAsync`)
6. iOS 헤드셋을 "연결 안 됨"으로 표시 — expo-audio `getCurrentInput()` 이 iOS 에서 Promise 가 아님 → Promise 로 감쌈 (`audioDevice.ts`)

환경에서 알게 된 것:
- 일반 Wi-Fi(공유기)가 기기 간 통신을 막음(클라이언트 격리). **Galaxy 가 핫스팟을 켜면 Galaxy 앱은 그 핫스팟의 손님(Mac)에 닿지 못함** (adb shell 로는 닿음). iPhone 은 Galaxy 핫스팟 손님으로 정상. 두 휴대폰 동시 시험(S4)은 둘 다 손님인 구성 필요 (예: iPhone 핫스팟에 Mac·Galaxy, 또는 격리 없는 공유기)
- iOS 개발 빌드(expo-dev-client 없음)는 빌드 때 Mac 주소를 앱에 넣음(`ip.txt`) → 네트워크가 바뀌면 다시 빌드
- iOS 서명: Xcode 계정 팀 `RVB3MMNVS6`, `xcodebuild -allowProvisioningUpdates DEVELOPMENT_TEAM=RVB3MMNVS6 CODE_SIGN_STYLE=Automatic` 로 인증서 자동 생성 (처음엔 인증서 0개라 `expo run:ios --device` 실패)
- USB 터널(adb reverse)이 순간 끊겨 문장 1개 손실 — 실제 Wi-Fi 에서는 해당 없음. 앱은 실패한 문장을 다시 보내지 않음
- 검증: 서버 200(Range 확인 추가), 단위 18, 데모 e2e 99, live e2e 43, 타입 검사

### S3 네이티브 오디오 — 구현 (2026-10-15 새벽, 실기기 시험 전, 상세: [streaming-plan.md](streaming-plan.md) 5-3절)

사용자 지시: "실기기 확인 없이 S3 코드 구현을 최대한 꼼꼼히, 문제가 생기면 알아서 해결". 결정: 라이브러리 대신 **자체 Expo 모듈** `frontend/modules/syncrew-duplex/` (Android 헤드셋 SCO 가 라이브러리로는 안 되므로).
- iOS: AVAudioEngine + voice processing(에코 제거) + 블루투스 HFP, AVAudioPlayerNode 재생, 경로·중단·재시작 처리
- Android: 통신 모드 + 통신 장치(SCO > 유선 > 스피커), AudioRecord(VOICE_COMMUNICATION)+AEC/NS/AGC, AudioTrack(VOICE_COMMUNICATION) 스트리밍, 직접 버퍼·논블로킹
- JS: `DuplexAudio` 네이티브 어댑터, base64(테스트 4), 통화 경로 보고, **문장 단위 폴백에서도 Android 헤드셋 SCO 사용**(어제 C 실패 해결 시도), 개발용 점검 화면 `/audio-check`, 개발용 시작 경로 `EXPO_PUBLIC_DEV_START_ROUTE`, 소켓 인증 거부 후 재연결
- 검증: Android·iOS(시뮬레이터) 빌드, Android 에뮬레이터 점검 화면(100ms 조각·재생·녹음 재생), 에뮬레이터 앱의 스트리밍 스트림 열림. 타입 검사, 단위 22, 서버 200
- 미검증·환경 문제: 실기기 전부. 이 PC 의 Mac 마이크 권한 문제로 에뮬레이터 입력이 막혀 live 통화 끝까지 확인 못 함. 웹 e2e 는 Mac 정리 후(10-15 아침) `e2e:mic` 2/2·데모 99/99·live 43/43 통과

### 실기기 없이 마무리 (2) (2026-10-17, 사용자 지시 "실기기 없이 할 수 있는 모든 작업 마무리", 상세: [HANDOFF.md](HANDOFF.md) 2절)
- S3 네이티브 코드(Swift·Kotlin·JS 어댑터·통화 훅) 전체 재점검: 실기기 전에 고칠 결함 없음. 실기기에서 볼 점 4개 기록 (Android SCO 켜지는 시간, 재생 오류 로그 반복, iOS 탭 크기, 오디오 포커스)
- **버그 수정: 한쪽만 스트리밍하는 통화에서 문장 단위 쪽이 상대 말을 못 들음** (`useStreamingCall`: 내 스트림이 열려 있을 때만 스트림 턴을 받음). live e2e `E2E_MIXED=1`(서버 `STREAM_MAX_SESSIONS=1`) 추가 — 수정 전 실패(재생 0·건너뜀 3, 대조군), 수정 후 18/18. 같은 언어 + 혼합은 남은 한계
- 상대 역할 스크립트 `server/scripts/call-peer.ts` 추가 (통화 걸기·받기, 합성 음성 스트리밍/문장 단위, 휴대폰 소리 음량·wav 저장, 오디오 경로 출력). `ENGINE=fake` 서버에서 스크립트 두 개끼리 통화로 확인 (비용 0)
- OpenAI 가격 공식 가격표 대조: 서버 표와 일치
- 빌드 캐시 정리 (Android `.cxx`·`build` 2.6GB, Xcode ModuleCache, npm). **디스크 여유 약 2GB — 실기기 빌드 전 사용자 공간 확보 필요**
- 못 한 것: 에뮬레이터에서 통역 음성 조각 수신·재생 확인 (디스크 부족으로 에뮬레이터가 켜지지 않음)
- 시험: 서버 200, 앱 단위 22, 데모 e2e 99, live e2e 43, 혼합 통화 e2e 18, 타입 검사 모두 통과
- **이로써 실기기 없이 할 수 있는 일은 남지 않았다.** 남은 것은 실기기 시험(S3 → S4 → S6, T2 D·E, T6)·다른 팀원 몫·나중 작업

### S3 iOS 실기기 시험 (2026-10-17 밤, 새 담당자 현슈, 커밋 `4fd2d9d` · PR #1 병합 `76cac8b`, 상세: [device-test-log.md](device-test-log.md), [HANDOFF.md](HANDOFF.md) 2절)
- 기기: iPhone 15 Pro Max(iOS 26.6.1) + AirPods Pro. 서버 `ENGINE=fake`(비용 0), 상대 `call-peer.ts`. Android 기기 없음 → Android 미실시
- **버그 수정 — iOS voice processing 무한 재시작**: 에코 제거를 켠 엔진이 시작 직후 설정 변경으로 멈추고 재구성하면 또 멈춤(스피커 간헐·블루투스 HFP 항상) → 녹음 조각 0개·소리 없음. 수정: 48kHz 고정, 블루투스에서는 voice processing 미사용, 경로 변경 시 필요하면 재구성, 반복 보호(10초 4회 → 에코 제거 끄고 재구성, 8회 → `onError`), DEBUG 진단 로그 `[duplex-diag]`. `app.json` 에 iOS 번들 ID 추가(prebuild 에 필요)
- 결과: 점검 화면 스피커(조각 100ms, 시험음 중 마이크 -62dB = 에코 제거 동작)·에어팟·통화 중 전환 통과, **F 스트리밍 통화 통과**(12턴, 에어팟 마이크 포함)
- **남은 문제**: F 통화에서는 스피커로 시작해도 반복 보호가 걸려 에코 제거가 꺼진 채 진행, 통화 도중 스피커로 바뀌어도 꺼진 채 남음 → G 전에 원인 확인·수정 필요
- 미실시: G·H(실제 OpenAI 필요), Android 전부, S4. 수정된 Swift 는 현슈 Mac 실기기 빌드로만 확인(서버·앱 JS 변경 없음)

### 실기기 2차 발견 수정·배포·성능·보안 (2026-10-19–22, 현슈, PR #2–#10 · `main` `3d72cad`, 상세: [HANDOFF.md](HANDOFF.md) 2절, [streaming-plan.md](streaming-plan.md) 4-2·4-3절)
- **배포**: AWS 시드니 EC2 + RDS + Docker Compose(Caddy), https://syncrew.hyunshu.com — 10/30 현장 시연, 10/31 삭제 ([deploy/README.md](../deploy/README.md))
- **노이즈 필터**: GTCRN 사이드카 `denoise/` + 서버 `STREAM_AUDIO_FILTER=sidecar` ([denoise-sidecar.md](denoise-sidecar.md)). 켤지는 CER 비교 후
- **스트리밍 (iPhone 실기기·시드니 서버에서 발견)**: 말 끝은 서버 VAD 만(수동 commit 제거), 반이중 메아리 차단(무음 대체) + 폰 재생 신호 `stream:playing`, 전사 전용 세션 `gpt-live-transcribe`(`STREAM_STT_MODEL`, 말하는 도중 자막), 스트리밍 용어집, 내 말 자막 `stream:mine:*`. 실제 OpenAI 는 `call-peer.ts` 스크립트끼리 확인(약 $0.18), **실기기 재확인 전**
- **성능**: 앱 번들 Android −18%·iOS −19%, 통화 화면 다시 그리기 감소, Socket.IO ping 10s+10s, 리샘플·base64 가속 ([perf-app-2026-10-20.md](perf-app-2026-10-20.md), [perf-network-2026-10-20.md](perf-network-2026-10-20.md))
- **보안**: Claude Security 검사 12건 중 9건 수정 + 화면 캡처 정적 서버. F12(LOW) 미해결
- 네이티브 모듈은 바뀌지 않음 → iOS 통화 시작 때 에코 제거가 꺼지는 문제는 그대로

### S3 Android 실기기 시험 (2026-10-23 새벽, 장태웅, Galaxy Note 9 Android 10 + Sony WH-1000XM6, 가짜 엔진, 상세: [device-test-log.md](device-test-log.md))
- 통과: 점검 화면(헤드셋 SCO 열림·스피커·전환), F 스트리밍 통화(헤드셋·스피커·통화 중 전환·종료), C 문장 단위 + 헤드셋 마이크(10-14 실패 해소), 같은 언어 통화
- 이어서 실제 OpenAI($0.413): **G 스피커 에코 루프 통과**, 통역 듣기(스트리밍·문장 단위 × 헤드셋·스피커) 통과, **H 통화 중 Wi-Fi 끊김 통과**(무선 adb)
- 버그 6개 수정(10-23 커밋): Android 11 이하 SCO 해제, 무음 -160 헤드셋 문장 단위 VAD, **스트리밍 `stream:pause` 때 서버가 무음 0.7초 주입**(원문 밀림 원인 — 서버 VAD 가 쉼을 못 봄), 발화 단위 통역 음성 통화 용도 재생(`playInCall`), expo-audio 스피커폰 강제 회피, 통신 모드 재지정·SCO 재연결. 상세 [streaming-plan.md](streaming-plan.md) 5-5절
- 시험: 서버 248(1 건너뜀), 앱 타입 검사·단위 46
- 남은 것: S4 휴대폰 2대, Android 12+ 기기, iPhone 에서 이번 변경 영향 확인

### 현장 용어 데이터: 은어 → 표준 한국어 + 공식 자료 반영 (2026-10-23, 장태웅, PR #13 병합, 상세: [field-terms.md](field-terms.md) 7절)
- 방침(사용자 결정): 언어별 데이터셋 대신 은어 → 표준 한국어 중심, 언어별 번역은 검증 문장·실측 오역 단어만
- 데이터 보충 (`server/data/legacy-workplace/supplement/`, 원본 파일은 그대로): 안전보건공단 유의어 사전 은어 210개(`kosha_slang.json`, 만드는 스크립트 `scripts/build-kosha-slang.ts`), 고용노동부 다국어 안전표지 검증 문장 19개 ko·vi·zh·uz(`moel_safety_signs_2025.json`). 데스라·아나방은 공단 기준으로 대체(사용자 결정)
- 코드: 용어에 `standardKo`(표준 한국어 뜻), 문장 단위 번역 문맥에 `= 표준어` 추가, 스트리밍 용어집에 "한국어 은어 = 표준어" 목록(원문 ko, 최대 60개, 용어와 합쳐 130개) → **ko→zh·ru·uz 스트리밍 용어집이 0개에서 은어 60개(+zh·uz 안전표지 문장 12개)**. 가장 긴 지시문 ko→vi 4,265자(상한 4,500)
- 발견·해결한 기존 문제: 원본 seed 가 표준어를 은어 변형으로 넣어 문장 단위 보정이 표준어를 은어로 바꿨다 (해체→바라시, 가로→요코, 반장→오야지, 어디→어디입니까 등). **보정은 받아쓰기 오인식형만(나) + 변형 목록에서 표준어·문장형 짧은 꼴 제거(가)** → 일상 문장 30개 중 바뀌는 문장 7 → 0. field-terms.md 7-4절
- 시험: 서버 **257**(+9) 통과·1 건너뜀

### 스트리밍 은어: 턴 용어 실험 → 은어 목록 전체로 (2026-10-24, 장태웅, PR #13 병합, 실제 OpenAI $0.407 → 누적 $1.157, 상세: [field-terms.md](field-terms.md) 8절)
- 실험(`scripts/stream-turn-terms.ts`, 엔진 옵션 `turnTerms` 기본 off): 말하는 도중 자막에서 은어를 찾아 넣는 방식은 **자막(gpt-live-transcribe)이 은어를 잘못 받아써** 효과 없음 (목록 밖 은어 7문장: off 2 · update 1 · create 3 맞음)
- 적용: 미리 넣는 은어를 60개 → **230개 전부**(한 줄 20개 묶음), 지시문 상한 4,500 → 7,500자 → 같은 문장 **5/7 맞음**, 첫 음성 중앙값 2.65초(늘지 않음, 9문장 1회)
- 이어서 받아쓰기 keywords 에 은어 230개(상한 50 → 400, OpenAI 가 325개까지 받아들임 확인, $0.109 → 누적 $1.266): 원문 자막의 은어 0–1 → **4/11**, 번역 6/7. 부작용 후보(비슷한 은어로 끌림, 평범한 문장·ko→vi 미측정)는 S6 에서. 턴 용어는 지금 얻을 것이 적어 다시 하지 않음 (field-terms.md 9절)
- 남은 것: 더 많은 문장·평범한 문장으로 측정(S6)

### S3 iPhone 실기기 확인 (2026-10-24 새벽, 장태웅, iPhone 17 Pro + AirPods Pro, 무선 설치·로그, 상세: [device-test-log.md](device-test-log.md) 10-24, [streaming-plan.md](streaming-plan.md) 5-7절)
- 통과: PR #12(경로 변경 때 에코 제거 다시 켬, 통화 중 세션 덮어쓰기 막기), 에어팟↔스피커 전환, H Wi-Fi 끊김 재연결(약 12초), **G 스피커 에코 루프(실제 OpenAI, 되돌아간 턴 0 — 서버 반이중 차단)**, 문장 단위 녹음·통역 재생(스피커·에어팟, 실제 OpenAI)
- 미해결: 스피커에서 에코 제거가 2–4초 뒤 꺼짐 — voice processing 출력만 44.1kHz(입력 48kHz)로 잡혀 재구성 반복. 표본률 수정 2번(세션 표본률 맞추기, 세션 껐다 켜기) 효과 없어 되돌림 → 조현수. 시연 지장 없음
- 비용: 실제 OpenAI $0.086 (누적 $1.351). 코드 변경 없음(시험용 수정은 되돌림)

- **기준선 (2026-10-22, 이 PC, pull 직후)**: 서버 타입 검사 + 시험 248 통과·1 건너뜀, 앱 타입 검사 + 단위 46 통과. e2e 는 다시 돌리지 않음

### iOS 에코 제거 꺼짐 수정 (2026-10-23 낮, 현슈, 실기기 없이, 브랜치 `fix/ios-echo-cancellation`, 상세: [streaming-plan.md](streaming-plan.md) 5-6절)
- 네이티브 `SyncrewDuplexModule.swift`: 반복 보호를 앱 요청과 분리(`vpSuppressed`) → 헤드셋 연결·해제 등 실제 장치 변경 때 에코 제거를 다시 켬. 통화 세션(`playAndRecord`/`voiceChat`)이 덮어써지면 되돌리고 `onError` `session_overwritten`. `onRoute` 에 `voiceProcessing` 추가
- 앱: `src/audio/sessionOwner.ts`·`audioMode.ts` — iOS 스트리밍 통화 중 expo-audio 모드 변경을 막음(녹음 켜기는 이중 오디오가 멈출 때까지 기다림). `useHandsFree`·`useVoiceRecorder`·`useAudioRouteProbe`·`playback` 이 `setAudioMode()` 를 쓴다
- 시험: 앱 타입 검사, 단위 **52**(새 6), Swift 모듈 기기용 컴파일. 서버는 바뀌지 않음. **미검증: 실기기 전부** (`docs/testguide.md` 4-12절)

### S4·현장 용어 정확도·시드니 배포·에코 제거 후보 장치 (2026-10-24 낮 – 10-25, PR #15–#17 · `main` `9e0487f`, 상세: [HANDOFF.md](HANDOFF.md) 1절, [field-accuracy.md](field-accuracy.md))
- ✅ S4 휴대폰 2대 통화 (Note 9 ↔ iPhone 17 Pro, 이 PC 서버, 실제 OpenAI), 말 없는 턴 버리기(PR #15)
- ✅ 현장 문장 400개 측정 3회 → 기본값 무음 350ms·추론 low, 정확도 90.7%, 지연 vi 1.89·zh 1.85초 (PR #16). OpenAI 누적 $17.26
- ✅ 시드니 서버 `bf22f8b` 배포 (10-24 오후, 조현수)
- 🟡 iOS 스피커 에코 제거 후보 5개 시험 장치 (PR #17, 현슈, `EXPO_PUBLIC_DUPLEX_EXPERIMENTS`, DEBUG 빌드만) — **실기기 확인 전**, `docs/testguide.md` 4-13절
- 기준선 (10-25, 이 PC): 서버 262 통과·1 건너뜀, 앱 단위 52 통과. 이 PC 서버 OpenAI 한도 $20 (사용자 지시)

## 2. 다른 개발자 연결 지점

| 담당 | 연결 지점 | 계약 |
|---|---|---|
| 딥러닝 노이즈 필터 | `server/src/plugins/audioPreprocessor.ts` (서버) 또는 `frontend/src/audio/preprocess.ts` (단말, 녹음 직후 호출 — 현재 그대로 반환) | `AudioPreprocessor.process(PcmAudio) → PcmAudio` / `preprocessRecording(uri) → uri` |
| 데이터 보존 정책 | `server/src/plugins/retentionPolicy.ts` | `RetentionPolicy.run(ctx)` |
| 현장 데이터셋 | `server/src/plugins/datasetAdapter.ts`에 어댑터 등록 또는 정규화 JSON 제공(`DATASET_ADAPTER=normalized-json`) | `DatasetAdapter.load() → {lexicon, phrases}` |

## 3. 남은 확인사항

1. ~~노이즈 필터 실행 위치~~ → **서버** (2026-10-14 사용자 결정). 연결 지점 두 개 준비 완료(발화 단위 `AUDIO_PREPROCESSOR`, 스트리밍 `STREAM_AUDIO_FILTER`). 스트리밍 필터는 GTCRN 사이드카(`denoise/`, #4) + 서버 연결(`sidecar`, #6) 완료 (2026-10-19). 남은 것: 발화 단위 필터(`AUDIO_PREPROCESSOR`), 받아쓰기 CER 비교로 사이드카를 켤지 결정
2. Supabase 대시보드에서 비밀번호 재설정 메일의 앱 딥링크(`syncrew://reset-password`) Redirect URL 허용 — 사용자 확인 필요 (프로젝트 URL·키는 `.env`에 입력 완료)
3. 앱 실행 검증: Android 에뮬레이터·iOS 시뮬레이터 준비 완료(2026-10-12). 실기기는 추후
4. ~~OpenAI API 키 입력~~ — 2026-10-12 입력 완료. 한도 $0.5 누적 (잔액 $1.44, 사용자 지시)
5. ~~실제 Supabase 계정 토큰으로 API·실시간 연결 확인~~ — 2026-10-12 완료 (live e2e 27개)
