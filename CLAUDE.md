# SYNCREW (SyncField) — 작업 안내

건설·제조 현장 외국인 작업자와 관리자를 위한 **AI 실시간 통역 모바일 서비스** MVP.
안전모 부착 모듈(일반 블루투스 헤드셋) + Android 앱 + 로컬 서버.
상세 설계는 `docs/` 9개 문서가 기준이다. 작업 전 관련 문서를 먼저 읽을 것.

## 진행 방식 (사용자 지시)

- **Phase 단위로 구현하고, Phase가 끝나면 멈춰서 검토·승인을 받는다.** 승인 전 다음 Phase 시작 금지.
- Phase 완료 보고: 구현 기능, 변경 파일, 실행한 테스트와 결과, 실제 동작 확인한 것, 미검증 항목, 알려진 문제, 다음 단계.
- 아키텍처·기술 스택·DB 구조의 큰 변경은 이유와 대안을 먼저 설명하고 승인받는다.
- 실행하지 않은 테스트를 통과했다고 보고하지 않는다. 결정이 바뀌면 `docs/`도 함께 고친다.
- 응답은 한국어.

## 현재 상태 (2026-10-13, Phase 7 B1·S0 ①·S1 세션 이후)

| 단계 | 상태 | 커밋 |
|---|---|---|
| Phase 1 기반 (서버·엔진 골격·비용 한도) | 완료 | `9371620` |
| 프론트엔드 전체 화면 (데모 모드) | 완료 | `3fea4e7` |
| Phase 2 인증·현장·멤버십 (서버) | 완료 | `c637a6b` |
| Phase 3 실시간 (Socket.IO) | 완료 | `92e3620` |
| Phase 4 통역 파이프라인 + 1:1 대화 | 완료 (Fake 엔진 검증. 실제 OpenAI 확인은 키 입력 후) | `fd2caf0` |
| Phase 5 실시간 통역 (1:1 통화 + 실시간 일괄 지시) | 완료 (기기 확인 일부는 추후) | `d7f29a4` |
| Phase 6 안정화 + 실제 OpenAI + live 모드 + 기기 확인 | 완료 (실기기·블루투스는 추후) | `022f261` |
| Phase 7 진짜 스트리밍 통역 (1:1 통화) + 일괄 지시 대상 선택 UX | 진행 중: B1·S0 ①·S1 완료 (`b1eb6d6`), **S2 웹 검증 클라이언트 완료 (2026-10-14, 실제 OpenAI 확인 포함)**. 다음: S3 (실기기 필요) | `713c5e3` |

