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

## 현재 상태 (2026-10-10)

- **Phase 1 완료, 사용자 검토 후 Phase 2 대기.** 진행 현황: `docs/implementation-plan.md`
- Phase 2(인증·현장·멤버십): Supabase 값은 `server/.env`, `frontend/.env`에 입력 완료.
- 미검증: Android 에뮬레이터·실기기 실행, 앱↔서버 실통신 (이 PC에 Android SDK 없음. 사용자가 추후 준비).
- OpenAI API 키는 아직 미입력 (`cd server && npm run setup:openai`).

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
| 번역 모델 | `gpt-realtime-2` (서버→OpenAI Realtime WebSocket, 텍스트+음성 출력). STT는 `gpt-4o-mini-transcribe` 기본 |
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
- 서버 요청 검증은 zod, 오류 응답은 `{error:{code,message}}` (코드: `server/src/shared/api.ts`).
- 상태 변경은 REST, 서버→앱 알림은 Socket.IO (`docs/realtime-protocol.md`).
- 앱 화면은 `frontend/src/app` (expo-router). Expo 패키지는 `npx expo install`로 설치. `frontend/AGENTS.md` 참고 (Expo는 SDK마다 API가 바뀌므로 문서 확인).
- 비밀 값: `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`는 `server/.env`에만. 앱에는 publishable key만.
- Prisma가 AI의 `migrate reset`을 사용자 동의 없이 차단한다. 우회하지 말고 새 마이그레이션을 추가할 것.

## 실행

```bash
cd server && npm run db:start          # 터미널 1: 로컬 Postgres (localhost:5433)
cd server && npm run db:deploy && npm run dev   # 터미널 2: http://0.0.0.0:4000/health
cd server && npm test                  # 임시 Postgres로 통합 테스트까지 (42개)
cd frontend && npm run typecheck && npm run doctor
```

## 참고

- 원본 통역 저장소: https://github.com/jecool0523/workplace-translation-mvp (분석: `docs/current-codebase-analysis.md`). 수정하지 않는다.
- 발표 PDF: `싱크필드_20260909 최종본.pdf` (대한민국 청소년 창업경진대회, 팀 SyncField).
