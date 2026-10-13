# 운영 안내 — 설치 · 실행 · 설정 · 플러그인 연결 · 확인 도구

로컬 PC 한 대에 서버를 띄우고, 같은 Wi-Fi의 휴대폰 앱이 접속하는 구성을 기준으로 한다 (MVP 결정사항).
처음 받는 사람이 이 문서만 보고 서버·앱을 띄우고 확인할 수 있게 쓴다. 2026-10-12 기준.

## 1. 준비물

| 항목 | 내용 |
|---|---|
| Node | 22 (npm 포함) |
| Postgres | 설치 불필요. `embedded-postgres`가 `server/.pgdata/`에 로컬 DB를 띄운다 (포트 5433) |
| ffmpeg | 설치 불필요 (`ffmpeg-static` 패키지) |
| Supabase | 인증 전용 프로젝트 1개 (이메일+비밀번호). 데이터는 저장하지 않는다 |
| OpenAI | API 키 (`server/.env`에만). 비용 한도는 4절 |
| 앱 빌드 | Android: Android SDK + **JDK 21**. iOS: Xcode. 프로젝트는 2026-10-14부터 영문 경로(`/Users/taewoongjang/PlayGround/SYNCREW`)라 원래 폴더에서 빌드 가능 (예전 한글 경로는 `pod install` 실패) |
| 확인 도구 | Chrome (`/Applications/Google Chrome.app`) — 웹 빌드 자동 확인(e2e)에 사용 |

## 2. 처음 설치

```bash
cd server && npm install
cp .env.example .env              # SUPABASE_URL·SUPABASE_JWKS_URL·SUPABASE_SECRET_KEY 입력
npm run setup:openai              # OpenAI 키 입력 (화면에 표시되지 않음, .env 권한 600)
npm run db:start                  # 터미널 1: 로컬 Postgres (계속 실행)
npm run db:deploy                 # 마이그레이션 적용

cd ../frontend && npm install
# frontend/.env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
#                EXPO_PUBLIC_API_MODE=mock|live, EXPO_PUBLIC_API_BASE_URL=http://<PC IP>:4000
```

- 앱에는 Supabase **publishable key만** 넣는다. `SUPABASE_SECRET_KEY`·`OPENAI_API_KEY`는 `server/.env`에만 둔다.
- `.env`, `server/.e2e-accounts.json`은 git에서 제외되어 있다. 커밋 전 `git grep --cached -nE "sk-proj-|sb_secret_"`로 키가 섞이지 않았는지 확인한다.

## 3. 실행

```bash
cd server && npm run dev                    # http://0.0.0.0:4000/health, 실시간 /rt
cd server && ENGINE=fake npm run dev        # OpenAI 없이 가짜 통역 ("[vi] 원문", 비용 0) — 화면·흐름 확인용
cd frontend && CI=1 npx expo start --dev-client --port 8081   # 앱 JS 제공 (개발 빌드)
```

- 휴대폰은 PC와 같은 Wi-Fi에서 `EXPO_PUBLIC_API_BASE_URL=http://<PC의 IP>:4000`으로 접속한다. Android 에뮬레이터는 `http://10.0.2.2:4000`.
- `EXPO_PUBLIC_API_MODE=mock`(기본)이면 서버 없이 데모 데이터로 동작한다. 실제 서버를 쓰려면 `live`.
- 서버를 끄면(Ctrl+C) 진행 중 통역을 최대 5초 기다린 뒤 종료한다. 다음 시작 때 멈춘 메시지를 다시 처리하고, 열린 통화·지시 세션을 닫는다.
- 작업이 끝나면 백그라운드 DB·서버를 끈다: 서버 `pkill -f "src/index.ts"` (`npm run dev` 는 `tsx watch src/index.ts` 라 "tsx src/index.ts" 패턴으로는 안 죽는다), DB `pkill -INT -f scripts/db.ts` 후에도 postgres 가 남으면 `cd server && node_modules/@embedded-postgres/darwin-arm64/native/bin/pg_ctl -D .pgdata stop -m fast`. 확인: `lsof -nP -iTCP:4000 -sTCP:LISTEN`, `lsof -nP -iTCP:5433 -sTCP:LISTEN` 이 비어 있어야 한다 (2026-10-13 확인).

