# SYNCREW 앱

Expo SDK 57 + expo-router. Android 우선. 설계 문서는 `../docs/mobile-screen-plan.md`.

## 실행

```bash
npm install
cp .env.example .env    # EXPO_PUBLIC_API_BASE_URL 을 서버 주소로 수정
npm run android         # Android 에뮬레이터 또는 연결된 기기
```

- 에뮬레이터에서 이 PC의 서버: `http://10.0.2.2:4000`
- 실제 휴대폰: PC와 같은 Wi-Fi에서 `http://<PC의 LAN IP>:4000`
- 이후 Phase에서 네이티브 모듈(녹음 등)이 추가되면 Expo Go 대신 개발 빌드(`npx expo run:android`)가 필요합니다.

## 명령

| 명령 | 설명 |
|---|---|
| `npm run typecheck` | 타입 검사 |
| `npm run doctor` | Expo 의존성·설정 진단 |
| `npm run bundle:android` | Android 번들 빌드 확인 (`dist-check/`, 커밋하지 않음) |

## 구조

```
src/
├─ app/          화면 (파일 = 경로). (tabs)/ 아래 대화·지시·멤버·설정
├─ components/   공용 컴포넌트
├─ providers/    전역 상태 (서버 연결 상태)
├─ api/          서버 호출
├─ i18n/         UI 문구 (ko, zh, vi, uz, ru)
├─ config.ts     환경 설정
└─ theme.ts      색·간격·글자 크기
```

서버와 공유하는 타입은 `@shared/*` (= `../server/src/shared/*`)로 가져옵니다.
