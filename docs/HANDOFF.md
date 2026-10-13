# SYNCREW 인수인계 문서 (작업 재개 기준)

작성 2026-10-14 (커밋 `12831ff` 기준). 이 문서만 읽고 바로 작업을 이어 갈 수 있도록 작성했다.
더 자세한 근거는 각 절에 적은 문서·파일에 있다. 작업 규칙의 원본은 루트 `CLAUDE.md`.

표기: ✅ 완료(실제로 실행·확인함) · 🟡 진행 중/부분 완료 · ⬜ 미완료(아직 안 함) · ❓ 미확인(상태를 확인하지 못함)

---

## 1. 프로젝트 한눈에 보기

### 목표
건설·제조 현장의 **외국인 작업자와 한국인 관리자가 서로 다른 언어로 실시간 대화**할 수 있게 하는 AI 통역 모바일 서비스 MVP (팀 SyncField, 대한민국 청소년 창업경진대회 출품작).
- 안전모 부착 모듈 = **일반 블루투스 헤드셋**으로 취급
- **Android·iOS 앱**(Expo) + **로컬 PC 서버**(Express + Socket.IO + Postgres). 휴대폰은 같은 Wi-Fi 로 PC 서버에 접속
- 언어: 한국어(ko)·중국어(zh)·베트남어(vi)·우즈베크어(uz)·러시아어(ru)
- 기능: 1:1 대화, 현장 그룹 대화, 관리자 일괄 지시(문자·실시간 음성) + 확인·완료 응답, **1:1 실시간 통역 통화**

### 현재 상태 (2026-10-14)
- 서버·앱 기능은 대부분 완성. **PC(웹 브라우저·에뮬레이터·시뮬레이터)에서는 검증 완료**, **실기기(휴대폰)에서는 한 번도 검증하지 않았다.**
- 진행 중인 큰 작업: **Phase 7 = 1:1 통화 "진짜 스트리밍 통역"** (말하는 동안 음성을 흘려 보내 지연을 약 6초 → 2초 이하로)
  - 서버(S1)·웹 앱(S2)은 완료, 실제 OpenAI 로도 웹에서 동작 확인
  - **휴대폰 쪽(S3 네이티브 오디오)은 실기기가 없어 시작하지 못함** → 지금 휴대폰 앱은 통화를 걸면 자동으로 "문장 단위 방식"(약 6초 지연)으로 통화한다
- **실기기 준비: ⬜ 미완료** (사용자: "아직 준비 어려움", 2026-10-14 기준)

### 최종 완료 기준 (MVP)
1. Android·iOS **실기기 2대**로 1:1 스트리밍 통역 통화가 된다: 말 끝 → 상대 이어폰 첫 소리 **P50 ≤ 2.0초, P90 ≤ 3.0초** (같은 Wi-Fi, 실기기 + 블루투스 헤드셋, 20회 이상 측정)
2. 블루투스 헤드셋으로 녹음·재생 동시, 에코 루프 없음, 두 사람이 겹쳐 말해도 끊기지 않음
3. 통화 기록(원문·번역문·음성)이 남고, 스트리밍이 실패하면 문장 단위로 자동 전환, 비용 한도를 넘지 않음
4. 기존 기능(대화·그룹·일괄 지시·작업조·가입·비밀번호 재설정)이 **실기기 Android·iOS 모두**에서 동작
- 근거: `docs/streaming-plan.md` 1절 "완료 기준", 0-2절(목표 조정)

---

## 2. 현재까지의 진행 상황

### ✅ 완료 (커밋됨, GitHub `jang-tang/SYNCREW` `main`)
| 단계 | 내용 | 커밋 |
|---|---|---|
| Phase 1–6 | 서버 기반·인증(Supabase)·현장/멤버십·실시간(Socket.IO)·통역 파이프라인·1:1 통화와 실시간 일괄 지시(문장 단위)·안정화·실제 OpenAI 확인·live 모드 2인 e2e | `9371620`~`022f261` |
| Phase 7 B1 | 일괄 지시 대상 선택 UX (빠른 선택 칩·검색·전체 선택·지난번 대상·요약) | `b1eb6d6` |
| Phase 7 S0 ① | OpenAI 스트리밍 측정: 서버→OpenAI 말 끝→첫 번역 음성 P50 1.83초, 말한 1분당 약 $0.175 (`docs/s0-report.md` 1절) | `b1eb6d6` |
| Phase 7 S1 | 서버 스트리밍 경로 `server/src/streaming/` (OpenAI 세션 유지, 턴마다 문맥 삭제+직전 2문장 텍스트, 비용 기록, 끊김→재연결→문장 단위 폴백, 같은 언어는 OpenAI 없이 직접 전달) | `b1eb6d6` |
| Phase 7 S2 | 웹 앱 스트리밍 (`frontend/src/audio/duplex/` 웹 구현, `useStreamingCall`, 실시간 자막, **스트림으로 들은 문장 다시 재생 안 함**), 실제 OpenAI 2회 확인($0.025, 음성 조각 손실 버그 발견·수정) | `713c5e3`, `14a55da` |
| Phase 7 B2 | 작업조 저장 (DB 표 2개, 관리자 API, 칩·저장·덮어쓰기·관리 화면) | `d47b83d` |
| 안정화 | 서버 시작 시 정리 테스트, 업로드 음성 형식 허용 목록, 알림 사라짐 버그, Expo 패치 4개 | `d47b83d` |
| 모델 비교 | 번역 전용 `gpt-realtime-translate` 비교 → **쓰지 않기로 결정** (`docs/s0-report.md` 4절) | `d47b83d` |
| 실기기 없이 마무리 | 관리자 지정·해제 API·화면, 같은 언어 통화 앱 e2e, 서버 노이즈 필터 조각 단위 연결 지점, 받아쓰기 모델 `gpt-4o-transcribe` 교체 | `12831ff` |
| Supabase 재설정 | 사용자 대시보드 설정(앱 주소 `syncrew://reset-password` 등록·메일 문구·Gmail SMTP) + 메일 수신·링크 이동 확인 (`docs/operations.md` 8절) | `12831ff`(문서) |