- 진행 현황·검증 결과·미검증 항목의 기준 문서: `docs/implementation-plan.md` (Phase가 끝날 때마다 갱신).
- 실시간: `server/src/realtime/gateway.ts`가 `DomainEvents`를 Socket.IO로 구현하고 서버 시작 시 `context.events`를 교체한다. 라우트는 반드시 호출 시점의 `context.events.*`를 쓴다(구조 분해로 미리 꺼내면 noop이 남음).
- 통역: `server/src/messaging/pipeline.ts`(작업 큐), 엔진은 `context.stt`·`context.translator`(키 없으면 null, `ENGINE=fake`면 가짜). 메시지 생성은 `messaging/createMessage.ts` 하나로 (대화·통화 발화·지시 공통).
- 앱은 `EXPO_PUBLIC_API_MODE=mock`(기본)으로 서버 없이 동작. 서버 API·이벤트는 `server/src/shared/api.ts`·`realtime.ts` 계약과 `frontend/src/services/live/*` 호출에 맞출 것. 계약을 바꾸면 앱 mock 구현(`frontend/src/services/mock/`)도 함께 고친다.
- 설정 완료: Supabase URL·키(`server/.env`, `frontend/.env`), **OpenAI API 키(2026-10-12 입력)**.
- **OpenAI 비용 (가장 중요)**: 2026-10-12 잔액 $1.44에서 시작해 "아껴 쓰고 실제 호출 전 비용을 먼저 말할 것"이 사용자 규칙. 2026-10-13 사용자가 충전하고 서버 한도를 `OPENAI_BUDGET_USD=3`(`OPENAI_BUDGET_PERIOD=total` 누적)으로 올리는 것을 승인. **2026-10-14 누적 $0.2602.** 한도를 더 올릴 때는 금액을 먼저 알리고 승인받는다. 스트리밍 실호출은 턴당 약 $0.01, 말한 1분당 약 $0.18. 흐름 확인은 `ENGINE=fake`(비용 0), 실제 확인은 실행 상한을 걸어(`OPENAI_BUDGET_USD=<누적+여유>`로 서버 실행) 최소로.
- **Phase 7 S0 보고: `docs/s0-report.md`** (① OpenAI 스트리밍 실측: 말 끝 → 첫 번역 음성 P50 1.83초, 비용·토큰·함정 문장·세션 끊김 1회, ② 실기기 절차·후보 조사, 3절 계획 변경 제안 P1–P7). B1 결과는 `docs/implementation-plan.md` Phase 7.
- Phase 6 정리 문서: `docs/phase6-report.md` (실제 OpenAI 결과·비용·지연, 기기 확인, 시나리오 1–17·A–G 결과표, 알려진 문제, 결정 필요 사항). 운영 문서: `docs/operations.md` (설치·실행·비용·플러그인 연결·확인 도구).
- Phase 4 정리 문서: `docs/phase4-report.md` (결정·비용 추정·검증·에뮬레이터 실행 방법).
- Phase 5 실시간 통역: `docs/live-interpretation.md` (핸즈프리 발화 단위 방식, 세션 API, VAD, 이어폰 처리, 검증·미검증). 세션 서비스 `server/src/sessions/liveSessions.ts`, 앱 `frontend/src/audio/useHandsFree.ts`.
- 검증 완료(2026-10-12): 실제 OpenAI 5개 언어 왕복, 서버 경로 지연(업로드 → 상대 수신 5.1초, 말 끝 기준 약 6초), live 모드 2인 e2e 27개(웹 빌드 + 실제 Supabase 계정 + 실제 서버), 에뮬레이터 일괄 지시·통화, iOS 시뮬레이터 실행.
- 테스트 계정(사용자 허락, 2026-10-12): `syncrew-e2e-manager@example.com`, `syncrew-e2e-member@example.com`. 비밀번호는 `server/.e2e-accounts.json`(git 제외). 삭제는 `npx tsx scripts/e2e-accounts.ts --delete`.
- 미검증: 실기기(휴대폰 2대) + 블루투스 헤드셋, 네이티브 앱 live 모드(휴대폰 → PC 서버).

## 남은 일 (우선순위 순, 2026-10-13 갱신)

**다음 작업: Phase 7 = 진짜 스트리밍 통역 (1:1 통화만) — 사용자 승인 완료 (2026-10-12). 계획·결정: `docs/streaming-plan.md` (0-1절 결정, 7절 단계).**

