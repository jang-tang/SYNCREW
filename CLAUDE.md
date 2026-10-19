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

## 현재 상태 (2026-10-17, Phase 7 S3 구현 완료·실기기 시험 전, 실기기 없이 할 일은 모두 끝남 — 인수인계: `docs/HANDOFF.md`)

| 단계 | 상태 | 커밋 |
|---|---|---|
| Phase 1 기반 (서버·엔진 골격·비용 한도) | 완료 | `9371620` |
| 프론트엔드 전체 화면 (데모 모드) | 완료 | `3fea4e7` |
| Phase 2 인증·현장·멤버십 (서버) | 완료 | `c637a6b` |
| Phase 3 실시간 (Socket.IO) | 완료 | `92e3620` |
| Phase 4 통역 파이프라인 + 1:1 대화 | 완료 (Fake 엔진 검증. 실제 OpenAI 확인은 키 입력 후) | `fd2caf0` |
| Phase 5 실시간 통역 (1:1 통화 + 실시간 일괄 지시) | 완료 (기기 확인 일부는 추후) | `d7f29a4` |
| Phase 6 안정화 + 실제 OpenAI + live 모드 + 기기 확인 | 완료 (실기기·블루투스는 추후) | `022f261` |
| Phase 7 진짜 스트리밍 통역 (1:1 통화) + 일괄 지시 대상 선택 UX | 진행 중: B1·S0 ①·S1·S2·B2·안정화·실기기 없이 할 일 완료 (10-14). **실기기 준비·T2 기준선 (10-14–15): Android·iPhone A·B 통과, iPhone 헤드셋 통과, Android 헤드셋 마이크 무음 → S3. 실기기 버그 6개 수정** (`docs/implementation-plan.md` T2 절). **S3 구현 (10-15 새벽): 자체 Expo 모듈 `frontend/modules/syncrew-duplex/`, 에뮬레이터 확인, 실기기 시험 전** (`docs/streaming-plan.md` 5-3절). **실기기 없이 마무리 (2) (10-17)**: S3 코드 재점검, 혼합 통화 무음 버그 수정(+e2e `E2E_MIXED`), 상대 역할 스크립트 `server/scripts/call-peer.ts`, OpenAI 가격 대조, 캐시 정리 (`74a7969`). **2026-10-17 밤 인수인계(새 담당자, Android 기기 없음): S3 iOS 실기기 시험 통과(iPhone 15 Pro Max + AirPods Pro, 점검 화면 + F 스트리밍 통화), iOS voice processing 무한 재시작 버그 수정(미커밋). 다음: Android 기기 확보 → Android S3·S4, 실제 OpenAI 로 G·H** — `docs/HANDOFF.md` 1·7절, `docs/device-test-log.md` | `b1eb6d6`·`713c5e3`·`14a55da`·`d47b83d`·`12831ff`·`0c995ad`·`b038223`·`74a7969` |