자동 시험 (마지막 실행 2026-10-14, 모두 통과): 서버 **200**, 앱 단위 **18**, 데모 e2e **99**, live e2e **43**, 마이크 e2e **2**, Android 번들 빌드, expo-doctor **21/21**.

### 🟡 진행 중
- **Phase 7 스트리밍 — S3(네이티브 오디오) 대기**: 실기기 준비가 선행 조건. 코드상 `frontend/src/audio/duplex/index.ts` 가 iOS·Android 에서 `null` 을 돌려주므로 휴대폰은 문장 단위 방식으로 자동 전환된다(정상 동작, 의도된 상태).

### ⬜ 미완료 (아직 하지 않음)
1. **실기기 준비** (사용자) — 5절
2. 실기기에서 **현재 앱(문장 단위) 기준선 확인** — 한 번도 안 함
3. **S3 네이티브 오디오** (iOS·Android) → **S4 휴대폰 2대 통화** → **S6 실기기 튜닝**
4. 실제 노이즈 필터 구현 (다른 팀원, 서버 연결 지점만 준비됨)
5. 현장 용어 데이터 보강 (다른 팀원: "거푸집·안전모·안전고리"가 검증 문장에 없음, 번역은 베트남어만 있음)
6. 나중에(사용자 결정): UI 문구 원어민 검수, 업무용 메일 서비스, 우즈베크어 통역 품질(보류), 용어집 지시문(보류), 백그라운드 통화 유지, 그룹 실시간 통역, 푸시 알림

### ❓ 미확인 (확인하지 못한 것 — 완료로 보지 말 것)
- **모든 실기기 동작**: 휴대폰 → PC 서버 접속, 휴대폰 마이크·블루투스 헤드셋 녹음, 이어폰 재생, 에코, 백그라운드
- 프로젝트 이동(2026-10-14) 후 **새 경로에서 iOS·Android 네이티브 빌드** (안 해 봄). `frontend/ios/` 는 예전 경로에서 만든 폴더 — 새 경로에서 그대로 쓸 수 있는지 미확인
- Expo 패치 업데이트(2026-10-14) 후 **개발 빌드**는 다시 만들지 않음 (에뮬레이터·시뮬레이터에 설치된 앱은 예전 네이티브)
- 비밀번호 재설정 메일 링크 → **휴대폰에서 앱이 열리는지**
- 받아쓰기 "비계 → 기계" 오류가 **사람 목소리에서도** 나는지 (합성 음성에서만 확인)
- 사람이 귀로 듣는 통역 소리 품질·체감 지연 (헤드리스 브라우저는 소리를 못 들음)
- `react-native-audio-api` 1.0 nightly 가 실제로 블루투스 HFP·에코 제거를 하는지 (소스 조사만, `docs/s0-report.md` 2-1절)
- 웹 브라우저의 실제 확인 창(관리자 지정 등)은 사람이 눌러 본 적 없음 (e2e 는 확인 창을 자동 "확인"으로 바꿔 시험)
- OpenAI 가격: 받아쓰기 단가는 가격 정리 사이트 기준 (OpenAI 가격표로 재확인 안 함)

---

## 3. 개발 환경 및 핵심 정보

### 위치와 도구
- 프로젝트: **`/Users/taewoongjang/PlayGround/SYNCREW`** (2026-10-14 영문 경로로 이동. 예전 경로 `/Users/taewoongjang/PlayGround/그동안 했던 프로젝트들/SYNCREW` 는 없음)
- GitHub: https://github.com/jang-tang/SYNCREW (`main`)
- macOS, Node 22, npm, Chrome(`/Applications/Google Chrome.app`, e2e 용), Xcode + iOS 시뮬레이터(iPhone 17 Pro 등), Android 에뮬레이터 `Pixel_9_Pro_XL`(SDK `~/Library/Android/sdk`)
- **Android 빌드는 JDK 21**: `export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home` (기본 JDK 26·Android Studio JDK 25 는 CMake 단계 실패)
- 디스크 여유 약 19GB (2026-10-14). 네이티브 빌드 전 `df -h /System/Volumes/Data` 확인
- 이 PC 의 Wi-Fi IP: 2026-10-14 기준 `192.168.45.160` (바뀔 수 있음 — `ipconfig getifaddr en0` 로 확인)

