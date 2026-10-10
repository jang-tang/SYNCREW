# 모바일 화면 계획 (신규 UI)

## 1. 기술 구성

- 위치: `frontend/` (화면은 `frontend/src/app`, expo-router 파일 기반 라우팅)

- Expo(dev build) + React Native + TypeScript, Android 우선
- Expo SDK 57 (React Native 0.86), 라우팅: expo-router / 서버 상태: TanStack Query, 세션·소켓 상태: Zustand (Phase 2부터 도입)
- 인증: `@supabase/supabase-js` (세션은 expo-secure-store 어댑터에 저장, 자동 갱신)
- 오디오: `expo-audio` (녹음·재생), 대체 재생: `expo-speech`
- QR: 표시 `react-native-qrcode-svg`, 스캔 `expo-camera`
- 다국어 UI: i18n 키 사전 (ko, zh, vi, uz, ru). 앱 UI 언어 = 사용자 기본 언어

## 2. 디자인 원칙

- 주요 버튼 최소 56dp, 말하기 버튼은 화면 하단 대형 버튼 (누르고 있는 동안 녹음)
- 상단 고정 상태 바: 연결 상태(연결됨 / 재연결 중 / 오프라인)
- 메시지 카드: 번역문을 크게, 원문은 작게 함께 표시. 처리 중 / 실패(재시도 버튼) 표시
- 녹음 중에는 재생을 멈추고, 재생 중에는 녹음 버튼을 비활성화

## 3. 화면 구성

```
(auth)    시작 → 로그인 / 회원가입 → 비밀번호 재설정
(onboard) 프로필 설정(이름, 언어) → 현장 선택: [현장 만들기] 또는 [현장 가입]
(site)    현장 홈 ─┬─ 대화 탭: 그룹 대화, 1:1 대화 목록 → 대화 화면
                  ├─ 지시 탭: (관리자) 지시 목록·작성·상태 / (구성원) 받은 지시·상세
                  ├─ 멤버 탭: 멤버 목록, (관리자) 가입 요청, 가입 코드·QR
                  └─ 설정 탭: 프로필, 언어, 음성, 현장 전환, 로그아웃
```

## 4. 화면별 명세

| 화면 | 목적 | 주요 요소 / 행동 | API · 이벤트 | 빈·오류 상태 |
|---|---|---|---|---|
| 로그인 / 회원가입 | 계정 | 이메일, 비밀번호, 언어 선택(회원가입 화면 상단) | Supabase Auth | 잘못된 자격 증명, 네트워크 오류 |
| 비밀번호 재설정 | 재설정 메일 | 이메일 입력 → 메일 링크 → 앱 딥링크에서 새 비밀번호 | Supabase `resetPasswordForEmail`, `updateUser` | |
| 프로필 설정 | 최초 1회 | 표시 이름, 기본 언어 | `PUT /me` | |
| 현장 선택 | 진입점 | 내 현장 목록(역할·상태 배지), 현장 만들기, 현장 가입 | `GET /me/sites` | 현장 없음 → 두 버튼만 표시 |
| 현장 만들기 | 관리자 시작 | 이름, 주소 → 완료 시 가입 코드 화면으로 이동 | `POST /sites`, `POST /join-codes` | |
| 현장 가입 | 구성원 시작 | 코드 입력, QR 스캔 | `POST /join` | 잘못된 코드, 만료, 이미 멤버 |
| 가입 대기 | 승인 대기 | 대기 안내, 새로고침 | `membership:changed`로 자동 전환 | 거절 시 안내 |
| 대화 목록 | 대화 진입 | 현장 그룹 대화(상단 고정), 1:1 목록, 새 1:1(멤버 선택) | `GET /conversations`, `POST /conversations/direct` | 1:1 없음 |
| 대화 화면 (1:1·그룹 공통) | 통역 대화 | 메시지 목록, 말하기 버튼, 텍스트 입력, 다시 듣기, 실패 재시도 | `GET/POST messages`, `message:new`, `message:status`, `receipt:delivered` | 마이크 권한 거부, 처리 실패 |
| 지시 작성 (관리자) | 1:N 지시 | 대상: 전체 / 멤버 선택(언어 표시), 음성 또는 텍스트, 전송 전 대상 언어 분포 표시 | `POST /instructions` | 대상 0명 |
| 지시 목록·상태 (관리자) | 진행 확인 | 지시별 진행 막대(전달·확인·완료·실패), 상세에서 수신자별 상태, 실패 재시도 | `GET /instructions`, `instruction:recipient`, `message:status` | |
| 받은 지시 (구성원) | 지시 수신 | 미확인 우선 정렬, 자동 재생, [확인] [완료] 버튼 | `GET /inbox`, `message:new`, `POST ack/complete` | 지시 없음 |
| 멤버 (관리자) | 멤버 관리 | 가입 요청 승인/거절, 멤버 언어 수정, 제외, 접속 표시 | `GET/PATCH members`, `join:requested`, `presence:changed` | |
| 가입 코드·QR (관리자) | 초대 | 코드 크게 표시, QR, 새 코드 발급, 폐기 | `join-codes` API | |
| 설정 | 개인 설정 | 언어, 자동 재생, 재생 속도, 현장 전환, 로그아웃 | `PUT /me` | |

## 5. 오디오 처리

1. 말하기 버튼을 누르는 동안 녹음 (최대 30초). Android 입력 소스는 음성 인식용(VOICE_RECOGNITION)을 사용해 기기 노이즈 억제를 활용.
2. 녹음 파일 → `preprocessRecording(uri)` 훅(기본: 그대로) → 업로드.
3. 수신 시 `autoPlay`가 켜져 있으면 번역 음성 URL 재생. 실패하면 `expo-speech`로 번역문 읽기(해당 언어 음성이 기기에 없으면 텍스트만 표시하고 안내).
4. 블루투스 헤드셋 연결 시 재생은 OS가 자동으로 헤드셋으로 보낸다. 녹음 입력 경로는 Phase 4 실기기 검증 항목.
5. 재생 대기열: 연속 수신 시 순서대로 재생, 새 녹음 시작 시 중단.

## 6. 상태 관리

- 소켓 연결 1개를 앱 전역에서 유지(현장 전환 시 subscribe만 변경).
- 소켓 이벤트 수신 시 TanStack Query 캐시를 직접 갱신.
- 전송 대기열: `clientMessageId`(uuid)를 먼저 만들고 낙관적으로 표시, 실패 시 재시도 버튼.
- 백그라운드 → 포그라운드 전환 시 `/sync` 호출.
