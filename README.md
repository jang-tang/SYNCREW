# SYNCREW

건설·제조 현장 외국인 작업자와 관리자를 위한 **AI 실시간 통역** 서비스 (팀 SyncField).
안전모 부착 모듈(블루투스 헤드셋) + Android 앱 + 로컬 서버로 1:1 대화, 현장 그룹 대화, 다국어 일괄 작업 지시를 제공합니다.

- 지원 언어: 한국어, 중국어, 베트남어, 우즈베크어, 러시아어
- 통역: STT → 현장 용어 감지·보정 → `gpt-realtime-2` 번역(텍스트 + 음성)

## 구성

| 폴더 | 내용 |
|---|---|
| [`frontend/`](frontend/) | Expo(React Native) Android 앱 |
| [`server/`](server/) | Express + Prisma + 로컬 Postgres 서버, 통역 엔진 |
| [`docs/`](docs/) | 요구사항, 아키텍처, DB·API·실시간 프로토콜, 화면, 테스트, 구현 계획 |

실행 방법은 각 폴더의 README를 참고하세요. 진행 현황은 [`docs/implementation-plan.md`](docs/implementation-plan.md)에 있습니다 (현재 Phase 1 완료).
