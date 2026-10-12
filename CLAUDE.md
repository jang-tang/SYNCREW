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

## 현재 상태 (2026-10-12)

| 단계 | 상태 | 커밋 |
|---|---|---|
| Phase 1 기반 (서버·엔진 골격·비용 한도) | 완료 | `9371620` |
| 프론트엔드 전체 화면 (데모 모드) | 완료 | `3fea4e7` |
| Phase 2 인증·현장·멤버십 (서버) | 완료 | `c637a6b` |
| Phase 3 실시간 (Socket.IO) | 완료 | `92e3620` |
| Phase 4 통역 파이프라인 + 1:1 대화 | 완료 (Fake 엔진 검증. 실제 OpenAI 확인은 키 입력 후) | `fd2caf0` |
| **Phase 5 그룹·일괄 지시** | **다음 차례 — 사용자 승인 후 착수** | — |
| Phase 6 안정화 | 대기 | — |

- 진행 현황·검증 결과·미검증 항목의 기준 문서: `docs/implementation-plan.md` (Phase가 끝날 때마다 갱신).
- 실시간: `server/src/realtime/gateway.ts`가 `DomainEvents`를 Socket.IO로 구현하고 서버 시작 시 `context.events`를 교체한다. 라우트는 반드시 호출 시점의 `context.events.*`를 쓴다(구조 분해로 미리 꺼내면 noop이 남음).
- 통역: `server/src/messaging/pipeline.ts`(작업 큐), 엔진은 `context.stt`·`context.translator`(키 없으면 null, `ENGINE=fake`면 가짜). 메시지 전송·조회는 그룹 대화에도 그대로 동작한다 — Phase 5는 일괄 지시 API(`/sites/:id/instructions`, inbox, ack/complete, `instruction:recipient`)와 그룹 화면 검증이 중심.
- 앱은 `EXPO_PUBLIC_API_MODE=mock`(기본)으로 서버 없이 동작. 서버 API·이벤트는 `server/src/shared/api.ts`·`realtime.ts` 계약과 `frontend/src/services/live/*` 호출에 맞출 것. 계약을 바꾸면 앱 mock 구현(`frontend/src/services/mock/`)도 함께 고친다.
- 설정 완료: Supabase URL·키(`server/.env`, `frontend/.env`). **미입력: OpenAI API 키** (`cd server && npm run setup:openai`).
- Phase 4 정리 문서: `docs/phase4-report.md` (결정·비용 추정·검증·에뮬레이터 실행 방법).
- 미검증: 실제 OpenAI 호출(키 미입력, 나중에 진행), 실기기 실행, 앱 live 모드 ↔ 서버 실통신, 실제 Supabase 계정 토큰으로 API 호출(테스트 계정을 임의로 만들지 않음).

## 새 세션 시작 순서

1. 이 파일, `docs/implementation-plan.md`의 Phase 5 절, `docs/phase4-report.md`를 읽는다.
2. `git log --oneline | head -5`와 `git status`로 마지막 커밋이 위 표와 같은지, 미커밋 변경이 없는지 확인한다.
3. 기준선 확인: `cd server && npm test` (106개 통과해야 함), `cd frontend && npm run typecheck`.
4. 사용자가 Phase 5 착수를 승인했는지 확인한다. 승인 전이면 계획·질문만 한다.
5. OpenAI 키 입력 여부를 확인한다. 입력됐으면 Phase 4의 실제 호출 확인(5개 언어 왕복·지연·비용, `docs/phase4-report.md` 3·6절)을 먼저 할지 묻는다.
6. Phase를 끝내면: `docs/implementation-plan.md`(결과·검증·미검증)와 이 파일의 상태 표를 갱신하고 보고한 뒤 멈춘다. 커밋·푸시는 사용자가 요청할 때 한다 (커밋 전 `git grep --cached`로 키 혼입 검사).

## 이 PC 환경 (작업 전 알아 둘 것)

- Docker·Postgres 미설치 → 로컬 DB는 `embedded-postgres`(`npm run db:start`, 포트 5433, 데이터 `server/.pgdata/`). 테스트는 매번 임시 Postgres(포트 54331)를 따로 띄운다.
- Android 에뮬레이터(`Pixel_9_Pro_XL`, SDK `~/Library/Android/sdk`)와 Xcode iOS 시뮬레이터 설치됨 (2026-10-12). 개발 빌드(`expo run:*`)로 실행한다. 명령은 `docs/phase4-report.md` 7절.
  - **Android 빌드는 JDK 21** (`/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home`). 기본 JDK 26·Android Studio JDK 25는 CMake 단계에서 실패.
  - **iOS는 한글 경로에서 `pod install` 실패** (hermes-engine.podspec 인코딩 오류) → 영문 경로 복사본에서 네이티브만 빌드하고 JS는 원래 폴더 Metro로 제공.
  - 시뮬레이터 조작 도구가 없어 iOS는 화면 캡처만 가능. Android는 `adb shell input`으로 조작.
  - 빠른 확인은 기존대로 타입 검사 + `expo-doctor` + 번들 빌드 + **웹 빌드 헤드리스 Chrome 자동 검증**(`frontend/e2e/`).
- Node 22, npm. Chrome은 `/Applications/Google Chrome.app` (e2e가 사용).
- 헤드리스 Chrome은 비밀번호 입력 뒤 실제 키 이벤트를 잃는 현상이 있다(앱 버그 아님). e2e는 글자를 IME 경로로 입력한다.

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
| 비용 | OpenAI 한도 **$5/월**, BudgetGuard가 모든 호출을 감쌈. 키는 사용자가 `.env`에 직접 입력 |
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
cd server && npm run typecheck && npm test       # 테스트 106개 (임시 Postgres·실제 Socket.IO 통합 테스트 포함)

# 앱
cd frontend && npm run typecheck && npm run doctor
cd frontend && npm run bundle:android            # Android 번들 빌드 확인
cd frontend && npm run bundle:web && npm run e2e # 데모 모드 사용 흐름 22개 자동 검증
cd frontend && npm run e2e:screens               # 주요 화면 캡처 → e2e/output/screens/
```

- 백그라운드로 띄운 DB·서버는 작업이 끝나면 종료한다 (`pkill -INT -f scripts/db.ts`, `pkill -f "tsx src/index.ts"`).
- `dist-check/`, `e2e/output/`은 커밋하지 않는다(.gitignore).

## 참고

- GitHub: https://github.com/jang-tang/SYNCREW (`main`). `.env`는 루트 `.gitignore`로 제외. 커밋 전 키가 섞이지 않았는지 확인할 것.
- 원본 통역 저장소: https://github.com/jecool0523/workplace-translation-mvp (분석: `docs/current-codebase-analysis.md`). 수정하지 않는다.
- 발표 PDF: `싱크필드_20260909 최종본.pdf` (대한민국 청소년 창업경진대회, 팀 SyncField).
