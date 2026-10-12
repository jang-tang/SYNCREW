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
| GET | `/conversations/:id/messages?afterSeq=&beforeSeq=&limit=50` | 참여자 | 메시지 목록(seq 오름차순, limit ≤100). 각 메시지는 **요청자 언어 기준** 번역문과 음성 URL 포함. 본인이 보냈거나 수신자인 메시지만. 조회하면 읽음 처리 |

- 1:1 열기: 자기 자신 400, 상대가 현장 활성 멤버가 아니면 404. 새로 만들면 201, 기존이면 200 (제외 후 재승인된 참여자는 다시 참여).
- 대화 목록 정렬: 그룹 먼저, 그다음 최근 메시지 순. `unreadCount`는 내가 수신자인 메시지 중 `last_read_seq` 이후 개수.
- 참여자가 아니거나(나간 경우 포함) 현장 활성 멤버가 아니면 대화 관련 경로는 모두 404.

## 6. 메시지 전송

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/conversations/:id/messages` | 참여자 | 텍스트: JSON `{clientMessageId(1–64자), text(1–1000자)}` / 음성: multipart `clientMessageId`, `audio`(m4a·webm 등, ≤30초, ≤2MB) |
| POST | `/sites/:siteId/instructions` | 관리자 | 일괄 지시. `{clientMessageId, text 또는 audio, target:'all'\|{userIds:[]}, requiresAck:true}` |
| POST | `/messages/:id/retry` | 발신자 | 실패한 언어만 재시도 (음성 인식 단계에서 실패했으면 인식부터). `failed`/`partially_failed`가 아니면 409, 발신자가 아니면 404 |

- 응답: `202 { messageId, status:'queued' }`. 같은 `clientMessageId` 재요청은 기존 메시지를 그대로 반환(200).
- 원어 = 발신 시점 발신자의 현장 언어. 대상 언어 = 수신자별 현장 언어(`lang_override` 또는 `preferred_lang`).
- 처리 결과는 Socket.IO로 통지된다 (realtime-protocol.md).
- 받을 사람(대화에 참여 중인 다른 활성 멤버)이 없으면 409 `CONFLICT`.
- 번역이 필요한데(대상 언어 ≠ 원어) 번역 엔진이 없거나, 음성인데 STT가 없으면 503 `OPENAI_NOT_CONFIGURED`. 같은 언어끼리의 텍스트는 엔진 없이 전달된다. `ENGINE=openai`에서 남은 한도가 0이면 402.
- 음성 길이(30초) 초과·디코딩 실패는 처리 단계에서 메시지 `failed`(`AUDIO_TOO_LONG`/`AUDIO_INVALID`)로 기록된다.

## 7. 일괄 지시 조회와 응답

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/sites/:siteId/instructions?cursor=` | 관리자 | 발송한 지시 목록과 상태별 집계 |
| GET | `/instructions/:id` | 관리자 | 수신자별 상태 `[{userId, displayName, lang, status, timestamps, responseNote}]`, 언어별 번역 상태 |
| GET | `/sites/:siteId/inbox?updatedAfter=` | 멤버 | 내가 받은 지시 (내 언어 번역문, 음성 URL, 내 상태) |
| POST | `/instructions/:id/ack` | 수신자 | 확인. 멱등 |
| POST | `/instructions/:id/complete` | 수신자 | `{note?}` 작업 완료 응답. 멱등 |

- 7절 API는 Phase 5에서 구현(`server/src/routes/v1/instructions.ts`). 지시 목록·받은 지시의 각 항목에 `sessionId`(실시간 일괄 지시 발화면 세션 id, 문자 지시는 null). 확인·완료는 되돌리지 않고(완료 뒤 확인 = 변화 없음), 전달 실패한 지시는 409. 관리자에게 `instruction:recipient`