- 진행 현황·검증 결과·미검증 항목의 기준 문서: `docs/implementation-plan.md` (Phase가 끝날 때마다 갱신).
- 실시간: `server/src/realtime/gateway.ts`가 `DomainEvents`를 Socket.IO로 구현하고 서버 시작 시 `context.events`를 교체한다. 라우트는 반드시 호출 시점의 `context.events.*`를 쓴다(구조 분해로 미리 꺼내면 noop이 남음).
- 통역: `server/src/messaging/pipeline.ts`(작업 큐), 엔진은 `context.stt`·`context.translator`(키 없으면 null, `ENGINE=fake`면 가짜). 메시지 생성은 `messaging/createMessage.ts` 하나로 (대화·통화 발화·지시 공통).
- 앱은 `EXPO_PUBLIC_API_MODE=mock`(기본)으로 서버 없이 동작. 서버 API·이벤트는 `server/src/shared/api.ts`·`realtime.ts` 계약과 `frontend/src/services/live/*` 호출에 맞출 것. 계약을 바꾸면 앱 mock 구현(`frontend/src/services/mock/`)도 함께 고친다.
- 설정 완료: Supabase URL·키(`server/.env`, `frontend/.env`), **OpenAI API 키(2026-10-12 입력)**.
- **OpenAI 비용**: 2026-10-14 사용자: 충전 잔액 **$80** — 걱정하지 않아도 되지만 **막 쓰지는 말 것**. 서버 한도 `OPENAI_BUDGET_USD=3`(`OPENAI_BUDGET_PERIOD=total` 누적), **2026-10-14 누적 $0.3149**. 실제 호출 전에는 예상 비용을 말하고 실행 상한(`--max-usd` 또는 `OPENAI_BUDGET_USD=<누적+여유>`로 서버 실행)을 건다. 한도를 더 올릴 때는 금액을 먼저 알린다. 실제 청구액 대조는 하지 않기로 함(사용자 결정). 스트리밍 실호출은 턴당 약 $0.01, 말한 1분당 약 $0.18. 흐름 확인은 `ENGINE=fake`(비용 0).
- **Phase 7 S0 보고: `docs/s0-report.md`** (① OpenAI 스트리밍 실측: 말 끝 → 첫 번역 음성 P50 1.83초, 비용·토큰·함정 문장·세션 끊김 1회, ② 실기기 절차·후보 조사, 3절 계획 변경 제안 P1–P7). B1 결과는 `docs/implementation-plan.md` Phase 7.
- Phase 6 정리 문서: `docs/phase6-report.md` (실제 OpenAI 결과·비용·지연, 기기 확인, 시나리오 1–17·A–G 결과표, 알려진 문제, 결정 필요 사항). 운영 문서: `docs/operations.md` (설치·실행·비용·플러그인 연결·확인 도구).
- Phase 4 정리 문서: `docs/phase4-report.md` (결정·비용 추정·검증·에뮬레이터 실행 방법).
- Phase 5 실시간 통역: `docs/live-interpretation.md` (핸즈프리 발화 단위 방식, 세션 API, VAD, 이어폰 처리, 검증·미검증). 세션 서비스 `server/src/sessions/liveSessions.ts`, 앱 `frontend/src/audio/useHandsFree.ts`.
- 검증 완료(2026-10-12): 실제 OpenAI 5개 언어 왕복, 서버 경로 지연(업로드 → 상대 수신 5.1초, 말 끝 기준 약 6초), live 모드 2인 e2e 27개(웹 빌드 + 실제 Supabase 계정 + 실제 서버), 에뮬레이터 일괄 지시·통화, iOS 시뮬레이터 실행.
- 테스트 계정(사용자 허락, 2026-10-12): `syncrew-e2e-manager@example.com`, `syncrew-e2e-member@example.com`. 비밀번호는 `server/.e2e-accounts.json`(git 제외). 삭제는 `npx tsx scripts/e2e-accounts.ts --delete`.
- 실기기(2026-10-14–15): 네이티브 앱 live 모드(휴대폰 → PC 서버) 확인, 문장 단위 통화 양쪽 통과, iPhone 헤드셋 통과. 미검증: Android 헤드셋 마이크(무음 → S3), 휴대폰 스트리밍(S3), 휴대폰 2대 동시 통화, D·E 시나리오.

## 남은 일 (우선순위 순, 2026-10-14 갱신)

**전체 인수인계·다음 작업 안내는 `docs/HANDOFF.md` 가 기준이다.** 아래는 요약.

완료 (2026-10-13–14): B1 대상 선택 UX, S0 ① OpenAI 측정, S1 서버 스트리밍, S2 웹 검증 클라이언트(실제 OpenAI 확인 포함), B2 작업조 저장, 안정화, Expo 패치, 번역 전용 모델 비교(유지 결정), Supabase 비밀번호 재설정 설정, 관리자 지정·해제, 같은 언어 통화 앱 e2e, 서버 노이즈 필터 조각 단위 연결 지점, 받아쓰기 모델 gpt-4o-transcribe 교체. 상세는 `docs/implementation-plan.md` Phase 7, `docs/streaming-plan.md` 4-1·5-1·5-2절.

