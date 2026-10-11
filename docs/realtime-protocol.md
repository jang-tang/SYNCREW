# 실시간 프로토콜 (Socket.IO)

## 1. 원칙

- 상태 변경 명령은 REST, 서버 → 클라이언트 알림은 Socket.IO (예외: 수신 확인 `receipt:delivered`).
- 클라이언트는 **방 이름을 지정하지 않는다.** 서버가 DB 권한을 확인하고 방에 넣는다.
- 이벤트 이름·페이로드 타입은 `server/src/shared/realtime.ts`에 정의해 앱과 공유하고, 서버는 수신 시 zod로 검증한다.
- 이벤트 이름 규칙: `도메인:동작` (소문자).
- 모든 서버 발행 이벤트에는 `eventId`(uuid)와 `at`(ISO 시각)을 포함해 클라이언트가 중복을 제거한다.

## 2. 연결과 인증

- 네임스페이스 `/rt`, 전송은 WebSocket 우선.
- 핸드셰이크 `auth: { token: <Supabase access token> }`. 서버 미들웨어가 JWKS로 검증하고 실패 시 `connect_error { code:'UNAUTHORIZED' }`.
- 연결 성공 시 서버가 자동으로 `user:{userId}` 방에 넣는다.
- 토큰 만료 시 서버는 `auth:expired`를 보내고 연결을 끊는다. 클라이언트는 Supabase로 토큰을 갱신한 뒤 재연결한다.

## 3. 방 구조

| 방 | 구성원 | 용도 |
|---|---|---|
| `user:{userId}` | 본인 소켓 전부 | 개인 대상 메시지·지시·상태 |
| `site:{siteId}` | `site:subscribe`한 active 멤버 | 접속 상태, 멤버 변화 |
| `site:{siteId}:managers` | 구독한 관리자 | 지시 진행률, 가입 요청 |

메시지 전달은 그룹 대화도 포함해 **수신자별 `user:` 방으로 개별 발행**한다. 수신자마다 언어가 달라 페이로드가 다르고, 대상 외 사용자 노출을 원천적으로 막기 위해서다.

## 4. 이벤트 목록

### 클라이언트 → 서버

| 이벤트 | 페이로드 | ack 응답 | 권한·처리 |
|---|---|---|---|
| `site:subscribe` | `{siteId}` | `{ok:true}` 또는 `{ok:false, code}` | DB에서 active 멤버십 확인 후 `site:`(관리자는 `:managers`도) 방 참여 |
| `site:unsubscribe` | `{siteId}` | `{ok:true}` | |
| `receipt:delivered` | `{messageIds: string[]}` (최대 100) | `{ok:true, updated:n}` | 본인이 수신자인 행만 `sent → delivered`. 멱등 |

ack 타임아웃 5초. 실패하면 클라이언트는 재연결 후 다시 보낸다.
ack 실패 코드: `NOT_FOUND`(활성 멤버 아님 — 현장 존재 여부 비노출), `VALIDATION_ERROR`(형식 오류).
`receipt:delivered`는 Phase 3에서 형식만 검증하고 `{ok:true, updated:0}`을 돌려준다 (메시지 상태 반영은 Phase 4).

### 서버 → 클라이언트

| 이벤트 | 대상 | 페이로드 |
|---|---|---|
| `message:new` | 수신자 `user:` | `{message:{id, kind, siteId, conversationId, seq, senderId, senderName, sourceLang, originalText, text(수신자 언어), audioUrl, requiresAck, createdAt}}` |
| `message:status` | 발신자 `user:` | `{messageId, status, translations:[{lang, status, text?}], recipients?:{pending,sent,delivered,acknowledged,completed,failed}}` |
| `instruction:recipient` | `site:{id}:managers` | `{messageId, userId, status, at}` (delivered/ack/complete 변화) |
| `membership:changed` | 대상 `user:` + `site:{id}:managers` | `{siteId, userId, role, status}`. `removed`면 서버가 해당 사용자 소켓을 현장 방에서 즉시 제거 |
| `join:requested` | `site:{id}:managers` | `{siteId, userId, displayName, lang}` |
| `presence:changed` | `site:{id}` | `{userId, online}` |
| `sync:required` | `user:` | `{siteId?}` 서버가 상태 불일치를 감지하거나 재시작 직후 |
| `auth:expired` | 해당 소켓 | `{}` |

## 5. 메시지 생명주기와 이벤트

```
POST 메시지 → 202
  → (파이프라인) 언어별 번역 완료마다:
       해당 언어 수신자에게 message:new, recipient=sent
       발신자에게 message:status
  → 수신 단말 receipt:delivered → recipient=delivered → (지시면) instruction:recipient
  → POST /instructions/:id/ack | complete → instruction:recipient
  → 언어 번역 최종 실패 → 해당 수신자 failed, 발신자에게 message:status
```

## 6. 재연결과 오프라인 동기화

1. 소켓 재연결 성공(`connect`) 시 클라이언트는 현재 현장을 `site:subscribe`.
2. `GET /sync?siteId=&since=<마지막 cursor>` 호출로 누락분 반영.
3. 보내지 못한 `receipt:delivered`를 재전송 (로컬 대기열).
4. 열린 대화 화면은 `GET /conversations/:id/messages?afterSeq=<마지막 seq>`로 보충.
5. 전송 중 끊긴 메시지는 같은 `clientMessageId`로 REST 재요청 (서버가 중복 제거).

클라이언트는 `seq` 기준으로 정렬하고 `message.id`로 중복을 제거한다.

## 7. 구현 메모 (Phase 3)

- 구현: `server/src/realtime/gateway.ts`, 접속 상태 `presence.ts` (서버 1대 기준 메모리).
- `connect_error`의 `message`와 `data.code`는 모두 `UNAUTHORIZED`.
- `presence:changed`는 그 사용자가 활성 멤버인 모든 현장 방에 보내며, 같은 사용자의 두 번째 기기 연결·첫 번째 기기 종료는 상태 변화가 아니므로 보내지 않는다.
- 웹(e2e·개발) 접속을 위해 CORS를 허용한다 (로컬 호스팅 전제).

## 8. 확장

- 서버 다중화 시 `@socket.io/redis-adapter` 도입. 현재 설계(사용자 방, 서버 측 방 참여)는 그대로 동작한다.
