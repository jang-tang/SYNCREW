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
| 앱 빌드 | Android: Android SDK + **JDK 21**. iOS: Xcode, **영문 경로**에서만 `pod install` 성공 (`docs/phase4-report.md` 7절) |
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
- 작업이 끝나면 백그라운드 DB·서버를 끈다: `pkill -INT -f scripts/db.ts`, `pkill -f "tsx src/index.ts"`.

## 4. 비용 관리 (OpenAI)

- 모든 OpenAI 호출은 `BudgetGuard`를 거친다. 호출 전 예상 비용을 예약하고, 끝나면 응답의 실제 토큰 수 × 단가(`server/src/engine/budget/pricing.ts`)로 `openai_usage` 테이블에 기록한다. 한도를 넘는 호출은 하지 않고 `BUDGET_EXCEEDED`(402)로 거절한다.
- **현재 설정 (2026-10-12, 사용자 지시): OpenAI 계정 잔액이 $1.44뿐이고 그 이상 쓰면 안 된다.** 그래서 `OPENAI_BUDGET_USD=0.5`, `OPENAI_BUDGET_PERIOD=total`(누적)로 낮췄다. 기록 비용은 추정 단가 기준이라 실제 청구액과 다를 수 있어 잔액의 1/3로 잡았다. 한도를 올리려면 사용자 승인이 필요하다.
- 사용량 확인: `cd server && npx tsx -e 'import "dotenv/config";import {createPrismaClient} from "./src/lib/prisma";const p=createPrismaClient(process.env.DATABASE_URL!);p.openAiUsage.aggregate({_sum:{costUsd:true}}).then(r=>{console.log(r._sum);return p.$disconnect()})'`
- 실제 단가(2026-10-12 측정, `docs/phase6-report.md` 2절): 음성 메시지 1건(STT + 번역 음성 1개 언어) 약 $0.010–0.013, 텍스트 번역(음성 없음) 약 $0.002–0.005. 비용 대부분은 번역 음성 생성이다. 아끼려면 `TRANSLATION_AUDIO=off`(앱 기기 TTS로 읽음).

## 5. 플러그인 연결 (다른 개발자 담당)

| 담당 | 파일 | 하는 일 | 설정 |
|---|---|---|---|
| 노이즈 필터 (서버에서 실행) | `server/src/plugins/audioPreprocessor.ts` | `AudioPreprocessor.process(PcmAudio) → PcmAudio`를 구현해 `PREPROCESSORS`에 이름으로 등록. 입력은 PCM16 mono 16kHz. **3초 제한**, 오류·시간 초과·잘못된 출력이면 원본으로 계속 | `.env`의 `AUDIO_PREPROCESSOR=<이름>` |
| 노이즈 필터 (휴대폰에서 실행) | `frontend/src/audio/preprocess.ts` | `preprocessRecording(uri) → uri` (녹음 파일 경로를 받아 필터를 거친 파일 경로를 돌려줌). 지금은 그대로 반환 | — |
| 현장 데이터셋 | `server/src/plugins/datasetAdapter.ts` | 방법 1: 정규화 JSON을 만들어 `DATASET_ADAPTER=normalized-json`, `DATASET_PATH=<파일>` (형식: `server/src/engine/dataset/normalizedJsonAdapter.ts`의 스키마). 방법 2: 원본 형식을 읽는 어댑터를 `ADAPTERS`에 등록 | `DATASET_ADAPTER`, `DATASET_PATH` |
| 데이터 보존 정책 | `server/src/plugins/retentionPolicy.ts` | `RetentionPolicy.run(ctx) → {deleted}` 구현 후 `POLICIES`에 등록. 서버가 매일 `RETENTION_RUN_AT`에 호출 | `RETENTION_POLICY`, `RETENTION_RUN_AT` |

- 노이즈 필터를 서버·단말 중 어디서 실행할지는 아직 정하지 않았다 (CLAUDE.md "남은 일" 5).
- 연결한 뒤에는 `cd server && npm test`로 확인한다. 전처리기 교체·오류 복구(시나리오 14), 데이터셋 교체(시나리오 15) 테스트가 이미 있다.
- 우즈베크어는 실제 확인에서 번역·인식 품질이 가장 낮았다 (`docs/phase6-report.md` 2절). 현장 데이터셋에 우즈베크어 용어·검증 문장을 넣는 것이 가장 효과가 클 것으로 본다.

