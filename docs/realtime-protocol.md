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
| `receipt:delivered` | `{messageIds: string[]}` (최대 100) | `{ok:true, updated:n}` | 본인이 수신자인 행만 `sent → delivered`. 멱등. 지시면 관리자에게 `instruction:recipient` |
| `device:status` | `{audioRoute, inputName, micPermission}` | `{ok:true}` | 내 오디오 장치 상태(헤드셋·마이크 권한). 서버 메모리에 저장, 마지막 연결이 끊기면 삭제. 앱은 재연결 시 다시 보낸다 |

ack 타임아웃 5초. 실패하면 클라이언트는 재연결 후 다시 보낸다.
ack 실패 코드: `NOT_FOUND`(활성 멤버 아님 — 현장 존재 여부 비노출), `VALIDATION_ERROR`(형식 오류).
`receipt:delivered`는 본인이 수신자이고 `sent`인 행만 `delivered`로 바꾸고 바뀐 수를 `updated`로 돌려준다 (Phase 4). 지시의 `instruction:recipient` 발행은 Phase 5.

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
| `session:invite` | 대상 `user:` | `{session}` 1:1 통화 수신, 내가 대상인 일괄 지시 시작 |
| `session:updated` | 참여자 전원 `user:` | `{session}` 상태(수락·종료)·참여자 접속·장치 변화 |
| `device:changed` | 그 사용자가 속한 `site:` 방마다 | `{siteId, userId, device}` |
| `group:updated` | `site:{id}` | `{siteId, session \| null}` 현장 전체 연결이 열림·참여자 변화·끝남 (2026-10-27, 참여하지 않은 사람도 받는다) |

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

## 8. 구현 메모 (Phase 4)

- `message:new`·`message:status`는 현장 방이 아니라 `user:{id}` 방으로 보낸다 (수신자마다 언어가 달라 내용이 다르다). 현장 구독 없이도 받는다.
- 번역이 언어별로 끝날 때마다 그 언어 수신자에게 `message:new`, 발신자에게 `message:status`. 처리 시작·실패·최종 상태에서도 `message:status`를 보낸다 (`recipients` 집계 포함).
- 재시도 시에는 실패했던 수신자에게만 `message:new`가 간다 (이미 받은 사람은 중복 수신 없음).
- `message:status.translations[].text`: 완료된 번역문, 같은 언어(`skipped`)는 원문.

## 9. 구현 메모 (Phase 5 — 실시간 통역 세션)

- 상태 변경은 REST(`/calls`, `/broadcasts`, `/sessions/:id/*`), 알림은 `session:invite`·`session:updated` (docs/live-interpretation.md).
- 참여자의 마지막 연결이 끊기면 `session:updated`(online=false). 통화 상대·지시 관리자는 20초 유예 후 `connection_lost`로 종료, 그 안에 다시 연결하면 유지. 지시 수신자가 끊기면 상태만 알린다.
- 세션 발화도 `message:new`(`sessionId` 포함)로 오며, 앱은 자동 재생 설정과 무관하게 재생한다.
- 서버 시작 시 열린 채 남은 세션은 `connection_lost`로 닫는다 (모든 연결이 끊겼으므로).

## 10. 스트리밍 통역 (Phase 7 S1, 1:1 통화만)

계획·결정: [streaming-plan.md](streaming-plan.md). 일괄 지시는 발화 단위 방식 유지(스트리밍 대상 아님). 계약: `server/src/shared/realtime.ts`.