## 4. 비용 관리 (OpenAI)

- 모든 OpenAI 호출은 `BudgetGuard`를 거친다. 호출 전 예상 비용을 예약하고, 끝나면 응답의 실제 토큰 수 × 단가(`server/src/engine/budget/pricing.ts`)로 `openai_usage` 테이블에 기록한다. 한도를 넘는 호출은 하지 않고 `BUDGET_EXCEEDED`(402)로 거절한다.
- **현재 설정 (2026-10-14)**: 충전 잔액 $80, 서버 한도 `OPENAI_BUDGET_USD=3`(누적). 막 쓰지 말고 실제 호출 전 예상 비용 안내·실행 상한. 한도를 더 올릴 때는 금액을 먼저 사용자에게 알린다. (이전: 10-12 잔액 $1.44 → 한도 $0.5)
- 사용량 확인: `cd server && npx tsx -e 'import "dotenv/config";import {createPrismaClient} from "./src/lib/prisma";const p=createPrismaClient(process.env.DATABASE_URL!);p.openAiUsage.aggregate({_sum:{costUsd:true}}).then(r=>{console.log(r._sum);return p.$disconnect()})'`
- 실제 단가(2026-10-12 측정, `docs/phase6-report.md` 2절): 음성 메시지 1건(STT + 번역 음성 1개 언어) 약 $0.010–0.013, 텍스트 번역(음성 없음) 약 $0.002–0.005. 비용 대부분은 번역 음성 생성이다. 아끼려면 `TRANSLATION_AUDIO=off`(앱 기기 TTS로 읽음).

## 5. 플러그인 연결 (다른 개발자 담당)

| 담당 | 파일 | 하는 일 | 설정 |
|---|---|---|---|
| 노이즈 필터 (서버에서 실행) | `server/src/plugins/audioPreprocessor.ts` | `AudioPreprocessor.process(PcmAudio) → PcmAudio`를 구현해 `PREPROCESSORS`에 이름으로 등록. 입력은 PCM16 mono 16kHz. **3초 제한**, 오류·시간 초과·잘못된 출력이면 원본으로 계속 | `.env`의 `AUDIO_PREPROCESSOR=<이름>` |
| 노이즈 필터 — 스트리밍 통화 (서버, 조각 단위) | `server/src/plugins/streamAudioFilter.ts` | `StreamAudioFilter.open(context) → { process(Int16Array 100ms) → 같은 길이 Int16Array, close? }` 를 구현해 `STREAM_FILTERS` 에 등록, `.env` `STREAM_AUDIO_FILTER` 에 이름. 조각당 **50ms 제한**, 오류·시간 초과·길이 다른 출력이면 원본, 연속 5번 실패하면 그 통화에서 끔 (`server/src/engine/audio/streamAudioFilter.ts`) | 시험: `server/test/integration/streaming.test.ts` "서버 노이즈 필터" |
| ~~노이즈 필터 (휴대폰에서 실행)~~ | `frontend/src/audio/preprocess.ts` | **쓰지 않음** — 2026-10-14 결정: 노이즈 필터는 서버에서 실행 | — |
| 현장 데이터셋 | `server/src/plugins/datasetAdapter.ts` | 방법 1: 정규화 JSON을 만들어 `DATASET_ADAPTER=normalized-json`, `DATASET_PATH=<파일>` (형식: `server/src/engine/dataset/normalizedJsonAdapter.ts`의 스키마). 방법 2: 원본 형식을 읽는 어댑터를 `ADAPTERS`에 등록 | `DATASET_ADAPTER`, `DATASET_PATH` |
| 데이터 보존 정책 | `server/src/plugins/retentionPolicy.ts` | `RetentionPolicy.run(ctx) → {deleted}` 구현 후 `POLICIES`에 등록. 서버가 매일 `RETENTION_RUN_AT`에 호출 | `RETENTION_POLICY`, `RETENTION_RUN_AT` |

