# Phase 4 작업 정리 — 통역 파이프라인 + 1:1 대화

- 작업일: 2026-10-12
- 상태: **완료, 커밋 `fd2caf0`** (가짜 엔진으로 검증). 실제 OpenAI 호출 확인은 나중에 하기로 함.
- 세부 기준 문서: [implementation-plan.md](implementation-plan.md) Phase 4 절. 설계 변경은 각 docs 문서에 반영함.

## 한눈에 보기

| 항목 | 결과 |
|---|---|
| 서버 테스트 | **106개 모두 통과** (기존 75 + 신규 31), 타입 검사 통과 |
| 앱 타입 검사 | 통과 |
| 필수 시나리오 자동 검증 | 5, 6, 9, 12, 13, 14, 15 (가짜 엔진, 실제 DB·실시간 연결) |
| 번역 모델 | `gpt-realtime-2` → **`gpt-realtime-2.1`로 교체** (사용자 결정, 같은 가격) |
| 기존 버그 | DB 시각 9시간 어긋남 발견·수정 |
| 실제 OpenAI 호출 | 미실행 (API 키 미입력, 나중에 진행) |
| iOS·Android 실행 확인 | **두 플랫폼 빌드·실행 성공** (데모 모드). Android는 주요 화면까지 직접 조작 확인, iOS는 첫 화면까지 |

## 1. 만든 것

### 통역 흐름
앱이 메시지를 보내면 서버는 바로 "접수됨(202)"으로 답하고, 뒤에서 아래 순서로 처리한다.

```
음성 업로드(m4a) → 16kHz 변환 → 노이즈 필터(플러그인) → 음성 인식(STT)
  → 현장 용어 보정 → 대상 언어별 1회 번역(음성+텍스트) → 번역 음성 저장
  → 그 언어의 수신자에게 실시간 전달, 발신자에게 처리 상태 알림
```

- 텍스트 메시지는 음성 인식 단계를 건너뛴다.
- 받는 사람 언어가 보낸 사람과 같으면 번역하지 않고 원문을 그대로 전달한다.
- 그룹·일괄 지시처럼 받는 사람이 많아도 **언어마다 한 번만** 번역한다.
- 음성 인식·번역은 실패하면 2번 더 시도한다. 비용 한도 초과는 다시 시도하지 않는다.
- 노이즈 필터가 오류를 내면 원본 음성으로 계속 진행한다.
- 서버가 처리 도중 꺼지면 다시 켤 때 멈춘 메시지를 이어서 처리한다.
- 단계별 처리 시간(ms)을 DB에 기록한다 (지연 측정용).

### 서버 기능

| 구분 | 내용 |
|---|---|
| DB | 메시지, 언어별 번역, 수신자별 전달 상태 테이블. 중복 전송 방지 제약. 안 읽은 수 계산용 "마지막 읽은 위치" |
| API | 대화 목록, 1:1 대화 열기(같은 두 사람은 1개만), 메시지 목록·전송(텍스트/음성)·재시도, 번역 음성 재생, 재접속 동기화 |
| 실시간 | 새 메시지는 수신자에게, 처리 상태는 발신자에게. 앱의 수신 확인을 DB에 반영 |
| OpenAI 연동 | 음성 인식 `gpt-4o-mini-transcribe`, 번역 `gpt-realtime-2.1`. 2026-10-12 공식 문서로 규격 확인. 모든 호출이 $5 한도 관리를 거침 |
| 가짜 엔진 | `ENGINE=fake`로 서버를 켜면 키 없이 동작 ("[vi] 원문" 형식). 앱 연동 확인용 |

### 앱 변경
- 번역 음성 재생 시 서버 주소를 앞에 붙이도록 수정 (`frontend/src/audio/playback.ts`). 나머지 화면은 이미 만들어 둔 것을 그대로 쓴다.

## 2. 결정 사항 (승인 완료)