| 방향 | 이벤트 | 내용 |
|---|---|---|
| 앱 → 서버 | `stream:open` (ack) | `{sessionId, format: {encoding: "pcm16", sampleRate: 16000\|24000, channels: 1}}` → `{ok: true, streamId, outputSampleRate, mode: "interpret"\|"relay"}` 또는 `{ok: false, code}`. interpret = OpenAI 통역(출력 24kHz), relay = 같은 언어라 받은 음성을 그대로 전달(출력 = 보낸 표본률) |
| 앱 → 서버 | `stream:audio` | `{streamId, seq, pcm}` — PCM16 mono 약 100ms, 바이너리(ArrayBuffer). ack 없음. 최대 24,000바이트 |
| 앱 → 서버 | `stream:pause` | `{streamId}` — 단말이 **보내기를 멈췄다**는 뜻 (말이 멎은 뒤 ≥0.6초 무음까지 보낸 뒤). **통역 스트림의 턴은 이 이벤트로 확정하지 않는다** — 말 끝은 서버 VAD(무음 0.5초)만 정한다 (2026-10-19 실측: 수동 commit 을 한 번 보내면 OpenAI 세션의 VAD 가 멈춰 뒤의 말이 모두 사라짐). 대신 서버가 **무음 0.7초(`pauseSilenceMs`)를 엔진에 넣는다** (2026-10-23: 단말이 말 끝 뒤 0.6초만 보내고 멈추면 실제로 3초를 쉬어도 OpenAI 에는 0.6초 꼬리만 남아, 스피커의 방 잡음 때문에 다음 말과 한 턴으로 붙었다). 같은 언어 직접 전달은 턴을 닫는다 |
| 앱 → 서버 | `stream:playing` | `{streamId, playing: boolean}` — **내 단말의 통역 재생이 실제로 시작/끝났다** (2026-10-19, 메아리 차단용. 이중 오디오 `onPlayback`, 끝→시작이 200ms 안에 반복되면 보내지 않음). ack 없음. 한 번이라도 보낸 스트림은 서버가 재생 추정 대신 이 신호만 쓴다 |
| 앱 → 서버 | `stream:close` (ack) | `{streamId}` |
| 서버 → 듣는 사람 | `stream:out:start` | `{sessionId, turnId, fromUserId, lang, sampleRate}` |
| 서버 → 듣는 사람 | `stream:out:audio` | `{turnId, seq, pcm}` — 번역 음성 조각 (PCM16 24kHz), seq 는 턴마다 0부터 |
| 서버 → 듣는 사람 | `stream:out:text` | `{turnId, kind: "original"\|"translation", text}` — translation 은 조각(delta), original 은 원문 전사 완성본 |
| 서버 → 듣는 사람 | `stream:out:end` | `{turnId, status: "done"\|"failed", messageId}` — done 이면 기록 저장됨 |
| 서버 → 말한 사람 | `stream:mine:text` | `{sessionId, turnId, kind: "original"\|"original_partial"\|"translation", text}` — 내 말 자막 (2026-10-19). `original_partial` 은 받아쓰는 중 원문 조각(delta, 이어 붙임), `original` 은 완성본(붙인 조각을 통째로 바꿈), `translation` 은 번역 자막 조각. `original_partial` 은 말한 사람에게만 가고 듣는 사람(`stream:out:text`)은 완성본만 받는다 |
| 서버 → 말한 사람 | `stream:mine:end` | `{sessionId, turnId, status: "done"\|"failed"}` — 내 말의 턴 끝. failed 면 통역되지 않음 → 다시 말하도록 안내 |
| 서버 → 말한 사람 | `stream:fallback` | `{sessionId, streamId, reason: "ENGINE_FAILED"\|"BUDGET_EXCEEDED"}` + 봉투 (통화 종료 시에는 보내지 않음) → 발화 단위 방식으로 전환 |

