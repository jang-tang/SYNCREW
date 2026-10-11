# SYNCREW 앱

Expo SDK 57 + expo-router. Android 우선. 화면 설계: `../docs/mobile-screen-plan.md`.

## 실행

```bash
npm install
cp .env.example .env    # 값 채우기 (아래 표)
npm run android         # 개발 빌드 필요: npx expo run:android (녹음·카메라 네이티브 모듈 포함)
```

| 변수 | 설명 |
|---|---|
| `EXPO_PUBLIC_API_MODE` | `mock`: 서버 없이 앱 안 데모 데이터로 동작 (기본) / `live`: Supabase 로그인 + SYNCREW 서버 |
| `EXPO_PUBLIC_API_BASE_URL` | 서버 주소. 에뮬레이터 `http://10.0.2.2:4000`, 실기기 `http://<PC LAN IP>:4000` |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | live 모드 로그인용 (publishable key만. secret key 금지) |

## 데모 모드 (mock)

서버 Phase 2–5가 끝나기 전에도 모든 화면을 체험할 수 있습니다.

- 아무 이메일 + 8자 이상 비밀번호로 가입·로그인됩니다.
- 예시 현장: **A동 신축 현장**(내가 관리자), **평택 물류센터 현장**(내가 구성원). 가입 코드 `SYNC2026`을 입력하면 인천 현장에 참여 요청 → 4초 뒤 자동 승인.
- 예문 10개는 5개 언어로 번역되어 보입니다. 그 외 문장은 `(VI) 원문`처럼 표시됩니다.
- 음성은 실제로 녹음하지만, 음성 인식 대신 예문을 말한 것으로 처리합니다. 재생은 기기 TTS.
- 메시지를 보내면 상대가 응답하고, 지시를 보내면 작업자들이 차례로 수신·확인·완료합니다.
- 앱을 다시 열면 로그인·프로필만 유지되고 데모 데이터는 초기화됩니다.

## 명령

| 명령 | 설명 |
|---|---|
| `npm run typecheck` | 타입 검사 |
| `npm run doctor` | Expo 의존성·설정 진단 |
| `npm run bundle:android` | Android 번들 빌드 확인 (`dist-check/`, 커밋하지 않음) |

## 구조

```
src/
├─ app/                 화면 (파일 = 경로)
│  ├─ welcome, sign-in, sign-up, forgot-password, reset-password, onboarding, join(딥링크)
│  ├─ sites/            현장 선택 · 만들기 · 코드 참여 · QR 스캔
│  └─ site/             (tabs) 대화·지시·멤버·설정, chat/[id], chat/new, instruction/new, instruction/[id], join-code
├─ components/          ui/(디자인 시스템), chat/(말풍선·누르고 말하기·입력창), 지시 카드 등
├─ services/            types.ts(인터페이스), live/(Supabase·REST·Socket.IO), mock/(데모)
├─ providers/           인증 복원, 실시간 이벤트 → 화면 데이터 반영
├─ hooks/queries.ts     서버 상태 (TanStack Query)
├─ audio/               녹음(누르고 말하기), 재생 대기열, preprocess.ts(단말 노이즈 필터 연결 지점)
├─ i18n/                UI 문구 5개 언어 (ko, zh, vi, uz, ru)
├─ stores/              세션·토스트 (zustand)
└─ theme.ts             SyncField 로고 기반 디자인 토큰 (주황 #F8801A, 차콜 #30323A)
```

서버와 공유하는 타입은 `@shared/*` (= `../server/src/shared/*`)로 가져옵니다.
