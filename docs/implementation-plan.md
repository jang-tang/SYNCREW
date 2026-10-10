# 구현 계획 (MVP)

## 0. 진행 규칙

- Phase 단위로 구현하고, 각 Phase 종료 시 구현 내용, 변경 파일, 실행한 테스트와 결과, 미검증 항목, 알려진 문제를 보고한다.
- 아키텍처·기술 스택·DB 구조의 큰 변경은 이유와 대안을 먼저 설명하고 승인을 받는다.
- 기존 저장소는 수정하지 않는다. 데이터셋만 `server/data/legacy-workplace/`로 원본 복사한다.

## 1. Phase 요약

| Phase | 목표 | 선행 |
|---|---|---|
| 1 | 프로젝트 기반 + 통역 엔진 골격 | — |
| 2 | 인증·현장·멤버십 | 1 |
| 3 | 실시간 통신 (Socket.IO) | 2 |
| 4 | 통역 파이프라인 + 1:1 대화 | 3 |
| 5 | N:N 그룹 대화 + 1:N 일괄 지시 | 4 |
| 6 | 안정화·실기기 검증 | 1–5 |

## Phase 1. 기반 — 구현 완료 (2026-10-10, 검토 대기)

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

## Phase 2. 인증·현장·멤버십

- 작업
  - 서버: Supabase JWT 검증 미들웨어, `/me`, 현장 CRUD, 가입 코드, `/join`, 멤버 승인/거절/제외/언어 수정, `requireMembership`
  - 앱: Supabase 로그인·회원가입·비밀번호 재설정, 프로필 설정, 현장 선택·생성·가입(코드 입력, QR 스캔), 가입 대기, 멤버 탭, 가입 코드·QR 화면
- 완료 기준: 시나리오 1–4, 11 API 통합 테스트 통과, 앱에서 관리자·구성원 계정으로 가입~승인 흐름 수동 확인
- 위험: Supabase 재설정 메일 딥링크 설정

## Phase 3. 실시간 통신

- 작업
  - Socket.IO `/rt` 네임스페이스, 핸드셰이크 인증, `user:` 자동 참여, `site:subscribe` 권한 검증
  - `membership:changed`, `join:requested`, `presence:changed`, `auth:expired`, `sync:required`
  - `GET /sync`
  - 앱: 전역 소켓 연결, 상태 바, 재연결 시 재구독·동기화, 이벤트 → 쿼리 캐시 반영
- 완료 기준: 소켓 통합 테스트(인증 거부, 권한 없는 구독 거부, 제외 시 즉시 차단 = 시나리오 12) 통과
- 위험: Android 백그라운드 전환 시 연결 끊김 → 포그라운드 복귀 시 동기화로 보완

## Phase 4. 통역 파이프라인 + 1:1 대화

- 작업
  - 엔진: 오디오 디코딩(ffmpeg-static), `OpenAiStt`, `RealtimeTranslator`(`gpt-realtime-2`, 서버 WebSocket, 텍스트+음성 출력), WAV 변환, 로컬 디스크 저장, 모든 호출에 BudgetGuard 적용
  - 서버: 메시지 테이블 3종, 팬아웃 작업 큐(동시성 제한), 재시도, 재시작 복구, 1:1 대화 API, 메시지 전송·조회·재시도, 음성 URL, `message:new`/`message:status`/`receipt:delivered`
  - 앱: 대화 목록·대화 화면, 누르고 말하기 녹음, `preprocessRecording` 훅, 자동 재생 대기열, 기기 TTS 대체, 실패 재시도
  - 실기기: 블루투스 헤드셋 녹음 경로 확인, 필요 시 config plugin 추가
- 완료 기준: 시나리오 5, 6, 13, 14, 15 통과(자동은 Fake 엔진), 실제 OpenAI로 5개 언어 왕복 수동 확인, 단계별 지연 측정 기록
- 위험: Realtime 세션 연결 지연, 우즈베크어 번역·음성 품질, 블루투스 마이크 입력

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
2. Phase 2 시작 전: Supabase 대시보드에서 비밀번호 재설정 메일의 앱 딥링크(`syncrew://`) Redirect URL 허용 (프로젝트 URL·키는 2026-10-10 `.env`에 입력 완료)
3. 앱 실행 검증을 위한 Android SDK(에뮬레이터) 또는 실기기 준비 (사용자가 추후 준비)