## 8. 음성

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/messages/:id/audio?lang=&u=&exp=&sig=` | 서명 URL | 번역 음성 WAV. **Bearer 토큰 대신 서명 URL로 인증**한다 |

- 앱의 오디오 플레이어는 Authorization 헤더를 붙일 수 없어(특히 웹) 서버가 조회자별 서명 URL을 `MessageView.audioUrl`로 준다. 서명은 (메시지, 언어, 조회자, 만료 24시간)에 묶인 HMAC-SHA256 (`AUDIO_URL_SECRET`, 비우면 서버 시작마다 새 키).
- `audioUrl`은 서버 기준 **상대 경로**(`/api/v1/messages/…`)이고 앱이 서버 주소를 붙인다 (`frontend/src/audio/playback.ts`).
- 다운로드 시점에도 권한을 다시 확인: 해당 언어의 수신자이고 현장 활성 멤버여야 한다 (제외 후 404). 서명 오류·만료 401.

## 9. 동기화

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/sync?siteId=&since=` | 재접속용. `since` 이후 변경된 대화 목록 요약, 내 수신 상태가 바뀐 메시지, 멤버십 변화를 한 번에 반환. 응답의 `cursor`를 다음 `since`로 사용 |

- 메시지: 활성 멤버인 현장에서 내가 보냈거나 받은 것 중 메시지 또는 내 수신 행이 `since` 이후 바뀐 것, 최대 200개(최신 기준, seq 오름차순). 대화 요약은 그 메시지들이 속한 대화만.

## 10. 운영

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 인증 없음. DB 연결, OpenAI 키 설정 여부, 데이터셋 요약, (개발 환경만) 비용 한도 사용액. **Phase 1 구현 완료** |

## 11. 실시간 통역 세션 (Phase 5, docs/live-interpretation.md)

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/sites/:siteId/calls` | 멤버 | `{userId}` 1:1 통역 통화 걸기 → 201 `LiveSession(ringing)`, 상대에게 `session:invite`. 자기 자신 400, 비멤버 대상 404, 상대 미접속 409 `CONFLICT`, 어느 한쪽이 통화 중 409 `BUSY` |
| POST | `/sites/:siteId/broadcasts` | 관리자 | `{target:'all'\|{userIds}}` 실시간 일괄 지시 시작 → 201 `LiveSession(active)`, 대상자에게 `session:invite`. 구성원 403, 현장 밖 대상 400, 대상 없음 409, 이미 지시 중 409 `BUSY` |
| GET | `/sites/:siteId/sessions/open` | 멤버 | 내가 참여 중인 울림·진행 중 세션 (재시작·재연결 후 복원) |
| GET | `/sites/:siteId/sessions?mode=call\|broadcast&limit=20` | 멤버 | 내가 참여한 최근 세션 (기록) |
| GET | `/sessions/:id` | 참여자 | 세션 상태·참여자(이름·언어·역할·접속·장치) |
| POST | `/sessions/:id/accept` · `/decline` | 받는 사람 | 울리는 통화만 (끝났거나 이미 연결 409, 다른 사람 403) |
| POST | `/sessions/:id/end` | 참여자 | 울리는 중 건 사람 → `cancelled`, 통화 중 → `hangup`. 일괄 지시는 관리자만(구성원 403). 이미 끝났으면 그대로 반환 |
| POST | `/sessions/:id/utterances` | 통화 참여자 / 지시 관리자 | 발화 1건: multipart `clientMessageId`, `audio` 또는 JSON `{clientMessageId, text}` → 202. 통화 = 상대에게 1:1 메시지, 지시 = 대상 전원에게 `instruction`(확인 응답 없음). 진행 중이 아니면 409, 지시 구성원 발화 403 |
| GET | `/sessions/:id/messages` | 참여자 | 그 세션 발화 중 내가 보냈거나 받은 것 (내 언어) |

- 참여자가 아니거나 현장 활성 멤버가 아니면 세션 경로는 모두 404 (존재 비노출).
- 종료 사유(`endReason`): `hangup` `declined` `missed`(울림 30초) `cancelled` `connection_lost`(연결 끊김 20초) `removed`(현장에서 제외).
- 메시지 전송·발화·지시 작성은 사용자당 1분 30회 한도를 함께 쓴다.