| 결정 | 이유 | 상태 |
|---|---|---|
| 번역 음성은 **사용자별 서명 링크**(24시간 유효)로 재생 | 앱의 음성 플레이어는 로그인 토큰을 보낼 수 없음. 다운로드 때 권한을 다시 확인해 제외된 사람은 재생 불가 | 승인 |
| 녹음 파일은 서버에 저장한 뒤 변환 | 휴대폰 m4a는 파일 끝에 색인이 있어 스트림으로 읽을 수 없음. 재시도 때 다시 인식하는 데도 씀 | 승인 |
| 음성 인식 단가 $3 → **$1.25** (1M 토큰당) | 공식 가격 확인 | 승인, 비용 주석 추가 |
| 번역 모델 **`gpt-realtime-2.1`** | 같은 가격의 후속 모델 (잡음·끼어들기 처리 개선). 통신 규격 동일 | 교체 완료 |

## 3. 비용 추정 (메시지 1건)

계산 근거는 `server/src/engine/budget/pricing.ts` 주석에 있다. 가정: 5초 말하기 → 번역 음성 약 3초.

| 경우 | 1건 비용 | $5로 가능한 양 |
|---|---|---|
| 1:1 음성 메시지 (언어 1개) | 약 $0.008–0.01 | 약 500–600건 |
| 텍스트 메시지 (언어 1개) | 약 $0.007–0.009 | 약 550–700건 |
| 번역 음성 끄기 (`TRANSLATION_AUDIO=off`, 기기 음성으로 재생) | 언어당 약 $0.003–0.005 | 약 1,000건 이상 |
| 그룹·일괄 지시 | 위 금액 × **대상 언어 수** (사람 수 아님) | — |

- 비용 대부분은 번역 음성 생성이다. 음성 1초당 토큰 수와 추론 토큰 수는 공식 수치가 아니라 추정값이다.
- 실제 비용은 호출마다 `openai_usage` 테이블에 기록되므로, API 테스트 때 이 표를 실제 값으로 고친다.

## 4. 발견해서 고친 기존 버그

**DB에 저장되는 시각이 9시간 어긋나 있었다.**
- 원인: 로컬 DB 시간대가 서울인데, Prisma의 DB 연결 모듈은 시각을 시간대 정보 없이 주고받는다.
- 영향: 서버 코드끼리만 쓸 때는 티가 안 났지만, DB 기준 시각과 비교하는 기능(재시작 복구, 동기화)이 틀어진다.
- 조치: DB 연결 시간대를 UTC로 고정 (`server/src/lib/prisma.ts`). 재발 방지 테스트를 추가하고, 수정을 빼면 테스트가 실패하는 것도 확인했다.
- 남은 영향: 로컬 개발 DB(`server/.pgdata`)에 이미 저장된 시각은 9시간 어긋나 있다. 개발용 데이터라 그대로 둠.

## 5. 검증

### 자동 테스트 (106개 통과)

| 묶음 | 수 | 확인한 것 |
|---|---|---|
| 대화·통역 통합 테스트 | 20 | 실제 DB·실시간 연결, 가짜 엔진. 아래 시나리오 표 참고 |
| OpenAI 연동 규격 | 7 | 로컬에 띄운 가짜 OpenAI 서버로 요청 형식, 응답 처리, 사용량→비용 기록, 오류·시간 초과 시 비용 미기록, 한도 초과 시 미연결 확인. 비용 0원 |
| 음성 변환·링크 서명 | 4 | WAV 변환 왕복, 잘못된 파일 거부, 위조·만료 링크 거부 |
| 기존 (Phase 1–3) | 75 | 그대로 통과 |

| 시나리오 | 내용 | 결과 |
|---|---|---|
| 5 | 관리자(한국어) ↔ 작업자(베트남어) 1:1 텍스트·음성 양방향 통역. 실제 m4a 파일 사용 | 통과 |
| 6 | 1:1 메시지는 상대만 받음 (같은 현장 다른 사람은 못 받음, 대조군 포함) | 통과 |
| 9 | 한 언어 번역이 실패해도 다른 언어 수신자는 정상 수신. 재시도하면 실패한 사람만 받음 | 통과 |
| 12 | 제외된 사람은 대화·음성 링크 접근 불가 | 통과 |
| 13 | 같은 메시지를 여러 번(동시에도) 보내도 1건만 생성 | 통과 |
| 14 | 노이즈 필터를 바꾸면 그 필터가 호출되고, 오류 나면 원본으로 진행 | 통과 |
| 15 | 현장 용어 데이터를 바꾸면 보정 결과와 번역 용어가 바뀜 (대조군 포함) | 통과 |

