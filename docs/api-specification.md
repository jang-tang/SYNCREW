# REST API 명세 (MVP)

## 공통

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <Supabase access token>`. 서버는 Supabase JWKS(`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)로 서명·만료·`aud`를 검증한다.
- 회원가입·로그인·로그아웃·토큰 갱신·비밀번호 재설정은 **앱이 Supabase Auth를 직접 호출**한다. API 서버에는 해당 엔드포인트가 없다.
- 응답 타입·오류 코드는 `server/src/shared`에 정의해 앱과 공유한다. 요청 검증은 서버의 zod 스키마로 한다.
- 오류 형식: `{ "error": { "code": "NOT_FOUND", "message": "..." } }` (코드 목록: `server/src/shared/api.ts`)
- 비용 한도 초과 시 통역 요청은 `402 BUDGET_EXCEEDED`, OpenAI 키가 없으면 `503 OPENAI_NOT_CONFIGURED`.
- 권한: `/sites/:siteId/**`는 `requireMembership(siteId, role?)` 미들웨어를 거친다. 멤버가 아니면 **404**(존재 여부 비노출), 역할 부족은 403.
- 속도 제한: 가입 코드 입력 사용자당 1분 5회, 메시지 전송 사용자당 1분 30회.

## 1. 내 정보

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/me` | 프로필 조회. 없으면 404 `PROFILE_REQUIRED` |
| PUT | `/me` | 프로필 생성/수정 `{displayName, preferredLang, autoPlay?, speechRate?}` (회원가입 직후 최초 1회 생성) |
| GET | `/me/sites` | 내가 속한 현장 목록 (역할, 멤버십 상태 포함) |
| GET | `/languages` | 지원 언어 목록 `[{code, name, nativeName}]` |

## 2. 현장

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/sites` | 로그인 + 프로필 | `{name, address?}` → 201. 현장, 관리자 멤버십, 기본 그룹 대화, 첫 가입 코드(7일)를 함께 생성 |
| GET | `/sites/:siteId` | 멤버 | 현장 정보 |
| PATCH | `/sites/:siteId` | 관리자 | `{name?, address?, status?}` |

## 3. 가입 코드와 가입

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/sites/:siteId/join-codes` | 관리자 | `{expiresInHours?, maxUses?}` → `{code, expiresAt, qrPayload}`. `qrPayload` = `syncrew://join?code=XXXX` |
| GET | `/sites/:siteId/join-codes` | 관리자 | 유효한 코드 목록 |
| DELETE | `/sites/:siteId/join-codes/:codeId` | 관리자 | 폐기 |
| POST | `/join` | 로그인 + 프로필 | `{code}`(대소문자·하이픈 무시) → 201 `{siteId, siteName, status:'pending'}`. 이미 대기 중이면 200(멱등), active면 409 `ALREADY_MEMBER`, removed/rejected면 pending으로 재요청, 잘못된·만료·폐기·소진 코드는 404 `INVALID_JOIN_CODE`, 1분 5회 초과 429 |

## 4. 멤버 관리

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/sites/:siteId/members?status=pending\|active` | 관리자: 전체 / 멤버: active만 | `[{userId, displayName, role, status, lang, online}]` |
| PATCH | `/sites/:siteId/members/:userId` | 관리자 | `{action:'approve'\|'reject'\|'remove'}` 또는 `{langOverride: Lang\|null}` → 204. 승인 시 기본 그룹 참여, 제외 시 모든 대화에서 나감. 잘못된 상태 전이 409 |

관리자는 자기 자신을 제외할 수 없다. 현장의 마지막 관리자는 제외 불가.

## 5. 대화 (1:1, 그룹)

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/sites/:siteId/conversations` | 멤버 | 내가 참여한 대화 목록 (최근 메시지 포함) |
| POST | `/sites/:siteId/conversations/direct` | 멤버 | `{userId}` → 기존 1:1 대화가 있으면 반환, 없으면 생성 (멱등) |
| GET | `/conversations/:id/messages?afterSeq=&beforeSeq=&limit=50` | 참여자 | 메시지 목록. 각 메시지는 **요청자 언어 기준** 번역문과 음성 URL 포함 |

## 6. 메시지 전송

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/conversations/:id/messages` | 참여자 | 텍스트: JSON `{clientMessageId, text}` / 음성: multipart `clientMessageId`, `audio`(m4a, ≤30초, ≤2MB) |
| POST | `/sites/:siteId/instructions` | 관리자 | 일괄 지시. `{clientMessageId, text 또는 audio, target:'all'\|{userIds:[]}, requiresAck:true}` |
| POST | `/messages/:id/retry` | 발신자 | 실패한 언어만 재시도 |

- 응답: `202 { messageId, status:'queued' }`. 같은 `clientMessageId` 재요청은 기존 메시지를 그대로 반환(200).
- 원어 = 발신 시점 발신자의 현장 언어. 대상 언어 = 수신자별 현장 언어(`lang_override` 또는 `preferred_lang`).
- 처리 결과는 Socket.IO로 통지된다 (realtime-protocol.md).

## 7. 일괄 지시 조회와 응답

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/sites/:siteId/instructions?cursor=` | 관리자 | 발송한 지시 목록과 상태별 집계 |
| GET | `/instructions/:id` | 관리자 | 수신자별 상태 `[{userId, displayName, lang, status, timestamps, responseNote}]`, 언어별 번역 상태 |
| GET | `/sites/:siteId/inbox?updatedAfter=` | 멤버 | 내가 받은 지시 (내 언어 번역문, 음성 URL, 내 상태) |
| POST | `/instructions/:id/ack` | 수신자 | 확인. 멱등 |
| POST | `/instructions/:id/complete` | 수신자 | `{note?}` 작업 완료 응답. 멱등 |

## 8. 음성

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/messages/:id/audio?lang=` | 수신자·발신자 | 권한 확인 후 서버 로컬 음성 파일(WAV)을 스트리밍 |

## 9. 동기화

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/sync?siteId=&since=` | 재접속용. `since` 이후 변경된 대화 목록 요약, 내 수신 상태가 바뀐 메시지, 멤버십 변화를 한 번에 반환. 응답의 `cursor`를 다음 `since`로 사용 |

## 10. 운영

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 인증 없음. DB 연결, OpenAI 키 설정 여부, 데이터셋 요약, (개발 환경만) 비용 한도 사용액. **Phase 1 구현 완료** |