### 기술 스택
| 부분 | 기술 |
|---|---|
| 앱 `frontend/` | Expo SDK 57 (`expo ~57.0.28`), React Native 0.86.3 (New Architecture 전용), expo-router, TanStack Query, zustand, socket.io-client 4.8, expo-audio 57 (문장 단위 녹음), Supabase JS (인증만) |
| 서버 `server/` | Express 5, Socket.IO 4.8, Prisma 7 + 로컬 Postgres(`embedded-postgres`, 포트 5433, 데이터 `server/.pgdata/`), zod 4, ws, vitest 5 |
| 인증 | Supabase Auth (이메일+비밀번호), 서버는 JWKS 로 토큰 검증. 데이터는 Supabase 에 저장하지 않음 |
| 통역 | OpenAI `gpt-realtime-2.1` (번역·음성), `gpt-4o-transcribe` (받아쓰기, 2026-10-14부터) |

### 구조와 핵심 파일
| 경로 | 내용 |
|---|---|
| `server/src/shared/api.ts`, `realtime.ts` | 앱과 공유하는 REST·Socket.IO 계약 (외부 패키지 import 금지) |
| `server/src/routes/v1/` | REST API (`targetGroups.ts`, `sites.ts` 멤버 관리·역할 등) |
| `server/src/messaging/pipeline.ts` | 문장 단위 통역 파이프라인 (디코딩→노이즈 필터→STT→현장 용어 처리→언어별 번역) |
| `server/src/streaming/` | 스트리밍 통역: `streamHub.ts`(권한·라우팅·폴백·필터), `realtimeStream.ts`(OpenAI), `fakeStream.ts`(가짜 엔진), `persistTurn.ts`(기록), `engine.ts`(지시문) |
| `server/src/engine/audio/streamAudioFilter.ts`, `server/src/plugins/streamAudioFilter.ts` | 스트리밍 노이즈 필터 연결 지점 (조각 단위) |
| `server/src/plugins/audioPreprocessor.ts` | 문장 단위 노이즈 필터 연결 지점 |
| `server/src/engine/budget/` | 비용 한도(BudgetGuard)·단가표 |
| `frontend/src/audio/duplex/` | 이중 오디오 인터페이스(`types.ts`) + 웹 구현(`web.ts`) — **S3 에서 네이티브 구현을 여기 붙인다** (`index.ts`) |
| `frontend/src/audio/useStreamingCall.ts` | 스트리밍 통화 훅 (VAD 게이트·재생·자막·폴백) |
| `frontend/src/audio/useHandsFree.ts` | 문장 단위 통화(폴백) 훅 |
| `frontend/src/audio/streamed.ts` | 중복 재생 방지 기록 |
| `frontend/src/app/site/call/[id].tsx` | 1:1 통화 화면 |
| `frontend/src/services/live/`, `mock/` | 실제 서버 / 데모 모드 서비스 (계약을 바꾸면 둘 다) |
| `frontend/e2e/` | 헤드리스 Chrome 자동 시험 (`flows.mjs` 데모, `live.mjs` 실서버 2인, `mic.mjs`) |
| `server/scripts/` | `stream-measure.ts`, `translate-compare.ts`, `stt-hint-compare.ts`, `openai-check.ts`, `e2e-accounts.ts`, `db.ts` |

### 설정 (값은 적지 않는다 — 비밀 값은 `.env` 에만)
- `server/.env` 키: `HOST PORT DATABASE_URL OPENAI_API_KEY OPENAI_BUDGET_USD(=3) OPENAI_BUDGET_PERIOD(=total) STT_MODEL(=gpt-4o-transcribe) TRANSLATION_MODEL(=gpt-realtime-2.1) SUPABASE_URL SUPABASE_JWKS_URL SUPABASE_SECRET_KEY AUDIO_PREPROCESSOR DATASET_* RETENTION_*` 등. 스트리밍 설정 `STREAMING STREAM_MAX_SESSIONS STREAM_VAD_SILENCE_MS STREAM_AUDIO_FILTER` 는 기본값 사용(`server/.env.example` 참고)
- `frontend/.env` 키: `EXPO_PUBLIC_API_MODE`(**지금 `mock`** = 데모 모드), `EXPO_PUBLIC_API_BASE_URL`(**지금 `http://10.0.2.2:4000`** = Android 에뮬레이터에서 본 PC), `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, (선택) `EXPO_PUBLIC_STREAMING=off`
- 앱: 이름 SYNCREW, Android 패키지·iOS 번들 `com.syncfield.syncrew`, URL scheme `syncrew`, 권한: 마이크(expo-audio 문구)·카메라(QR) (`frontend/app.json`). **블루투스 관련 권한(Android `BLUETOOTH_CONNECT` 등)은 아직 없음 — S3 에서 필요 여부 확인**
- Supabase 프로젝트 `hjatiacukflqxkbqomtp`, Redirect URL `syncrew://reset-password` 등록됨, SMTP = 사용자 Gmail (`docs/operations.md` 8절)
- 테스트 계정: `syncrew-e2e-manager@example.com`, `syncrew-e2e-member@example.com` (비밀번호는 `server/.e2e-accounts.json`, git 제외)