1. **S2 완료 (2026-10-14, `docs/streaming-plan.md` 5-1절)** — 실제 OpenAI 확인 2회($0.0253)에서 앱 전송 버그(volatile emit 으로 조각 손실) 발견·수정. 다음은 **S3 네이티브 오디오** (iOS·Android 실기기 필요 — 최소 iPhone 1 + Android 1 + HFP 헤드셋 1, 2인 통화(S4)는 2대. 사용자: 실기기 준비는 아직 어려움). 앱의 `frontend/src/audio/duplex/index.ts` 가 iOS·Android 에서 null 이라 지금 휴대폰 앱은 발화 단위 방식으로 통화한다.
   - (아래는 S2 작업 지시 원문, 완료됨)
   - 설계: `docs/streaming-plan.md` 5절 + 0-2절 결정표, 서버 계약: `docs/realtime-protocol.md` 10절·`server/src/shared/realtime.ts`
   - 앱 `frontend/src/audio/duplex/`: `DuplexAudio` 인터페이스(계획 2절 D2) + 웹 구현(AudioWorklet 16kHz 캡처 + Web Audio 24kHz 조각 재생). `useStreamingCall` 훅(단말 VAD 게이트 `audio/vad.ts` 재사용, 앞 0.3–0.5초 사전 버퍼·말 멎은 뒤 0.6초 더 보내고 `stream:pause`), 통화 화면 실시간 자막(원문·번역), `stream:open` 이 ok 가 아니거나 `stream:fallback` 이면 기존 `useHandsFree`(발화 단위)로 전환
   - **필수**: 스트림으로 이미 들은 문장은 `stream:out:end` 의 messageId 를 기억해 두고, 같은 id 의 `message:new` 가 와도 **다시 재생하지 않는다** (기록에는 표시)
   - 같은 언어 통화는 `mode: "relay"` — 받은 음성을 그대로 재생(자막·기록 없음)
   - mock 모드(`frontend/src/services/mock/`)에도 스트림 흉내를 넣을지 결정 (계약을 바꾸면 mock 도 고치는 규칙)
   - 검증: 헤드리스 Chrome 2인 e2e(가짜 마이크 + `--disable-features=AudioServiceSandbox`, `ENGINE=fake` 서버) — 말하는 동안 전송·상대 재생·자막·기록·중복 재생 없음(대조군)·폴백. 기존 e2e(데모 75·live 29·마이크) 회귀. 마지막에 실제 OpenAI 1–2회(약 $0.05–0.1, **실행 전 비용 안내·승인**)
   - **S1 완료(2026-10-13)**: `server/src/streaming/`, 결과·결정은 `docs/streaming-plan.md` 4-1절. 사용자 결정: 같은 언어 통화는 OpenAI 없이 직접 전달(구현됨), 실패한 문장은 기록 안 함, 용어집 미리 넣기 보류
   - 2026-10-13 사용자 결정: 목표 **P50 ≤ 2.0초·P90 ≤ 3.0초**(1.5초는 S6 목표), **OpenAI 세션 안 문맥은 응답마다 모두 삭제하고 직전 1–2문장을 텍스트로 지시문에 넣는다**(우리 DB 기록은 그대로 저장), OpenAI 충전 완료, **실기기·헤드셋 검증(S0 ②)은 앞에서 빼고** 라이브러리 확인은 S3·헤드셋은 S6에서.
   - 승인(2026-10-13): P1 server_vad(무음 500ms), P5 원문 전사 용어 보정, P6 세션 끊김 → 재연결, 반복 시 발화 단위 폴백, P7 S6에서 추론 minimal 실험.
   - **실기기 시험 방식 (사용자 결정)**: 먼저 구현해 두고 **2026-10-13 오후부터 실기기 시험하며 고친다**. S3은 1순위 라이브러리(react-native-audio-api 1.0)로 바로 구현, 블루투스 헤드셋도 그 시험에서 함께 확인.
   - 서버 한도: **$3 누적으로 상향 적용 (2026-10-13 승인)**. 더 올릴 때는 금액을 먼저 알리고 승인받는다.
   - **시험은 iOS·Android 모두에서 확인한다 (사용자 지시 2026-10-13).**
2. 이후 S2 웹 검증 클라이언트 → S3 네이티브 오디오(1순위 라이브러리로 먼저 구현 → 실기기·헤드셋 시험에서 수정, `docs/s0-report.md` 2절) → S4 1:1 통화 통합(휴대폰 2대) → S6 실기기 튜닝(블루투스 헤드셋 포함). 음성 경로는 **A안(우리 서버 경유, Socket.IO + PCM)**, 발화 단위 방식은 폴백으로 유지
3. **일괄 지시 대상 선택 UX 개선 (사용자 요청)**: B1 **완료 2026-10-13** (`frontend/src/components/RecipientPicker.tsx`, 결과는 `docs/implementation-plan.md` Phase 7), B2(작업조 저장 — DB 변경이라 시작 전 별도 승인). 일괄 지시 자체는 **발화 단위 방식 유지**(지연 허용, 스트리밍 S5 취소). 시작 시점은 사용자와 정함 (`docs/streaming-plan.md` 8-1절)
4. 남은 안정화: iOS 시작 화면 로고 "Sync" 글자가 어둡게 보임(웹 정상, 원인 미조사), 서버 재시작 시 세션 정리(`closeStale`)·시작 복구 연결 자동 테스트, 업로드 MIME 허용 목록, 실제 청구액과 `openai_usage` 대조
5. 우즈베크어 통역 품질 — **사용자 결정: 일단 보류**
6. 결정·준비 필요: 실기기 구성·Apple 계정(iOS 실기기 설치, S3 전), 충전 잔액 확인(한도 $3는 잔액의 절반 이하가 원칙. 키 교체했다면 `server/.env`도), 프로젝트 영문 경로 이동(S3 전 권장), Supabase 재설정 메일 딥링크, 노이즈 필터 실행 위치, UI 문구 원어민 검수
7. 추후 개선: 백그라운드 통화 유지, 그룹 실시간 통역, 푸시 알림

