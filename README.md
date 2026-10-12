# SYNCREW

건설·제조 현장 외국인 작업자와 관리자를 위한 **AI 실시간 통역** 서비스 (팀 SyncField).
안전모 부착 모듈(블루투스 헤드셋) + Android 앱 + 로컬 서버로 1:1 대화, 현장 그룹 대화, 다국어 일괄 작업 지시를 제공합니다.

- 지원 언어: 한국어, 중국어, 베트남어, 우즈베크어, 러시아어
- 통역: STT(`gpt-4o-mini-transcribe`) → 현장 용어 감지·보정 → `gpt-realtime-2.1` 번역(텍스트 + 음성). 1:1 대화·통역 통화, 현장 그룹 대화, 관리자 일괄 지시(문자·실시간)

## 구성

| 폴더 | 내용 |
|---|---|
| [`frontend/`](frontend/) | Expo(React Native) Android 앱 |
| [`server/`](server/) | Express + Prisma + 로컬 Postgres 서버, 통역 엔진 |
| [`docs/`](docs/) | 요구사항, 아키텍처, DB·API·실시간 프로토콜, 화면, 테스트, 구현 계획 |

설치·실행·설정·플러그인 연결은 [`docs/operations.md`](docs/operations.md)를 보세요. 진행 현황은 [`docs/implementation-plan.md`](docs/implementation-plan.md)와 [`docs/phase6-report.md`](docs/phase6-report.md)에 있습니다 (Phase 1–6 완료, 실기기 확인은 추후).