- **노이즈 필터는 서버에서 실행한다 (2026-10-14 사용자 결정).** 발화 단위(녹음 전체)는 `AUDIO_PREPROCESSOR`, 스트리밍 통화(100ms 조각)는 `STREAM_AUDIO_FILTER` 에 등록한다. 둘 다 지금은 passthrough(필터 없음).
- 연결한 뒤에는 `cd server && npm test`로 확인한다. 전처리기 교체·오류 복구(시나리오 14), 데이터셋 교체(시나리오 15) 테스트가 이미 있다.
- 우즈베크어는 실제 확인에서 번역·인식 품질이 가장 낮았다 (`docs/phase6-report.md` 2절). 현장 데이터셋에 우즈베크어 용어·검증 문장을 넣는 것이 가장 효과가 클 것으로 본다.

## 6. 확인 도구

| 명령 | 확인하는 것 | 비용 |
|---|---|---|
| `cd server && npm run typecheck && npm test` | 서버 테스트 200개 (실제 Postgres + Socket.IO, 가짜 엔진. 스트리밍 29·작업조 8·역할 4·시작 시 정리 1 포함) | 0 |
| `cd server && npx tsx scripts/openai-check.ts [--targets vi,zh,uz,ru] [--reuse]` | **실제 OpenAI** 5개 언어 왕복: 한국어 음성(macOS say) → STT → 4개 언어 번역(음성) → 그 음성 STT → 한국어 번역. 단계별 지연·비용 출력. `--reuse`는 지난번 번역 음성을 다시 써서 번역 호출을 건너뜀. 실행 전 `npm run db:start` | 1회 약 $0.05–0.06 (한도 안에서만 실행) |
| `cd frontend && npm run typecheck && npm run doctor && npm run test:unit` | 앱 타입·Expo 설정·단위 테스트 18개 (발화 감지 VAD 11 + 일괄 지시 대상 선택·작업조 7) | 0 |
| `cd frontend && npm run bundle:web && npm run e2e` | 데모 모드 사용 흐름 99개 (헤드리스 Chrome, 일괄 지시 대상 선택·작업조·관리자 지정 포함) | 0 |
| `cd frontend && npm run bundle:web && npm run e2e:mic` | 실제 말소리(가짜 마이크 + 음성 파일)로 핸즈프리 자동 전송 + 무음 대조군 | 0 |
| `cd frontend && npm run bundle:web:live && npm run e2e:live` | **live 모드** 앱 ↔ 실제 서버 ↔ 실제 Supabase 계정: 로그인 → 현장 생성 → 코드 참여 → 승인 → 1:1 대화 → 통화(실제 녹음) → 실시간 지시 → 문자 지시. 준비: 테스트 계정(2026-10-12 생성됨, `server/.e2e-accounts.json`. 없으면 `cd server && npx tsx scripts/e2e-accounts.ts` — 사용자 허락 필요), `ENGINE=fake npm run dev`. **43개** (같은 언어 직접 전달 포함) (1:1 통화는 스트리밍: 방식 표시·번역 도착·자막·중복 재생 0, 대조군 포함). 옵션: `E2E_STREAMING=off`(서버를 `STREAMING=off` 로 띄웠을 때 폴백 확인, 33개), `E2E_ONLY_CALL=1`(통화만), `E2E_REAL=1`(서버가 실제 OpenAI 일 때: 양쪽 1턴씩 받으면 바로 끊음, 서버는 `OPENAI_BUDGET_USD=<누적+여유>` 로 상한) | 0 (가짜 엔진). 실제 OpenAI 서버면 통화만 약 $0.02–0.05 (승인 후) |
| `cd server && npx tsx scripts/stream-measure.ts [--dry-run] [--max-usd 0.2] [--only S1,S2]` | Phase 7 S0 ①: **실제 OpenAI Realtime 스트리밍** 측정 — 미리 만든 음성을 실시간 속도로 흘려 말 끝 → 첫 번역 음성 조각 시간, server_vad vs semantic_vad, 입력 토큰/초, 컨텍스트 증가, 질문 함정 문장. `--dry-run`은 음성 준비·계획·예상 비용만. 실행 전 `npm run db:start` | 전체 16턴 실측 약 $0.16 (턴당 약 $0.01, 상한 `--max-usd`, 기본 $0.2) — 승인 후. 결과 `server/stream-measure-output/`(git 제외), 보고 `docs/s0-report.md`. `--only S2b`는 semantic_vad 재측정용 |
| `cd server && npx tsx scripts/stt-hint-compare.ts [--dry-run] [--model gpt-4o-transcribe]` | 받아쓰기 모델·현장 용어 힌트 비교 (9문장 × 기본 안내/용어 힌트). 결과 `server/stt-hint-output/`(git 제외), 보고 `docs/streaming-plan.md` 5-2절 | 1회 약 $0.007 (mini) / $0.016 (4o) — 승인 후 |
| `cd server && npx tsx scripts/translate-compare.ts [--dry-run] [--max-usd 0.06]` | 번역 전용 모델 `gpt-realtime-translate` 측정 (S0 와 같은 문장, 지연·번역문·받아쓰기). 결과 `server/translate-compare-output/`(git 제외), 보고 `docs/s0-report.md` 4절 | 1회 약 $0.04–0.05 (승인 후) |
| `cd frontend && npm run e2e:latency [횟수]` | 서버 경로 지연: 관리자 음성 메시지 → 서버 → 구성원 실시간 수신 (live e2e로 두 계정이 같은 현장에 있어야 함) | `ENGINE=openai`면 1회 약 $0.006 (승인 후), fake면 0 |