## 새 세션 시작 순서

1. 이 파일(특히 "남은 일"·OpenAI 비용 규칙), **`docs/streaming-plan.md`(Phase 7 계획·결정)**, **`docs/s0-report.md`(S0 결과·다음 절차)**, `docs/phase6-report.md`, 필요하면 `docs/operations.md`를 읽는다.
2. `git log --oneline | head -5`와 `git status`로 상태를 확인한다. (B1·S0 ①·S1 은 `b1eb6d6` 로 커밋·푸시됨. 이후 변경은 사용자가 요청할 때 커밋)
3. 기준선 확인 (비용 0): `cd server && npm run typecheck && npm test` (**182개** 통과해야 함), `cd frontend && npm run typecheck && npm run test:unit` (**17개**).
4. 사용자가 "남은 일" 중 무엇을 진행할지 확인한다. live e2e는 `ENGINE=fake` 서버로 비용 없이 다시 돌릴 수 있다 (`docs/operations.md` 6절).
5. **실제 OpenAI를 부르는 작업은 하기 전에 예상 비용을 말하고 승인받는다** (서버 한도 $0.5 누적 중 $0.2348 사용). 확인 스크립트: `cd server && npx tsx scripts/openai-check.ts` (1회 약 $0.05), 스트리밍 측정 `npx tsx scripts/stream-measure.ts --dry-run`으로 예상 비용 먼저 (턴당 약 $0.01).
6. 작업을 끝내면: `docs/phase6-report.md`(또는 새 보고 문서)·`docs/implementation-plan.md`와 이 파일의 상태 표를 갱신하고 보고한 뒤 멈춘다. 커밋·푸시는 사용자가 요청할 때 한다 (커밋 전 `git grep --cached -nE "sk-proj-|sb_secret_"`로 키 혼입 검사).

## 이 PC 환경 (작업 전 알아 둘 것)

- Docker·Postgres 미설치 → 로컬 DB는 `embedded-postgres`(`npm run db:start`, 포트 5433, 데이터 `server/.pgdata/`). 테스트는 매번 임시 Postgres(포트 54331)를 따로 띄운다.
- Android 에뮬레이터(`Pixel_9_Pro_XL`, SDK `~/Library/Android/sdk`)와 Xcode iOS 시뮬레이터 설치됨 (2026-10-12). 개발 빌드(`expo run:*`)로 실행한다. 명령은 `docs/phase4-report.md` 7절.
  - **Android 빌드는 JDK 21** (`/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home`). 기본 JDK 26·Android Studio JDK 25는 CMake 단계에서 실패.
  - **iOS는 한글 경로에서 `pod install` 실패** (hermes-engine.podspec 인코딩 오류) → 영문 경로 복사본에서 네이티브만 빌드하고 JS는 원래 폴더 Metro로 제공.
  - 시뮬레이터 조작 도구가 없어 iOS는 화면 캡처만 가능. Android는 `adb shell input`으로 조작.
  - **디스크 여유 공간이 적다** (2026-10-13 기준 약 22GB). Android 빌드(Gradle)·iOS 빌드(Pods, 영문 경로 복사본 ~5GB)는 공간을 많이 쓰므로 빌드 전 `df -h /System/Volumes/Data`로 확인하고, 작업 후 복사본을 지운다.
  - 에뮬레이터 마이크로는 실제 말소리가 들어오지 않았다 → 말소리 자동 감지는 웹 가짜 마이크(`npm run e2e:mic`)로 확인했고, 최종은 실기기.
  - 에뮬레이터 조작: uiautomator 화면 구조(`adb shell uiautomator dump`)에서 글자로 좌표를 찾아 `adb shell input tap`. 개발 빌드는 에뮬레이터에 설치돼 있으므로 Metro만 띄우면 된다 (`docs/phase4-report.md` 7절).
  - `expo start`가 `frontend/tsconfig.json`을 자동으로 고쳐 쓴다 → 작업 후 `git checkout -- frontend/tsconfig.json`.
  - 빠른 확인은 기존대로 타입 검사 + `expo-doctor` + 번들 빌드 + **웹 빌드 헤드리스 Chrome 자동 검증**(`frontend/e2e/`).