1. ~~실기기 준비~~ ✅ (2026-10-14: Galaxy S22 + Buds2, iPhone 17 Pro + AirPods Pro). 실기기 실행 절차(네트워크·빌드·서명)는 `docs/HANDOFF.md` 7절. T2 남은 것: D·E 시나리오, 헤드셋으로 통역 듣기
2. **S3 네이티브 오디오 (iOS·Android)** — **2026-10-15 새벽 구현 완료(자체 Expo 모듈 `frontend/modules/syncrew-duplex/`), 실기기 시험 남음**: 점검 화면 `syncrew:///audio-check`(개발 빌드) → 스트리밍 통화 F·G·H → 문장 단위 폴백의 Android 헤드셋 재시험. 절차 `docs/HANDOFF.md` 7절. 아래는 구현 전 메모 — 빌드 전 옛 경로가 남은 Android 빌드 캐시 삭제(`rm -rf frontend/android/app/.cxx frontend/android/app/build`), Expo 패치(10-14) 후 개발 빌드 새로. 1순위 `react-native-audio-api` 1.0 nightly 로 `frontend/src/audio/duplex/` 에 네이티브 구현(지금은 iOS·Android 에서 null → 휴대폰은 발화 단위 방식). 후보·위험: `docs/s0-report.md` 2절. **iOS·Android 모두 확인**, 먼저 구현하고 실기기에서 고친다
3. **S4 1:1 통화(휴대폰 2대) → S6 실기기 튜닝** (지연 P50 ≤ 2.0초·P90 ≤ 3.0초, 무음 300–400ms·추론 minimal 실험, 헤드셋, 비용 약 $3–6 → 서버 한도 상향 전 금액 안내)
4. 실기기에서만 확인 가능: 비밀번호 재설정 메일 링크 → 앱 열림, 사람 목소리로 받아쓰기("비계→기계" 재확인), 작업조·관리자 지정 화면의 네이티브 표시, 소리 품질·체감 지연
5. 다른 팀원 몫: 실제 노이즈 필터 구현(서버 `STREAM_AUDIO_FILTER`·`AUDIO_PREPROCESSOR` 에 등록), 현장 용어 데이터 보강(거푸집·안전모·안전고리 등, 중국어·러시아어·우즈베크어 번역)
6. 나중에: UI 문구 원어민 검수, 업무용 메일 서비스(지금 개인 Gmail SMTP), 우즈베크어 통역 품질(보류), ~~용어집 지시문(보류)~~(2026-10-19 스트리밍에도 적용, `docs/streaming-plan.md` 4-2절), 백그라운드 통화 유지, 그룹 실시간 통역, 푸시 알림

### 지켜야 할 사용자 결정 (요약, 상세는 `docs/streaming-plan.md` 0-1·0-2절)
- Phase·단계마다 멈추고 승인. 커밋·푸시는 요청할 때만
- OpenAI: 실제 호출 전 예상 비용 안내·승인, 실행 상한을 걸고 최소로. 서버 한도 $3 누적(더 올릴 때는 금액 먼저 안내)
- 스트리밍은 1:1 통화만, 일괄 지시는 발화 단위 유지. 같은 언어 통화는 OpenAI 없이 직접 전달. 실패한 문장은 기록 안 함. 스트림으로 들은 문장은 다시 재생하지 않음
- OpenAI 세션 안 문맥은 응답마다 삭제하고 직전 1–2문장을 텍스트로 넣는다 (DB 기록은 그대로)
- 시험은 iOS·Android 모두
- **번역 모델은 `gpt-realtime-2.1` 유지 — 번역 전용 `gpt-realtime-translate` 는 쓰지 않는다** (2026-10-14 결정: 현장 용어·숫자 오역 6/9, 지시문·용어집 불가, 우즈베크어 출력 불가. `docs/s0-report.md` 4절)

## 새 세션 시작 순서

0. **프로젝트 위치는 `/Users/taewoongjang/PlayGround/SYNCREW`** (2026-10-14 이동). 세션도 이 폴더에서 시작한다.
1. **`docs/HANDOFF.md` 를 먼저 읽는다** — 현재 상태·남은 작업·실기기 준비·가장 먼저 할 일·"이제 할 일이 뭐지?" 응답 규칙이 있다. 그다음 이 파일(규칙·비용·결정), 필요하면 `docs/streaming-plan.md`·`docs/operations.md`.
2. `git log --oneline | head -5`와 `git status`로 상태를 확인한다. 실기기 시험 기록은 `docs/device-test-log.md`.
3. 기준선 확인 (비용 0): `cd server && npm run typecheck && npm test` (**233개** 통과 + 실제 사이드카 시험 1개 건너뜀 — `DENOISE_TEST_URL` 있을 때만), `cd frontend && npm run typecheck && npm run test:unit` (**36개**).
4. **실기기 준비 여부를 먼저 확인**한다 (`docs/HANDOFF.md` 5·7절). 준비 전이면 준비 절차를 안내한다.
5. **실제 OpenAI를 부르는 작업은 하기 전에 예상 비용을 말하고 승인받는다** (서버 한도 $3 누적 중 약 $0.34 사용). 실행 상한을 건다.
6. 작업을 끝내면: `docs/HANDOFF.md`(상태·다음 작업)·`docs/implementation-plan.md`·이 파일의 상태 표를 갱신하고 보고한 뒤 멈춘다. 커밋·푸시는 사용자가 요청할 때 한다 (커밋 전 `git grep --cached -nE "sk-proj-|sb_secret_"`로 키 혼입 검사).