### 실행 방법
```bash
cd /Users/taewoongjang/PlayGround/SYNCREW
# 서버
cd server && npm run db:start                         # 터미널 1: 로컬 Postgres
cd server && npm run db:deploy && npm run dev         # 터미널 2: http://0.0.0.0:4000/health (실제 OpenAI)
cd server && ENGINE=fake npm run dev                  # OpenAI 없이 가짜 통역 (비용 0)
# 시험 (비용 0)
cd server && npm run typecheck && npm test            # 200개
cd frontend && npm run typecheck && npm run test:unit # 18개
cd frontend && npm run bundle:web && npm run e2e      # 데모 99개
cd frontend && npm run bundle:web:live && npm run e2e:live   # live 43개 (ENGINE=fake 서버 + DB 실행 중이어야 함)
# 끝나면 반드시 끄기
pkill -f "src/index.ts"; pkill -INT -f scripts/db.ts
cd server && node_modules/@embedded-postgres/darwin-arm64/native/bin/pg_ctl -D .pgdata stop -m fast   # postgres 가 남았으면
lsof -nP -iTCP:4000 -sTCP:LISTEN; lsof -nP -iTCP:5433 -sTCP:LISTEN   # 둘 다 비어 있어야 함
```

---

## 4. 남은 작업 체크리스트 (우선순위·선후 관계 순)

### T1. 실기기 준비 ⬜ — 담당: 사용자 / 선행: 없음 / **모든 실기기 작업의 선행 조건**
- 무엇: 5절의 기기·준비물을 갖추고 PC 와 연결
- 왜: 남은 핵심 작업(S3·S4·S6)과 미확인 항목 대부분이 실기기에서만 확인 가능
- 완료 기준: `adb devices -l` 에 Android 휴대폰이 `device` 로 보이고, `xcrun devicectl list devices` 에 iPhone 이 보이며(또는 사용 안 하면 그 사실 확인), 블루투스 헤드셋이 휴대폰에 연결됨

### T2. 실기기 기준선: 지금 앱(문장 단위)을 휴대폰에서 실제 서버로 돌려 보기 ⬜ — 선행: T1
- 무엇: 스트리밍 작업 전에, **이미 만든 기능이 실기기에서 되는지** 먼저 확인 (Android 먼저, 그다음 iPhone)
- 왜: 실기기 접속·네트워크·마이크·헤드셋 문제를 스트리밍 개발과 섞지 않고 먼저 걸러 낸다. 이후 문제의 원인을 좁히는 기준이 된다
- 어떻게: 5절 "앱 설치와 실행" 절차대로 live 모드 개발 빌드 설치 → 5절 시나리오 A–E
- 확인 사항: PC IP, 같은 Wi-Fi, macOS 방화벽, `frontend/.env` 를 live 모드로 바꾼 뒤 Metro 재시작(바꾼 값은 작업 후 되돌릴지 사용자와 정함)
- 완료 기준: 시나리오 A–E 결과를 `docs/device-test-log.md` 에 기록 (통과/실패/원인)
- 주의: 실제 OpenAI 를 쓰는 시나리오는 비용 안내 후. 흐름만 볼 때는 `ENGINE=fake`

### T3. S3 네이티브 오디오 구현 ⬜ — 선행: T1 (구현 자체는 T2 와 병행 가능, 시험은 실기기)
- 무엇: `frontend/src/audio/duplex/` 에 iOS·Android 구현을 붙여 휴대폰에서 "녹음하면서 동시에 PCM 조각 재생 + 에코 제거 + 블루투스 HFP" 를 한다
- 왜: 웹은 되지만 휴대폰은 `expo-audio`(녹음 파일 단위)로는 스트리밍이 불가능
- 어떻게:
  1. 1순위 `react-native-audio-api` 1.0 nightly 설치(`npx expo install` 가능 여부 확인, 버전 고정). 근거·위험: `docs/s0-report.md` 2-1절 (안정판 0.13.6 에는 에코 제거 없음, Android 블루투스 SCO 경로 지정 기능 없음)
  2. `DuplexAudio` 인터페이스(`frontend/src/audio/duplex/types.ts`)를 그대로 구현하는 어댑터 작성: 16kHz 100ms PCM16 프레임 + dB 음량, 24kHz 조각 이어 재생(지터 버퍼 약 120ms), 경로 변경 알림
  3. `frontend/src/audio/duplex/index.ts` 에서 iOS·Android 일 때 그 구현을 돌려주게 변경
  4. Android 권한(`BLUETOOTH_CONNECT` 등)·iOS 오디오 세션(playAndRecord + voiceChat + Bluetooth HFP) 설정 — config plugin
  5. 안 되는 부분만 2순위 `@speechmatics/expo-two-way-audio`(iOS 빌드 패치 필요, 16kHz 고정) 또는 자체 Expo 모듈로 교체
- 확인 사항: 새 경로에서 네이티브 빌드가 되는지(빌드 전 Android 캐시 삭제 `rm -rf frontend/android/app/.cxx frontend/android/app/build`, iOS 는 `npx expo prebuild` 로 `ios/` 재생성 검토)
- 완료 기준 (iOS·Android 각각): 휴대폰 스피커·마이크와 블루투스 헤드셋에서 캡처+재생 동시, 상대 통역이 내 마이크로 다시 번역되는 에코 루프 없음, 프레임 간격·끊김 측정값 기록. 웹 e2e·서버 시험 회귀 통과
- 주의: 앱 다른 코드는 `DuplexAudio` 에만 의존하므로 다른 파일은 바꾸지 않는 것이 원칙. 블루투스 확인이 안 되면 S6 로 넘겨도 된다(사용자 결정)