- `stream:open` 오류 코드: `NOT_FOUND`(세션 없음·비참여자), `CONFLICT`(진행 중 아님), `UNSUPPORTED`(일괄 지시·`STREAMING=off`), `BUSY`(OpenAI 엔진 연결 상한 `STREAM_MAX_SESSIONS`, 직접 전달은 세지 않음), `BUDGET_EXCEEDED`, `ENGINE_UNAVAILABLE`(키 없음·엔진 열기 실패 — 통역 통화만), `VALIDATION_ERROR`. **앱은 ok 가 아니면 발화 단위 방식으로 통화한다.**
- 권한은 발화 단위와 같은 규칙(`LiveSessionService.utteranceTarget`). 다른 사람의 streamId 로 보낸 음성, 이미 받은 seq 는 무시하고, 빠진 seq 수는 기록 `timings.inputGaps` 에 남긴다.
- 스트림 수명: 통화가 끝나면(`finish`) 서버가 닫는다. 실시간 연결이 끊기면 그 연결이 연 스트림을 닫으므로 앱은 다시 연결한 뒤 `stream:open` 을 다시 보낸다. 같은 사람이 같은 통화에서 다시 열면 이전 스트림은 닫힌다.
- 기록: 턴이 끝나면 발화 단위 방식과 같은 형식으로 저장하고 `message:new`(듣는 사람)·`message:status`(말한 사람)를 보낸다. `stream:out:end`(messageId) 를 `message:new` 보다 **먼저** 보낸다 (서버 테스트로 순서 확인). **앱은 이미 스트림으로 재생한 messageId 의 `message:new` 를 다시 재생하지 않는다** (9절의 "세션 발화는 항상 재생" 규칙의 예외, `frontend/src/audio/streamed.ts`, S2 구현·live e2e 확인).
- 서버는 듣는 사람이 스트리밍 중인지와 상관없이 `stream:out:*` 를 보낸다. **앱은 자기 스트림이 열려 있을 때만 스트림 턴을 받는다** — 문장 단위(폴백)로 통화 중이면 무시하고 기록 알림(`message:new`)으로 재생한다 (2026-10-17 수정, live e2e `E2E_MIXED`). 같은 언어 직접 전달은 기록이 없어 이 경우 들리지 않는다(남은 한계).
- 실패한 턴(엔진 끊김·번역 실패)은 기록하지 않고 `stream:out:end`(failed) 만 보낸다 (사용자 결정 2026-10-13).
- **같은 언어 통화(relay, 사용자 결정 2026-10-13)**: OpenAI 를 거치지 않고 받은 조각을 그대로 상대에게 `stream:out:audio` 로 보낸다(표본률 변환도 없음). 조각이 오기 시작하면 `stream:out:start`, `stream:pause` 또는 1초 동안 조각이 없으면 `stream:out:end`(done, messageId null). 자막(`stream:out:text`)·기록·비용 없음.
- **말 끝 판단 (2026-10-19 결정)**: 통역 스트림의 말 끝은 **OpenAI 서버 VAD 만** 정한다. 단말은 말이 멎은 뒤 ≥0.6초 무음까지 보내 서버 VAD(0.5초)가 턴을 끝내게 하고, `stream:pause` 는 보내기 중단 알림일 뿐이다(서버는 그때 무음 0.7초만 엔진에 넣는다, 2026-10-23). 서버는 `input_audio_buffer.commit`·`response.create` 를 보내지 않는다 (실측: 수동 commit 뒤 그 세션의 VAD 가 `speech_started` 를 다시 내지 않아 2번째 말부터 모두 사라짐).
- **반이중 메아리 차단 (2026-10-19 실기기: 스피커로 들은 통역이 마이크로 다시 들어가 내 다음 말에 섞임)**: X 의 단말이 **재생 중인 동안과 그 뒤 꼬리 `echoGuardMs`(기본 300ms) 동안 X 가 보낸 `stream:audio` 조각은 버린다**. "재생 중" 은 ① X 의 앱이 `stream:playing` 을 보냈으면 그 신호(실제 재생 시작 ~ 끝), ② 한 번도 안 보냈으면(옛 앱 빌드·`call-peer.ts`) 서버 추정(X 에게 `stream:out:start` 를 보낸 뒤 그 턴의 `stream:out:end` 까지) — 서버 추정은 폰의 실제 재생보다 이르다(네트워크 + 지터 버퍼)라 실기기에서 꼬리 300ms 를 넘겨 메아리가 한 번 샜다(2026-10-19). ①이 있으면 ②는 보지 않는다(어긋나면 앱 신호가 이긴다, 서버 통합 시험) — 통역 스트림은 노이즈 필터를 거치지 않고 **같은 길이의 무음으로 바꿔** 엔진에 넣는다(말소리가 아니므로 서버 VAD 가 턴을 시작하지 않고, 재생 전에 하던 말은 이 무음으로 끝난다). 그냥 버리면 말 끝 무음이 사라져 그 말이 다음 말과 붙어 모두 사라진다 (2026-10-19 실제 OpenAI 로 확인). 같은 언어 직접 전달(relay)은 그냥 버린다 (상대의 원음도 스피커로 나오므로 규칙은 같다). X 에게 재생 중인 턴이 없으면 아무것도 바뀌지 않고, 재생이 끝났을 때 X 가 말하는 중이었으면 그 뒤 조각부터 정상으로 들어간다(앞부분은 무음으로 끝난 별도 턴이 될 수 있다). 버린 조각 수는 스트림이 닫힐 때 서버 로그("스트리밍 노이즈 필터·메아리 차단 결과", `echoDropped`)와 기록 `timings.echoDropped` 에 남는다. 순번(seq)은 버린 조각도 받은 것으로 세어 `inputGaps` 에 들어가지 않는다. 설정: `StreamHubOptions.echoGuardMs` (서버 코드, 환경 변수 없음).
- **전사 전용 세션 (2026-10-19, `STREAM_LIVE_TRANSCRIPTION=on` 기본)**: 서버는 화자 스트림마다 OpenAI 번역 세션 외에 **전사 세션**(`?intent=transcription`, `STT_MODEL`, 같은 server_vad)을 하나 더 열어 같은 음성을 넣는다. `stream:mine:text` `original_partial` 이 번역 응답과 따로 **말 끝 직후(실측 0.07–0.40초, 완성본 0.52–0.76초)** 온다 (번역 세션의 입력 전사는 응답과 얽혀 실기기에서 0.5–1.5초 늦었고 아예 안 오기도 했다). **2026-10-20 부터 전사 세션 모델은 `STREAM_STT_MODEL`(기본 `gpt-live-transcribe`, VAD 없이 연속 전사, `languages`·`delay: low`·용어집 `keywords`)이라 `original_partial` 이 말하는 도중(실측 말 시작 0.47–0.76초 뒤)에 온다.** 말 끝은 번역 세션 VAD 가 정하고 서버가 전사 세션에 `input_audio_buffer.commit` 을 턴당 1번 보내 두 세션 항목을 1:1 로 맞춘다. `STREAM_STT_MODEL=gpt-4o-transcribe` 면 예전처럼 확정된 구간만 전사해 말 끝 뒤에 조각이 온다. 번역 세션의 입력 전사는 끈다(받아쓰기 2번 청구 방지). 턴 id 는 서버(엔진)가 만들고 두 세션의 항목을 **순서대로** 묶는다 — 앱 쪽 계약은 바뀌지 않지만 `original_partial` 이 `stream:mine:*` 중 가장 먼저(번역 자막보다 먼저) 올 수 있다 (앱 `myCaptions` 는 말하는 중인 내 말에 붙인다). `off` 면 예전처럼 번역 세션이 전사까지 한다. 상세·짝짓기 실패 모드: `docs/streaming-plan.md` 4-3절.
- **현장 용어집 (2026-10-19)**: 통역 스트림의 세션 지시문에 언어 쌍(원문→대상) 기준 용어 ≤110개·검증 문장 ≤12개를 미리 넣는다 (`docs/streaming-plan.md` 4-2절). 앱 쪽 계약은 바뀌지 않는다.
- 음성 조각 이벤트는 빈도가 높아 봉투(eventId·at)를 붙이지 않는다. `stream:fallback` 만 봉투가 있다.

## 11. 확장

- 서버 다중화 시 `@socket.io/redis-adapter` 도입. 현재 설계(사용자 방, 서버 측 방 참여)는 그대로 동작한다.