## 6. 확인 도구

| 명령 | 확인하는 것 | 비용 |
|---|---|---|
| `cd server && npm run typecheck && npm test` | 서버 테스트 157개 (실제 Postgres + Socket.IO, 가짜 엔진) | 0 |
| `cd server && npx tsx scripts/openai-check.ts [--targets vi,zh,uz,ru] [--reuse]` | **실제 OpenAI** 5개 언어 왕복: 한국어 음성(macOS say) → STT → 4개 언어 번역(음성) → 그 음성 STT → 한국어 번역. 단계별 지연·비용 출력. `--reuse`는 지난번 번역 음성을 다시 써서 번역 호출을 건너뜀. 실행 전 `npm run db:start` | 1회 약 $0.05–0.06 (한도 안에서만 실행) |
| `cd frontend && npm run typecheck && npm run doctor && npm run test:unit` | 앱 타입·Expo 설정·발화 감지(VAD) 단위 테스트 11개 | 0 |
| `cd frontend && npm run bundle:web && npm run e2e` | 데모 모드 사용 흐름 50개 (헤드리스 Chrome) | 0 |
| `cd frontend && npm run bundle:web && npm run e2e:mic` | 실제 말소리(가짜 마이크 + 음성 파일)로 핸즈프리 자동 전송 + 무음 대조군 | 0 |
| `cd frontend && npm run bundle:web:live && npm run e2e:live` | **live 모드** 앱 ↔ 실제 서버 ↔ 실제 Supabase 계정: 로그인 → 현장 생성 → 코드 참여 → 승인 → 1:1 대화 → 통화(실제 녹음) → 실시간 지시 → 문자 지시. 준비: 테스트 계정(2026-10-12 생성됨, `server/.e2e-accounts.json`. 없으면 `cd server && npx tsx scripts/e2e-accounts.ts` — 사용자 허락 필요), `ENGINE=fake npm run dev`. 27개 | 0 (가짜 엔진) |
| `cd frontend && npm run e2e:latency [횟수]` | 서버 경로 지연: 관리자 음성 메시지 → 서버 → 구성원 실시간 수신 (live e2e로 두 계정이 같은 현장에 있어야 함) | `ENGINE=openai`면 1회 약 $0.006 (승인 후), fake면 0 |

- 웹 빌드 두 개(`dist-check` 데모, `dist-live` live)는 Metro 캐시가 설정을 섞으므로 `--clear`로 만든다 (package.json에 반영됨).
- 헤드리스 Chrome 가짜 마이크로 음성 파일을 넣으려면 `--disable-features=AudioServiceSandbox`가 필요하다 (없으면 무음). e2e 스크립트에 반영됨.
- 테스트 계정 삭제: `cd server && npx tsx scripts/e2e-accounts.ts --delete` (Supabase에서만 삭제, 로컬 DB 기록은 남음).

## 7. 기기에서 실행

`docs/phase4-report.md` 7절의 명령을 따른다. 요점:
- Android: `JAVA_HOME`을 JDK 21로 두고 `npx expo run:android --no-bundler`, `adb reverse tcp:8081 tcp:8081` 후 개발 빌드를 연다.
- iOS: 한글 경로에서는 `pod install`이 실패하므로 영문 경로 복사본에서 네이티브만 빌드하고, JS는 원래 폴더의 Metro가 제공한다. 복사본은 약 5GB이므로 빌드 전 `df -h /System/Volumes/Data`로 여유 공간을 확인하고, 끝나면 지운다.
- `expo start`가 `frontend/tsconfig.json`을 자동으로 고쳐 쓴다 (`.expo/types` 포함 항목 삭제). 작업 후 `git checkout -- frontend/tsconfig.json`으로 되돌린다.
- 에뮬레이터 조작은 uiautomator 화면 구조로 글자를 찾아 `adb shell input tap`으로 누른다 (Phase 6에서 사용한 방식, `docs/phase6-report.md` 4절).