### T4. S4 휴대폰 2대 1:1 스트리밍 통화 ⬜ — 선행: T3
- 무엇: Android ↔ iPhone 통화로 스트리밍 전체 확인 (가짜 엔진으로 기능, 실제 OpenAI 로 지연)
- 완료 기준: 계획 완료 기준 1–5 (`docs/streaming-plan.md` 1절) 중 기능 항목 통과, 실제 OpenAI 몇 회 지연 측정 기록
- 주의: 실제 OpenAI 비용 약 $0.2–0.5 (실행 전 안내, 실행 상한)

### T5. S6 실기기 튜닝 ⬜ — 선행: T4
- 무엇: 20회 이상 지연 측정(P50·P90), 무음 판단 300–400ms(`STREAM_VAD_SILENCE_MS`)·추론 minimal(`TRANSLATION_REASONING`) 실험, 현장 소음, 블루투스, 배터리·발열
- 완료 기준: P50 ≤ 2.0초·P90 ≤ 3.0초 결과표, `docs/live-interpretation.md`·운영 문서 갱신
- 주의: 비용 약 $3–6 → 서버 한도(`OPENAI_BUDGET_USD`, 지금 $3, 누적 약 $0.34) 상향 전 금액 안내·승인

### T6. 실기기 전용 확인 묶음 ⬜ — 선행: T1 (T2 와 함께)
- 비밀번호 재설정 메일 링크 → 앱 열림 → 새 비밀번호 저장 (요청한 같은 휴대폰에서 메일을 열어야 함 — PKCE)
- 사람 목소리로 받아쓰기 확인 ("비계", "거푸집", "B문", 숫자)
- 작업조·관리자 지정·대상 선택 화면의 네이티브 표시
- 완료 기준: `docs/device-test-log.md` 기록

### T7. 다른 팀원·나중 작업 (지금 진행 대상 아님)
- 실제 노이즈 필터: `server/src/plugins/streamAudioFilter.ts`(조각, 50ms 제한) / `audioPreprocessor.ts`(문장 전체, 3초 제한)에 등록 — `docs/operations.md` 5절
- 현장 용어 데이터 보강 (데이터셋 어댑터 교체, 코드에 용어를 넣지 않는다)
- 업무용 메일 서비스(지금 개인 Gmail, 하루 약 500통), UI 문구 원어민 검수, 백그라운드 통화, 그룹 실시간 통역, 푸시 알림

---

## 5. 실기기 준비 및 검증 체크리스트

**준비 상태: ⬜ 미완료** (2026-10-14 사용자: 아직 준비 어려움). 에뮬레이터·시뮬레이터·웹에서 된 것은 실기기 검증이 아니다.

### 필요한 기기·준비물
- [ ] **Android 휴대폰 1대 이상** (Android 12 이상 권장 — 블루투스 통화 경로 지정 API 가 31+) + USB 케이블
- [ ] **iPhone 1대 이상** + USB 케이블 + **Apple 계정** (무료 계정은 설치한 앱이 7일마다 만료 → 다시 설치)
- [ ] 2인 통화 시험(T4)에는 휴대폰 **2대** (Android + iPhone 조합이면 두 플랫폼을 한 번에 확인)
- [ ] **통화용(HFP 지원) 블루투스 헤드셋 1개 이상** (음악 전용 이어폰은 마이크가 안 될 수 있음), 가능하면 2개
- [ ] 휴대폰과 PC 가 **같은 Wi-Fi** (회사·학교 Wi-Fi 는 기기끼리 통신을 막을 수 있음 — 안 되면 휴대폰 핫스팟에 PC 를 연결)

### 휴대폰 설정
- Android: 설정 → 휴대전화 정보 → 빌드번호 7번 눌러 **개발자 옵션** 켜기 → **USB 디버깅** 켜기 → PC 에 연결 후 "USB 디버깅 허용" 수락
- iPhone: PC 연결 후 "이 컴퓨터를 신뢰" → (iOS 16 이상) 설정 → 개인정보 보호 및 보안 → **개발자 모드** 켜기(재시동) → 처음 설치 후 설정 → 일반 → VPN 및 기기 관리에서 개발자 앱 **신뢰**
- 앱 첫 실행 때 **마이크 권한 허용**

### PC 와 연결 확인
```bash
~/Library/Android/sdk/platform-tools/adb devices -l    # Android: "device" 로 보여야 함 (unauthorized 면 휴대폰에서 허용)
xcrun devicectl list devices                           # iPhone (Xcode 에서 기기 등록·서명 팀 선택 필요할 수 있음)
ipconfig getifaddr en0                                 # PC 의 Wi-Fi IP
```