### 실제 서버 실행
- `ENGINE=fake`로 서버 실행: 상태 점검 정상, 로그인 없는 요청 거부, 위조 음성 링크 거부, 오류 로그 없음.

## 6. 아직 확인하지 못한 것

| 항목 | 필요한 것 |
|---|---|
| 실제 OpenAI 호출 (5개 언어 번역 품질, 단계별 지연, 실제 비용) | OpenAI API 키 (`cd server && npm run setup:openai`) — 나중에 진행 |
| 우즈베크어 음성 인식 지원 여부 | 위와 같음. 안 되면 언어 지정 없이 인식하도록 바꿀 예정 |
| 앱 live 모드 ↔ 서버 실제 통신 | 실제 Supabase 계정 (테스트 계정 생성 허락) |
| 블루투스 헤드셋 녹음·재생 | 실제 휴대폰 |
| iOS 시뮬레이터 화면 이동 | 시뮬레이터 조작 도구 없음 — 첫 화면만 확인 (7절) |
| 마이크 녹음·음성 재생·QR 카메라 | 실제 휴대폰 (에뮬레이터에서 미확인) |

## 7. iOS·Android 실행 확인

데모(mock) 모드, 개발 빌드(`expo run:*`)로 확인했다. **앱 코드 수정 없음** — 실행을 막는 앱 버그는 없었고, 막힌 것은 모두 PC 환경 문제였다.

| | Android (Pixel_9_Pro_XL 에뮬레이터) | iOS (iPhone 16 Pro 시뮬레이터, iOS 18.5) |
|---|---|---|
| 빌드 | 성공 (원래 경로, 약 20분) | 성공 (0 error) — 단, 영문 경로 복사본에서 |
| 실행 | 첫 화면 정상, 오류 없음 | 첫 화면 정상, 오류 없음 |
| 화면 이동 | 언어 전환(베트남어) → 로그인 → 프로필 설정 → 현장 목록 → 현장 대화 → 1:1 대화(번역문·원문·다시 듣기) → 지시 탭 | 못 함 (시뮬레이터를 누를 도구 없음) |
| 로그 | 앱 강제 종료·JS 오류 0건 | JS 오류 0건 |

**환경 문제 두 가지 (앞으로 빌드할 때 필요)**
1. **Android는 JDK 21로 빌드해야 한다.** 셸 기본(JDK 26)·Android Studio 내장(JDK 25)으로는 네이티브(CMake) 단계에서 실패한다.
2. **iOS는 프로젝트 경로에 한글이 있으면 `pod install`이 실패한다** (`hermes-engine.podspec` 인코딩 오류, 언어 환경 변수로도 해결 안 됨). 이번에는 영문 경로에 복사해 빌드하고 JS는 원래 폴더에서 제공했다. 근본 해결은 프로젝트를 영문 경로로 옮기는 것이다.

- 빌드가 만든 `frontend/ios/`, `frontend/android/`는 git 제외 폴더라 커밋되지 않는다. 빌드 도구가 자동으로 고친 `app.json`·`package.json`·`tsconfig.json`은 원래대로 되돌렸다.
- 스크린샷 13장은 작업 임시 폴더에 있다 (첫 화면, 베트남어 전환, 로그인, 프로필, 현장 목록, 대화, 1:1 대화, 지시).
- 에뮬레이터에서 처음에 "System UI isn't responding" 창이 한 번 떴는데, 에뮬레이터 부하로 인한 시스템 UI 문제였고 앱과 무관했다.

다시 실행하는 명령:

```bash
cd frontend
npx expo prebuild --no-install
CI=1 npx expo start --dev-client --port 8081      # 터미널 1: Metro

# Android (JDK 21 필수)
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk
~/Library/Android/sdk/emulator/emulator -avd Pixel_9_Pro_XL &   # 부팅 완료 후
npx expo run:android --no-bundler
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "syncrew://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.syncfield.syncrew

# iOS: 한글 경로 문제로 영문 경로 복사본에서 네이티브만 빌드 (JS는 위 Metro가 제공)
mkdir -p /tmp/x/server/src && cp -cR frontend /tmp/x/frontend && cp -R server/src/shared /tmp/x/server/src/shared
cd /tmp/x/frontend && rm -rf ios/Pods && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --device <시뮬레이터 UDID> --no-bundler
xcrun simctl openurl booted "com.syncfield.syncrew://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

## 8. 알려진 제약

- 음성 링크 서명 키(`AUDIO_URL_SECRET`)를 비워 두면 서버를 다시 켤 때 이전 링크가 무효가 된다. 앱이 목록을 다시 받으면 새 링크가 생긴다.
- 그룹에 나중에 들어온 사람은 가입 전 메시지를 보지 않는다 (의도된 동작).
- 작업 대기열과 비용 예약은 서버 1대 기준이다.
- 업로드된 원본 음성은 재시도를 위해 보관한다. 언제 지울지는 보존 정책 플러그인(다른 개발자 담당)이 정한다.

## 9. 실행 방법

```bash
# 키 없이 서버 확인 (가짜 통역)
cd server && npm run db:start                              # 터미널 1
cd server && npm run db:deploy && ENGINE=fake npm run dev  # 터미널 2

# 테스트
cd server && npm run typecheck && npm test   # 106개
```

새 설정값 (`server/.env.example` 참고): `ENGINE`, `TRANSLATION_AUDIO`, `TRANSLATION_CONCURRENCY`, `TRANSLATION_REASONING`, `TRANSLATION_VOICE`, `STORAGE_DIR`, `AUDIO_URL_SECRET`. `TRANSLATION_MODEL` 기본값은 `gpt-realtime-2.1`.

## 10. 바뀐 파일

**새 파일 (서버)**
- `prisma/migrations/20261012000714_phase4_messages/` — 메시지 테이블
- `src/messaging/` — 통역 처리 순서(`pipeline.ts`), 대화 조회, 화면용 변환, 파일 저장, 음성 링크 서명
- `src/routes/v1/conversations.ts` — 대화·메시지·음성 API
- `src/engine/stt/openAiStt.ts`, `src/engine/translation/realtimeTranslator.ts` — OpenAI 연동
- `src/engine/audio/codec.ts` — 음성 변환, `src/engine/budget/metered.ts` — 비용 한도 적용, `src/engine/fake.ts` — 가짜 엔진
- 테스트: `test/integration/messaging.test.ts`, `test/openAiEngines.test.ts`, `test/audioCodec.test.ts`

**수정 (서버)**: 스키마, 설정값, 서버 시작·종료(복구), 실시간 알림, 동기화 API, DB 연결(시간대), 단가표, 테스트 도우미. 추가 패키지: `multer`(업로드), `ffmpeg-static`(음성 변환), `ws`(OpenAI 연결).

**수정 (앱)**: `src/audio/playback.ts`(음성 링크), `src/services/mock/phrases.ts`(주석).

**문서**: CLAUDE.md, requirements, architecture, database-design, api-specification, realtime-protocol, security-and-testing-plan, current-codebase-analysis, implementation-plan.

## 11. 다음 단계

1. OpenAI 키 입력 후 실제 호출 확인: 5개 언어 왕복, 지연 측정, 실제 비용으로 3절 보정
2. (선택) 프로젝트를 영문 경로로 옮겨 iOS 빌드를 원래 위치에서 가능하게 하기
3. Phase 5 (그룹 대화 화면 검증 + 관리자 일괄 지시) — 승인 후 착수