## 이 PC 환경 (작업 전 알아 둘 것)

- Docker·Postgres 미설치 → 로컬 DB는 `embedded-postgres`(`npm run db:start`, 포트 5433, 데이터 `server/.pgdata/`). 테스트는 매번 임시 Postgres(포트 54331)를 따로 띄운다.
- Android 에뮬레이터(`Pixel_9_Pro_XL`, SDK `~/Library/Android/sdk`)와 Xcode iOS 시뮬레이터 설치됨 (2026-10-12). 개발 빌드(`expo run:*`)로 실행한다. 명령은 `docs/phase4-report.md` 7절.
  - **Android 빌드는 JDK 21** (`/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home`). 기본 JDK 26·Android Studio JDK 25는 CMake 단계에서 실패.
  - **프로젝트는 2026-10-14부터 영문 경로** `/Users/taewoongjang/PlayGround/SYNCREW` (예전 한글 경로에서는 iOS `pod install` 이 실패해 복사본으로 빌드했다 — 이제 원래 폴더에서 바로 `expo run:ios` 가능, 아직 실제로 빌드해 보지는 않음).
  - 시뮬레이터 조작 도구가 없어 iOS는 화면 캡처만 가능. Android는 `adb shell input`으로 조작.
  - **디스크 여유 공간이 적다** (2026-10-17 작업 후 **약 2GB** — 네이티브 빌드·에뮬레이터가 안 들어간다. 10-17 에 에뮬레이터가 공간 부족으로 켜지지 않았다. 사용자가 공간을 확보해야 함, `docs/HANDOFF.md` 7절). Android 빌드(Gradle)·iOS 빌드(Pods)는 공간을 많이 쓰므로 빌드 전 `df -h /System/Volumes/Data`로 확인한다.
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
| 번역 모델 | `gpt-realtime-2.1` (2026-10-12 `gpt-realtime-2`에서 교체, 같은 가격. 서버→OpenAI Realtime WebSocket, 음성+전사 출력). STT는 **`gpt-4o-transcribe`** (2026-10-14 mini 에서 교체 — 현장 용어·숫자가 더 정확, 용어 힌트는 오히려 나빠 쓰지 않음). **번역 전용 `gpt-realtime-translate` 는 쓰지 않음** (2026-10-14 비교 측정 후 결정, 이유: `docs/s0-report.md` 4-3절) |
| 비용 | BudgetGuard가 모든 호출을 감쌈. 서버 한도 **$3 누적** (10-12 $0.5 → 10-13 $3). 잔액 $80(10-14), 막 쓰지 않기 |
| 현장 특화 처리 | 로직만 구현, 데이터셋은 어댑터로 교체 (기존 저장소 데이터는 샘플). 제조업 데이터여도 무방 |
| 노이즈 필터 / 보존 정책 | 다른 개발자가 구현 → 플러그인 인터페이스만 제공 (`server/src/plugins/`). **노이즈 필터는 서버에서 실행** (2026-10-14 결정) |
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
- 네이티브 이중 오디오(S3): `frontend/modules/syncrew-duplex/` (Expo 로컬 모듈, Swift·Kotlin). 앱은 `src/audio/duplex/` 의 `DuplexAudio` 로만 쓴다. 개발용 점검 화면 `syncrew:///audio-check`. **에뮬레이터·시뮬레이터에서 Mac 마이크를 쓰게 하지 말 것**(`adb emu avd hostmicon` 등) — 권한 창을 누를 사람이 없어 CoreAudio 입력이 막히고 앱·웹 e2e 마이크까지 꼬였다(2026-10-15)
- 앱 화면은 `frontend/src/app` (expo-router). 디자인 토큰 `frontend/src/theme.ts`, UI 문구는 `frontend/src/i18n/strings.ts`(5개 언어 모두 채울 것). Expo 패키지는 `npx expo install`로 설치. `frontend/AGENTS.md` 참고 (Expo는 SDK마다 API가 바뀌므로 문서 확인).
- 비밀 값: `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`는 `server/.env`에만. 앱에는 publishable key만.
- Prisma가 AI의 `migrate reset`을 사용자 동의 없이 차단한다. 우회하지 말고 새 마이그레이션을 추가할 것.