### 앱 설치와 실행 (live 모드 = 실제 PC 서버 접속)
1. 서버: `cd server && npm run db:start` / `cd server && ENGINE=fake npm run dev` (흐름 확인, 비용 0). 휴대폰 브라우저로 `http://<PC IP>:4000/health` 가 열리는지 확인 — 안 되면 macOS 방화벽에서 node 들어오는 연결 허용
2. `frontend/.env` 를 live 모드로: `EXPO_PUBLIC_API_MODE=live`, `EXPO_PUBLIC_API_BASE_URL=http://<PC IP>:4000` (Android 는 USB 에 `adb reverse tcp:4000 tcp:4000` 을 하면 `http://localhost:4000` 도 가능). **값을 바꾸면 Metro 를 다시 시작**(`--clear` 권장). 원래 값(`mock`, `http://10.0.2.2:4000`)으로 되돌릴지는 작업 후 사용자와 정한다
3. Android 빌드·설치: 빌드 전 `rm -rf frontend/android/app/.cxx frontend/android/app/build` (예전 경로 캐시) → `export JAVA_HOME=<JDK 21>` → `cd frontend && npx expo run:android --device` (기기 선택)
4. iOS 빌드·설치: `cd frontend && npx expo run:ios --device` (서명 팀 필요 시 Xcode 에서 `frontend/ios/SYNCREW.xcworkspace` 열어 Signing 설정). `frontend/ios/` 는 예전 경로에서 만든 것 — 오류가 나면 `npx expo prebuild --platform ios --clean` 으로 다시 생성
5. 개발 빌드가 Metro 에 붙지 않으면: Android `adb reverse tcp:8081 tcp:8081`, iPhone 은 같은 Wi-Fi 에서 Metro 주소(`http://<PC IP>:8081`) 입력
6. 로그인: 테스트 계정(`server/.e2e-accounts.json`) 두 개를 휴대폰 두 대에 각각

### 실기기에서 반드시 확인할 시나리오 (iOS·Android 각각, 결과는 아래 기록 방법대로)
| ID | 시나리오 | 통과 기준 |
|---|---|---|
| A | 로그인·현장 입장·1:1 문자 대화 (실제 서버) | 상대 언어로 번역되어 도착 |
| B | 1:1 통역 통화 — **지금 휴대폰은 문장 단위로 자동 전환**되어야 함 (통화 화면에 "문장 단위 통역" 표시) | 휴대폰 마이크로 말하면 상대에게 번역 음성 재생 |
| C | 같은 통화를 **블루투스 헤드셋**으로 | 헤드셋 마이크로 녹음되고 헤드셋으로 들림, 멤버 화면에 헤드셋 이름 표시 |
| D | 관리자 실시간 일괄 지시 + 문자 지시(작업조 칩 사용) + 구성원 확인 | 선택한 사람만 수신, 확인 응답 반영 |
| E | 비밀번호 찾기 → 같은 휴대폰에서 메일 링크 → 앱 열림 → 새 비밀번호 | 새 비밀번호로 로그인 |
| F (S3 후) | **스트리밍 통화**: 통화 화면 "실시간 통역 · 말하는 동안 전송", 실시간 자막, 중복 재생 없음 | 상대가 말 끝 후 약 2초 안에 통역을 들음, 같은 문장이 두 번 재생되지 않음 |
| G (S3 후) | 스피커폰 에코: 헤드셋 없이 스트리밍 통화 | 상대 통역이 내 마이크로 다시 번역되지 않음 |
| H (S3 후) | 헤드셋 연결·해제 중 통화 / 와이파이 잠깐 끊기 / 같은 언어 통화(직접 전달) | 통화 유지 또는 문장 단위로 자동 전환 |

### 에뮬레이터·시뮬레이터·웹에서만 확인한 것 → 실기기 재확인 필요
- 말소리 자동 감지(VAD): 웹 가짜 마이크로만 확인 (에뮬레이터 마이크는 말소리가 안 들어왔음)
- 통화·일괄 지시 화면 흐름: Android 에뮬레이터(Phase 6), iOS 는 시뮬레이터 첫 화면만
- 스트리밍 전체(재생·자막·중복 방지·폴백): 웹 헤드리스 Chrome 만
- 실제 OpenAI 스트리밍: PC 웹에서만 2회
- iOS 시작 화면 로고: 시뮬레이터에서 정상(예전 문제 재현 안 됨)

### 결과 기록 방법
- `docs/device-test-log.md` 에 날짜·기기(모델/OS)·헤드셋·앱 빌드(커밋)·서버 모드(fake/openai)·시나리오 ID·결과(통과/실패)·증상·원인·해결 여부를 표로 남긴다 (서식은 그 파일에 있음)
- 실패는 재현 절차와 화면 캡처·로그 위치를 함께 적고, 고친 커밋 번호를 적는다
- 실제 OpenAI 를 쓴 경우 비용(서버 `/health` 의 `budget.spentUsd` 전후)을 적는다

---

## 6. 주의 사항 및 재작업 방지 정보