- 웹 빌드 두 개(`dist-check` 데모, `dist-live` live)는 Metro 캐시가 설정을 섞으므로 `--clear`로 만든다 (package.json에 반영됨).
- 헤드리스 Chrome 가짜 마이크로 음성 파일을 넣으려면 `--disable-features=AudioServiceSandbox`가 필요하다 (없으면 무음). e2e 스크립트에 반영됨.
- 테스트 계정 삭제: `cd server && npx tsx scripts/e2e-accounts.ts --delete` (Supabase에서만 삭제, 로컬 DB 기록은 남음).

## 7. 기기에서 실행

`docs/phase4-report.md` 7절의 명령을 따른다. 요점:
- Android: `JAVA_HOME`을 JDK 21로 두고 `npx expo run:android --no-bundler`, `adb reverse tcp:8081 tcp:8081` 후 개발 빌드를 연다.
- iOS: 프로젝트가 영문 경로로 옮겨져(2026-10-14) 원래 폴더에서 `npx expo run:ios` 로 빌드한다 (아직 새 경로에서 실제 빌드는 안 해 봄). 빌드 전 `df -h /System/Volumes/Data`로 여유 공간을 확인한다.
- Android: 폴더를 옮긴 뒤 첫 빌드 전에 옛 경로가 남은 캐시를 지운다: `rm -rf frontend/android/app/.cxx frontend/android/app/build`.
- `expo start`가 `frontend/tsconfig.json`을 자동으로 고쳐 쓴다 (`.expo/types` 포함 항목 삭제). 작업 후 `git checkout -- frontend/tsconfig.json`으로 되돌린다.
- 에뮬레이터 조작은 uiautomator 화면 구조로 글자를 찾아 `adb shell input tap`으로 누른다 (Phase 6에서 사용한 방식, `docs/phase6-report.md` 4절).

## 8. Supabase 비밀번호 재설정 메일 (2026-10-14 정리)