## 실행과 검증

```bash
# 서버
cd server && npm run db:start                    # 터미널 1: 로컬 Postgres (localhost:5433)
cd server && npm run db:deploy && npm run dev    # 터미널 2: http://0.0.0.0:4000/health
cd server && npm run typecheck && npm test       # 테스트 233개 (임시 Postgres·실제 Socket.IO 통합 테스트, 스트리밍·전사 전용 세션·메아리 차단·용어집·노이즈 필터 사이드카·작업조·역할 포함)
cd server && ENGINE=fake npm run dev             # OpenAI 없이 가짜 통역 (비용 0)
cd server && npx tsx scripts/openai-check.ts     # 실제 OpenAI 5개 언어 왕복 (약 $0.05, 승인 후)
cd server && npx tsx scripts/stream-measure.ts --dry-run   # S0 스트리밍 측정 계획·예상 비용 (비용 0). 실제 실행은 승인 후 (턴당 약 $0.01, --max-usd 상한)

# 앱
cd frontend && npm run typecheck && npm run doctor
cd frontend && npm run bundle:android            # Android 번들 빌드 확인
cd frontend && npm run test:unit                 # 단위 테스트 36개 (VAD 11 + 일괄 지시 대상 선택·작업조 7 + 이중 오디오 base64 4 + 내 말 자막 11 + 재생 신호 3)
cd frontend && npm run bundle:web && npm run e2e # 데모 모드 사용 흐름 99개 자동 검증 (통화·일괄 지시·대상 선택·작업조·관리자 지정 포함)
cd frontend && npm run e2e:screens               # 주요 화면 캡처 → e2e/output/screens/
cd frontend && npm run e2e:mic                   # 실제 말소리로 핸즈프리 자동 전송 + 무음 대조군 (bundle:web 후)
cd frontend && npm run bundle:web:live && npm run e2e:live   # live 모드 2인 e2e 43개 (통화는 스트리밍, 같은 언어 직접 전달·작업조 저장 포함. E2E_STREAMING=off 폴백, E2E_ONLY_CALL=1 통화만, E2E_REAL=1 실제 OpenAI) (ENGINE=fake 서버 실행 중이어야 함)
cd frontend && npm run e2e:latency               # 서버 경로 지연 1회 (ENGINE=openai면 약 $0.006, 승인 후)
cd frontend && E2E_MIXED=1 npm run e2e:live      # 한쪽만 스트리밍하는 통화 18개 (서버를 ENGINE=fake STREAM_MAX_SESSIONS=1 로 실행 중이어야 함)
cd server && npx tsx scripts/call-peer.ts        # 실기기 시험용 통화 상대 (e2e 계정, 합성 음성 말하기·휴대폰 소리 음량/wav). --answer·--utterance·--as manager. ENGINE=fake 면 비용 0
```

- 백그라운드로 띄운 DB·서버는 작업이 끝나면 **반드시** 종료한다: 서버 `pkill -f "src/index.ts"` (`npm run dev` 는 `tsx watch src/index.ts` 라 "tsx src/index.ts" 패턴으로는 안 죽는다), DB `pkill -INT -f scripts/db.ts` 후에도 postgres 가 남으면 `cd server && node_modules/@embedded-postgres/darwin-arm64/native/bin/pg_ctl -D .pgdata stop -m fast`. 확인: `lsof -nP -iTCP:4000 -sTCP:LISTEN`, `lsof -nP -iTCP:5433 -sTCP:LISTEN` 이 비어 있어야 한다 (2026-10-13 확인).
- `dist-check/`, `dist-live/`, `e2e/output/`, `server/.e2e-accounts.json`은 커밋하지 않는다(.gitignore).

## 참고

- GitHub: https://github.com/jang-tang/SYNCREW (`main`). `.env`는 루트 `.gitignore`로 제외. 커밋 전 키가 섞이지 않았는지 확인할 것.
- 원본 통역 저장소: https://github.com/jecool0523/workplace-translation-mvp (분석: `docs/current-codebase-analysis.md`). 수정하지 않는다.
- 발표 PDF: `싱크필드_20260909 최종본.pdf` (대한민국 청소년 창업경진대회, 팀 SyncField).