### 바꾸면 안 되는 결정 (사용자 결정, 근거 문서)
- 단계마다 멈추고 승인받는다. 커밋·푸시는 사용자가 요청할 때만 (`CLAUDE.md`)
- **OpenAI 비용**: 충전 잔액 $80 이지만 "막 쓰지 말 것". 서버 한도 `OPENAI_BUDGET_USD=3`(누적, 2026-10-14 누적 약 $0.34). **실제 호출 전 예상 비용을 말하고 실행 상한을 건다.** 한도를 올릴 때는 금액을 먼저 알린다. 흐름 확인은 `ENGINE=fake`
- 번역 모델 **`gpt-realtime-2.1` 유지**, 번역 전용 `gpt-realtime-translate` 는 쓰지 않음 (현장 용어·숫자 오역 6/9, 지시문·용어집 불가, 우즈베크어 출력 불가 — `docs/s0-report.md` 4절)
- 받아쓰기 `gpt-4o-transcribe`, 현장 용어 힌트는 쓰지 않음 (오히려 나빠짐 — `docs/streaming-plan.md` 5-2절)
- 스트리밍은 **1:1 통화만**, 일괄 지시는 문장 단위 유지. 같은 언어 통화는 OpenAI 없이 음성 직접 전달. 실패한 문장은 기록 안 함. **스트림으로 들은 문장은 다시 재생하지 않음**
- OpenAI 세션 안 문맥은 응답마다 삭제, 직전 1–2문장을 텍스트로 지시문에 (DB 기록은 그대로)
- 음성 경로: 우리 서버 경유(Socket.IO + PCM). 발화 단위 방식은 폴백으로 유지
- 목표 지연 P50 ≤ 2.0초·P90 ≤ 3.0초 (1.5초는 S6 목표)
- **시험은 iOS·Android 모두**. 먼저 구현하고 실기기에서 고친다
- 노이즈 필터는 **서버**에서. 현장 용어 데이터는 어댑터로 교체 (코드에 용어를 넣지 않는다)
- 데이터는 로컬 Postgres, Supabase 는 인증만. 비밀 값(`OPENAI_API_KEY`, `SUPABASE_SECRET_KEY`, Gmail 앱 비밀번호)은 `.env`·Supabase 화면에만 — 문서·대화·커밋에 적지 않는다 (커밋 전 `git grep --cached -nE "sk-proj-|sb_secret_"`)
- Prisma 의 `migrate reset` 은 우회하지 말고 새 마이그레이션 추가

### 알려진 문제·시행착오 (다시 겪지 않기)
- **서버 끄기**: `npm run dev` 는 `tsx watch src/index.ts` 라 `pkill -f "tsx src/index.ts"` 로는 안 꺼진다 → `pkill -f "src/index.ts"`. DB 는 래퍼만 꺼지고 postgres 가 남을 수 있다 → `pg_ctl ... stop -m fast` (3절 명령). 끝난 뒤 4000·5433 포트 확인
- `expo start` 가 `frontend/tsconfig.json` 을 고쳐 쓴다 → 작업 후 `git checkout -- frontend/tsconfig.json`
- 웹 빌드는 mock/live 설정이 섞이므로 `--clear` 로 (npm 스크립트에 반영됨)
- 헤드리스 Chrome: 비밀번호 입력 뒤 키 이벤트를 잃음(e2e 는 IME 경로 입력), 가짜 마이크 파일은 `--disable-features=AudioServiceSandbox` 필요, **클릭 중 뜬 확인 창을 수락 전에 닫는 경우가 있음**(데모 e2e 는 `window.confirm` 을 "확인"으로 바꿔 둠)
- 앱이 음성 조각을 `socket.volatile` 로 보내면 바쁠 때 버려져 말 앞부분이 사라졌다 → 일반 emit 사용 (S2 실제 OpenAI 확인에서 발견)
- 서버는 `stream:out:end`(messageId) 를 같은 문장의 `message:new` 보다 **먼저** 보내야 한다 (순서가 바뀌면 중복 재생 — 서버 테스트로 고정)
- 알림(토스트)이 사라지는 동안 새 알림이 오면 새 알림까지 지워지던 버그 → id 로 닫기 (수정됨)
- Expo 패치 후 `expo-modules-core` 가 하위 폴더에 설치되어 타입이 깨진 적 있음 → `node_modules`·`package-lock.json` 새로 설치로 해결
- 받아쓰기 단가: mini 음성 입력을 $1.25 로 잘못 두었다가 $3 로 수정 (이전 기록은 약 2.4배 적음)
- Supabase 대시보드의 "Send password recovery" 는 앱 주소 없이 보내 링크가 Site URL(`localhost:3000`)로 간다 — 정상. 실제 사용자는 앱의 "비밀번호 찾기"로 요청
- `frontend/android/app/.cxx` 등 빌드 캐시에 예전 한글 경로가 남아 있음 → 다음 Android 빌드 전 삭제
- 이 문서를 쓰던 세션은 예전 경로에서 시작해 셸이 동작하지 않았다 → **새 세션은 반드시 `/Users/taewoongjang/PlayGround/SYNCREW` 에서 시작**

### 참고 문서
| 문서 | 내용 |
|---|---|
| `CLAUDE.md` | 작업 규칙·상태 표·결정 표·명령 |
| `docs/streaming-plan.md` | Phase 7 계획·결정(0-1·0-2절)·S1(4-1)·S2(5-1)·실기기 없이 마무리(5-2) |
| `docs/s0-report.md` | OpenAI 스트리밍 측정, 네이티브 오디오 후보 조사(2절), 번역 전용 모델 비교(4절) |
| `docs/implementation-plan.md` | Phase 별 완료 내용·검증·커밋 |
| `docs/operations.md` | 설치·실행·비용·플러그인(5절)·확인 도구(6절)·기기 실행(7절)·Supabase(8절) |
| `docs/realtime-protocol.md` | Socket.IO 이벤트 (10절 스트리밍) |
| `docs/api-specification.md` | REST API (11절 세션, 12절 작업조) |
| `docs/live-interpretation.md`, `docs/phase4-report.md`, `docs/phase6-report.md` | 문장 단위 통역 구조, 에뮬레이터 실행 명령, Phase 6 결과 |

---

## 7. 가장 먼저 할 다음 작업

### 선정: **실기기 준비 상태 확인 → (준비됐으면) T2 Android 실기기 기준선 확인**