### 앱 쪽 (구현되어 있음)
- "비밀번호 찾기" → `resetPasswordForEmail(email, { redirectTo: "syncrew://reset-password" })` (`frontend/src/services/live/supabaseAuth.ts`, PKCE 방식)
- 메일 링크 → Supabase 확인 주소(https) → `syncrew://reset-password?code=…` 로 앱이 열림 → `frontend/src/app/reset-password.tsx` 가 코드를 세션으로 바꾸고 새 비밀번호 입력
- **PKCE 라 재설정을 요청한 그 휴대폰에서 메일을 열어야 한다** (화면 안내 문구 `reset.sent` 에 있음). PC 에서 메일을 열면 앱 주소로 넘어가지 못한다
- 앱 주소(scheme)는 `syncrew` (`frontend/app.json`)

### Supabase 대시보드에서 할 일 (사용자)
프로젝트: `hjatiacukflqxkbqomtp`

1. **Redirect URLs 등록** — https://supabase.com/dashboard/project/hjatiacukflqxkbqomtp/auth/url-configuration
   - "Redirect URLs" → Add URL → `syncrew://reset-password` (앞으로 다른 앱 링크도 쓸 수 있게 `syncrew://**` 를 넣어도 된다)
   - 등록하지 않으면 메일 링크가 앱이 아니라 "Site URL"(기본 `http://localhost:3000`)로 가서 실패한다
   - Site URL 은 그대로 둬도 된다 (등록 안 된 주소일 때만 쓰임)
2. **메일 문구(선택)** — Authentication → Emails → Templates → "Reset Password"
   - 링크 자리 `{{ .ConfirmationURL }}` 는 **바꾸지 않는다**. 제목·본문만 한국어 등으로 바꿀 수 있다
3. **메일 발송 서버(실사용 전 필요)** — Authentication → Emails → SMTP Settings
   - Supabase 기본 메일 서버는 시험용이라 **보낼 수 있는 양이 아주 적고(시간당 몇 통), 프로젝트 팀원 주소로만 보내도록 제한**되어 있다 (Supabase 안내 기준 — 대시보드에서 확인할 것)
   - 실제 작업자에게 보내려면 외부 메일 서버(Resend, SendGrid, Gmail SMTP 등)를 연결해야 한다. 회원가입 확인 메일도 같은 제한을 받는다

### 설정 상태와 확인 결과 (2026-10-14)
- ① Redirect URLs `syncrew://reset-password` 등록 — **완료(사용자)**
- ② 재설정 메일 문구 — **완료(사용자)**
- ③ 메일 발송 서버: **Gmail SMTP** (`smtp.gmail.com`, 포트 465, 사용자 Gmail 앱 비밀번호, 같은 사용자 1분 간격) — **완료(사용자)**. 대시보드 Users → "Send password recovery" 로 **실제 메일 수신 확인**
  - 한계: 일반 Gmail 하루 약 500통, 스팸함 가능, 보내는 주소가 개인 Gmail → 실제 서비스 전에 전용 계정 또는 업무용 메일 서비스(Resend 등) 권장
  - 앱 비밀번호는 Supabase 화면에만 입력한다 (대화·파일에 적지 않는다). 2026-10-14 한 번 노출되어 사용자가 교체함
- **링크 이동 확인 (관리자 키로 테스트 계정 재설정 링크 생성, 메일 안 보냄)**: `syncrew://reset-password` 요청 → **303 으로 `syncrew://reset-password` 이동** (토큰 붙음). 대조군: 등록 안 한 주소 → `http://localhost:3000`(Site URL) 으로 이동 = 등록 목록이 실제로 적용됨
  - 관리자 링크는 토큰이 `#access_token=…` 형식(암시적), 앱이 보내는 요청은 `?code=…`(PKCE) — `handleAuthRedirect` 가 둘 다 처리
  - 대시보드의 "Send password recovery" 는 앱 주소 정보 없이 보내서 링크가 Site URL 로 간다 (정상 — 실제 사용자는 앱의 "비밀번호 찾기"로 요청)
- 남은 확인: 실기기에서 메일 링크 → 앱 열림 → 새 비밀번호 저장 (S3 때. 에뮬레이터면 `adb shell am start -a android.intent.action.VIEW -d "syncrew://reset-password?code=…"` 로도 화면 확인 가능)