- Node 22, npm. Chrome은 `/Applications/Google Chrome.app` (e2e가 사용).
- 헤드리스 Chrome은 비밀번호 입력 뒤 실제 키 이벤트를 잃는 현상이 있다(앱 버그 아님). e2e는 글자를 IME 경로로 입력한다.
- 헤드리스 Chrome 가짜 마이크에 음성 파일을 넣으려면 `--disable-features=AudioServiceSandbox` 필요 (없으면 무음).
- 웹 빌드는 Metro 캐시가 mock/live 설정을 섞으므로 `--clear`로 만든다 (`bundle:web`, `bundle:web:live`에 반영됨).
- Supabase 관리자 API로 계정을 만드는 명령은 이 PC의 자동 권한 확인에서 "외부 시스템 쓰기"로 거부될 수 있다 → 사용자 허락을 받고 실행한다.
- 웹 빌드의 음성 업로드는 Blob으로 붙여야 한다 (RN 전용 `{uri,name,type}` 형식은 웹에서 깨짐, `frontend/src/services/live/httpApi.ts`).

## 확정된 결정사항

| 항목 | 결정 |
|---|---|
| 폴더 | `frontend/`(Expo 앱), `server/`(Express) 두 개. 모노레포 아님 |
| 통신 모드 | 1:1(direct), N:N(현장당 그룹 대화 1개, 승인 시 자동 참여), 1:N(관리자 일괄 지시 + 확인·완료 응답) |
| 계층·역할 | 현장(Room) 아래 관리자(manager) / 구성원(member). 조직 계층 없음 |
| 인증 | Supabase Auth, 이메일+비밀번호만 (이메일 없는 작업자 대응 안 함). 서버는 JWKS로 JWT 검증 |
| 데이터 저장 | 로컬 Postgres(`embedded-postgres`) + Prisma 7. Supabase에는 데이터 저장 안 함. 음성 파일은 서버 로컬 디스크 |
| 호스팅 | 로컬 PC. 휴대폰은 같은 Wi-Fi로 접속 |
| 언어 | ko, zh, vi, uz, ru |
| 번역 모델 | `gpt-realtime-2.1` (2026-10-12 `gpt-realtime-2`에서 교체, 같은 가격. 서버→OpenAI Realtime WebSocket, 음성+전사 출력). STT는 `gpt-4o-mini-transcribe` 기본 |
| 비용 | BudgetGuard가 모든 호출을 감쌈. 기본 $5/월이었으나 **2026-10-12부터 $0.5 누적** (잔액 $1.44 기준, 그 이상 사용 금지. 10-13 누적 $0.2348) |
| 현장 특화 처리 | 로직만 구현, 데이터셋은 어댑터로 교체 (기존 저장소 데이터는 샘플). 제조업 데이터여도 무방 |
| 노이즈 필터 / 보존 정책 | 다른 개발자가 구현 → 플러그인 인터페이스만 제공 (`server/src/plugins/`) |
| 블루투스 | 일반 헤드셋으로 취급 |
| 제외 | 위험도 감지, 긴급 문장 원탭 전송, 구독·결제, 푸시 알림(추후) |
| UI | 기존 PoC UI 사용 안 함, 새로 제작 |

## 구조와 규칙

- `server/src/shared/`: 앱과 공유하는 계약. **외부 패키지 import 금지** (앱이 `@shared/*`로 직접 참조).
- `server/src/engine/`: 통역 엔진 (domain, dataset, audio, stt, translation, budget).
- `server/src/plugins/`: 교체 가능한 구현 등록 지점 (노이즈 필터, 데이터셋, 보존 정책).
- `server/src/routes/v1/`: REST API. 모든 경로는 `requireAuth`(Supabase 토큰), 현장 경로는 `requireMembership`(활성 멤버만, 비멤버 404·역할 부족 403).
- 실시간 테스트는 `createRealtimeTestApp()`(임의 포트 HTTP + Socket.IO)과 `nextEvent`/`noEvent`를 쓴다. "받지 않아야 함" 검사는 반드시 같은 상황에서 받는 대조군과 함께 쓴다.
- 서버 테스트는 사용자를 무작위 UUID로 만들어 테스트 파일끼리 데이터가 섞이지 않게 한다 (`server/test/helpers/testApp.ts`: 테스트용 ES256 토큰 발급).
- 서버 요청 검증은 zod, 오류 응답은 `{error:{code,message}}` (코드: `server/src/shared/api.ts`).
- 상태 변경은 REST, 서버→앱 알림은 Socket.IO (`docs/realtime-protocol.md`).
- 앱 화면은 `frontend/src/app` (expo-router). 디자인 토큰 `frontend/src/theme.ts`, UI 문구는 `frontend/src/i18n/strings.ts`(5개 언어 모두 채울 것). Expo 패키지는 `npx expo install`로 설치. `frontend/AGENTS.md` 참고 (Expo는 SDK마다 API가 바뀌므로 문서 확인).
- 비밀 값: `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`는 `server/.env`에만. 앱에는 publishable key만.
- Prisma가 AI의 `migrate reset`을 사용자 동의 없이 차단한다. 우회하지 말고 새 마이그레이션을 추가할 것.

