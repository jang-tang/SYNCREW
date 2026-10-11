# SYNCREW 서버

Express + Socket.IO(Phase 3) + Prisma 7 + 로컬 Postgres. 설계 문서는 `../docs/`.

로그인은 Supabase Auth가 담당하고, 서버는 앱이 보낸 Supabase 토큰을 JWKS 공개키로 검증합니다 (`.env`의 `SUPABASE_URL`, `SUPABASE_JWKS_URL` 필수).

## 처음 실행

```bash
npm install                 # prisma generate 포함
cp .env.example .env        # 이미 있으면 생략
npm run setup:openai        # OpenAI API 키 입력 (선택. 없으면 통역 기능만 비활성)

# 터미널 1: 로컬 Postgres (Docker 불필요, 데이터는 .pgdata/)
npm run db:start

# 터미널 2
npm run db:deploy           # 마이그레이션 적용
npm run dev                 # http://0.0.0.0:4000 (REST /api/v1, 실시간 /rt), 확인: curl localhost:4000/health
```

## 명령

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (파일 변경 시 재시작) |
| `npm test` | 테스트. 임시 Postgres를 띄워 통합 테스트까지 실행 (개발 DB와 무관) |
| `npm run typecheck` | 타입 검사 |
| `npm run db:migrate` | 스키마 변경 후 새 마이그레이션 생성·적용 |

## OpenAI 비용 한도

`.env`의 `OPENAI_BUDGET_USD`(기본 5)와 `OPENAI_BUDGET_PERIOD`(기본 `month`)로 설정합니다.
한도를 넘는 호출은 서버가 거부합니다. 현재 사용액은 `/health`의 `budget`에서 볼 수 있습니다(개발 환경).

## 다른 개발자 연결 지점

| 대상 | 파일 | 설정 |
|---|---|---|
| 노이즈 필터 | `src/plugins/audioPreprocessor.ts` | `AUDIO_PREPROCESSOR` |
| 현장 데이터셋 | `src/plugins/datasetAdapter.ts` 또는 정규화 JSON | `DATASET_ADAPTER`, `DATASET_PATH` |
| 데이터 보존 정책 | `src/plugins/retentionPolicy.ts` | `RETENTION_POLICY`, `RETENTION_RUN_AT` |

## 구조

```
src/
├─ shared/     앱과 공유하는 계약 (외부 패키지 import 금지)
├─ engine/     통역 엔진: domain(현장 특화 처리), dataset, audio, stt, translation, budget
├─ plugins/    교체 가능한 구현 등록 지점
├─ routes/     REST 라우터 (v1/: me, sites·멤버·가입 코드, join)
├─ auth/       Supabase 토큰 검증, 로그인·프로필 확인
├─ access/     현장 멤버십·역할 확인
├─ sites/      가입 코드, 응답 변환
├─ events/     도메인 이벤트 인터페이스 (실시간 알림)
├─ realtime/   Socket.IO /rt (연결 인증, 현장 구독, 알림, 접속 상태)
├─ config/     환경 변수 검증
└─ lib/        로깅, 오류, Prisma
```