선정 이유:
1. 남은 핵심 작업(S3·S4·S6)과 미확인 항목 대부분의 **선행 조건이 실기기**이고, 실기기 준비 여부가 **확인되지 않았다**(마지막 상태: 2026-10-14 "아직 준비 어려움").
2. 실기기 없이 할 수 있는 작업은 2026-10-14 에 모두 끝냈다 (남은 것은 다른 팀원 몫·나중 작업).
3. 스트리밍(S3)부터 하면 네트워크·권한·헤드셋 문제와 오디오 구현 문제가 섞인다 → **이미 만든 기능(문장 단위)으로 실기기 환경을 먼저 검증**해야 재작업이 줄어든다.

### 실행 순서
1. 사용자에게 확인: 지금 쓸 수 있는 **휴대폰(Android/iPhone, 모델·OS 버전), 블루투스 헤드셋, Apple 계정**이 있는지, PC 에 연결했는지
   - 준비 안 됨 → 5절 "필요한 기기·준비물"·"휴대폰 설정"을 그대로 안내하고, 준비되면 다시 시작하자고 한다 (다른 작업을 임의로 시작하지 않는다)
2. 준비됨 → 연결 확인: `adb devices -l`, `xcrun devicectl list devices`, `ipconfig getifaddr en0`, `df -h /System/Volumes/Data`
3. 기준선 확인 (git 상태·자동 시험): `git status`, `git log --oneline | head -3`, `cd server && npm run typecheck && npm test`(200), `cd frontend && npm run typecheck && npm run test:unit`(18)
4. 서버 실행 (`ENGINE=fake`), 휴대폰 브라우저로 `http://<PC IP>:4000/health` 확인
5. `frontend/.env` live 모드 설정 (5절 2번, 바꾸기 전 사용자에게 알림) → Android 캐시 삭제 → JDK 21 → `npx expo run:android --device`
6. 시나리오 A–E 진행 (B 는 "문장 단위 통역" 표시가 정상), 결과를 `docs/device-test-log.md` 에 기록
7. iPhone 도 같은 순서 (`npx expo run:ios --device`)
8. 보고: 기기·통과/실패·발견한 문제·다음(S3 시작 여부) → 멈추고 승인

### 확인 방법 (완료 판단)
- `docs/device-test-log.md` 에 Android(와 iPhone) 시나리오 A–E 결과가 있고, 실패 항목은 원인·해결 계획이 적혀 있다
- 서버·앱 자동 시험이 그대로 통과한다
- 서버·DB 를 껐다 (4000·5433 포트 비어 있음), `frontend/tsconfig.json` 원복

---

## 8. 작업 재개용 프롬프트 (새 세션에서 그대로 사용)

```
/Users/taewoongjang/PlayGround/SYNCREW 프로젝트를 이어서 하자.
먼저 CLAUDE.md 와 docs/HANDOFF.md 를 읽고, HANDOFF.md 의 "새 세션 응답 규칙"대로
현재 상황 요약과 가장 먼저 할 작업 하나를 단계별로 알려줘.
실기기 준비 상태부터 확인해 주고, 실제 OpenAI 를 쓰는 작업은 하기 전에 예상 비용을 먼저 말해 줘.
단계가 끝나면 보고하고 멈춰.
```

(실기기를 이미 준비했다면 한 줄을 더한다: `실기기 준비했어: Android <모델>, iPhone <모델>, 헤드셋 <모델>. PC 에 연결해 뒀어.`)

---

## 새 세션 응답 규칙 ("이제 할 일이 뭐지?", "다음에 뭘 하면 돼?", "이어서 하자" 라고 하면)

1. **현재 진행 상황을 짧게 요약**한다 (완료된 단계, 지금 멈춘 지점: 7절).
2. **지금 당장 할 가장 우선순위 높은 작업 하나**를 명확히 말한다 — 7절의 선정 작업. 단, 문서 작성 이후 상태가 바뀌었을 수 있으니 `git log`·`docs/device-test-log.md`·사용자 답으로 먼저 확인하고, 이미 끝난 일은 다시 시키지 않는다.
3. 그 작업의 **단계별 절차**를 준다: 필요한 파일·명령·설정·확인 방법 포함 (7절 실행 순서, 5절 절차).
4. **실기기 준비가 끝나지 않았으면 반드시 먼저 알리고**, 준비해야 할 것(5절 기기·준비물·휴대폰 설정)을 가장 먼저 안내한다. 실기기가 필요한 작업을 에뮬레이터·웹 결과로 완료 처리하지 않는다.
5. 실기기 검증이 남아 있으면 **어떤 기능을 어떤 방식으로** 검증할지 알려 준다 (5절 시나리오 A–H, 재확인 목록).
6. 작업이 끝나면 **무엇을 확인하고 무엇을 보고할지** 설명한다: 실행한 시험과 결과, 실기기 결과 기록(`docs/device-test-log.md`), 미검증 항목, 알려진 문제, 다음 단계. 그리고 멈춰서 승인받는다.
7. 선행 조건이나 정보가 부족하면 그 사실을 밝히고, **꼭 필요한 경우에만** 질문한다 (예: 기기 준비 여부, `.env` 값 변경 허락, 실제 OpenAI 비용 승인).
8. 여러 선택지를 나열하고 끝내지 말고, 읽은 직후 바로 행동할 수 있게 안내한다.
9. 비용 규칙(6절)과 사용자 결정(6절)을 지킨다. 실제 OpenAI 호출 전에는 예상 비용을 말한다.