## 실행과 검증

```bash
# 서버
cd server && npm run db:start                    # 터미널 1: 로컬 Postgres (localhost:5433)
cd server && npm run db:deploy && npm run dev    # 터미널 2: http://0.0.0.0:4000/health
cd server && npm run typecheck && npm test       # 테스트 182개 (임시 Postgres·실제 Socket.IO 통합 테스트, 스트리밍 25 포함)
cd server && ENGINE=fake npm run dev             # OpenAI 없이 가짜 통역 (비용 0)
cd server && npx tsx scripts/openai-check.ts     # 실제 OpenAI 5개 언어 왕복 (약 $0.05, 승인 후)
cd server && npx tsx scripts/stream-measure.ts --dry-run   # S0 스트리밍 측정 계획·예상 비용 (비용 0). 실제 실행은 승인 후 (턴당 약 $0.01, --max-usd 상한)

# 앱
cd frontend && npm run typecheck && npm run doctor
cd frontend && npm run bundle:android            # Android 번들 빌드 확인
cd frontend && npm run test:unit                 # 단위 테스트 17개 (VAD 11 + 일괄 지시 대상 선택 6)
cd frontend && npm run bundle:web && npm run e2e # 데모 모드 사용 흐름 75개 자동 검증 (통화·일괄 지시·대상 선택 포함)
cd frontend && npm run e2e:screens               # 주요 화면 캡처 → e2e/output/screens/
cd frontend && npm run e2e:mic                   # 실제 말소리로 핸즈프리 자동 전송 + 무음 대조군 (bundle:web 후)
cd frontend && npm run bundle:web:live && npm run e2e:live   # live 모드 2인 e2e 35개 (통화는 스트리밍. E2E_STREAMING=off 폴백 33개, E2E_ONLY_CALL=1 통화만 21개) (ENGINE=fake 서버 실행 중이어야 함)
cd frontend && npm run e2e:latency               # 서버 경로 지연 1회 (ENGINE=openai면 약 $0.006, 승인 후)
```

- 백그라운드로 띄운 DB·서버는 작업이 끝나면 **반드시** 종료한다: 서버 `pkill -f "src/index.ts"` (`npm run dev` 는 `tsx watch src/index.ts` 라 "tsx src/index.ts" 패턴으로는 안 죽는다), DB `pkill -INT -f scripts/db.ts` 후에도 postgres 가 남으면 `cd server && node_modules/@embedded-postgres/darwin-arm64/native/bin/pg_ctl -D .pgdata stop -m fast`. 확인: `lsof -nP -iTCP:4000 -sTCP:LISTEN`, `lsof -nP -iTCP:5433 -sTCP:LISTEN` 이 비어 있어야 한다 (2026-10-13 확인).
- `dist-check/`, `dist-live/`, `e2e/output/`, `server/.e2e-accounts.json`은 커밋하지 않는다(.gitignore).

## 참고

- GitHub: https://github.com/jang-tang/SYNCREW (`main`). `.env`는 루트 `.gitignore`로 제외. 커밋 전 키가 섞이지 않았는지 확인할 것.
- 원본 통역 저장소: https://github.com/jecool0523/workplace-translation-mvp (분석: `docs/current-codebase-analysis.md`). 수정하지 않는다.
- 발표 PDF: `싱크필드_20260909 최종본.pdf` (대한민국 청소년 창업경진대회, 팀 SyncField).
