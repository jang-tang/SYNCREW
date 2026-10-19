# 노이즈 필터 사이드카 규격 (스트리밍 통화용)

작성 2026-10-19. 대상: 노이즈 필터 담당 개발자, 서버 연결 PR 작성자.

노이즈 필터는 서버에서 실행한다 (2026-10-14 결정, `docs/operations.md` 5절). 필터를 Python 등 다른 언어로 만들 수 있게,
서버 프로세스 밖의 **사이드카 컨테이너**로 띄우고 서버가 웹소켓으로 100ms 조각을 주고받는다.
배포 자리는 `deploy/docker-compose.yml` 의 `denoise` 서비스 (`profiles: ["denoise"]`, 이미지 미정).

> 이 문서는 규격만 정한다. 서버 쪽 연결 코드(`sidecar` 필터)는 **별도 PR** 이며, 그 전까지 서버는 사이드카를 쓰지 않는다 (`STREAM_AUDIO_FILTER=passthrough`).
> 발화 단위(녹음 전체) 필터 `AUDIO_PREPROCESSOR` 는 이 문서 범위가 아니다.

## 1. 연결

| 항목 | 값 |
|---|---|
| 주소 | `ws://denoise:8765` (compose 내부망. 외부에 포트를 열지 않는다) |
| 연결 단위 | **통화 스트림 1개당 웹소켓 연결 1개** — 화자 1명이 통화 하나에서 말하는 동안 열고, 그 스트림이 끝나면 닫는다. 연결마다 잡음 추정 같은 상태를 따로 두면 된다 |
| 연결 시점 | 서버가 스트림을 열 때 (`StreamAudioFilter.open`) |
| 종료 | 서버가 닫는다 (`StreamFilterSession.close`). 사이드카가 먼저 닫으면 서버는 그 통화에서 필터 없이 계속한다 |
| 메시지 | **바이너리 프레임만** 쓴다. 텍스트 프레임(제어 메시지)은 지금 없음 |

## 2. 오디오 형식

| 항목 | 값 |
|---|---|
| 형식 | PCM16 (signed 16-bit, little-endian), mono |
| 표본율 | 16kHz (앱 기본) |
| 조각 길이 | 100ms = **1,600 표본 = 3,200 바이트** |
| 요청 | 서버 → 사이드카: 조각 1개 = 바이너리 프레임 1개 |
| 응답 | 사이드카 → 서버: **같은 길이(3,200 바이트)** 의 처리된 조각, **받은 순서대로** 1개씩 |

- 조각을 모았다가 한꺼번에 돌려주거나, 순서를 바꾸거나, 길이를 바꾸면 안 된다. 내부에서 앞뒤 조각을 참고(룩어헤드)하려면 그만큼 지연이 생기므로 아래 시간 제한 안에서만 한다.
- 무음 조각도 그대로 처리해 돌려준다 (건너뛰지 않는다).

## 3. 시간 제한과 실패 처리 (서버가 적용)

서버의 기존 안전 장치 `SafeStreamFilter`(`server/src/engine/audio/streamAudioFilter.ts`)가 그대로 적용된다. 그 파일의 규칙을 옮기면:

- 조각당 시간 제한 안에 끝나지 않거나, 오류·길이가 다른 출력이면 **원본 조각을 쓴다**
- **연속 5번 실패하면 그 통화에서는 필터를 끈다** (통역은 계속된다)
- 조각 순서는 항상 유지된다 — 앞 조각이 끝나야 다음 조각을 넘긴다

| 항목 | 값 (`DEFAULT_STREAM_FILTER_OPTIONS`) |
|---|---|
| 조각당 제한 | **50ms** (`frameBudgetMs`) — 웹소켓 왕복 포함 |
| 연속 실패 한도 | **5회** (`maxConsecutiveFailures`) — 넘으면 그 스트림에서 필터 끔 |
| 실패로 보는 것 | 시간 초과, 연결 오류, 3,200 바이트가 아닌 응답 |

사이드카 구현 시 주의:
- 50ms 는 compose 내부망 왕복(1ms 미만)을 빼면 거의 처리 시간이다. 조각 하나를 **수십 ms 안에** 처리해야 한다. c7g.xlarge(ARM64, 4 vCPU)에서 동시 통화 스트림 여러 개(서버 `STREAM_MAX_SESSIONS=4` 기준 최대 수 개)를 함께 처리할 수 있어야 한다.
- 서버는 앞 조각 응답을 기다린 뒤 다음 조각을 보낸다. 시간 초과로 원본을 쓴 조각의 응답이 늦게 도착할 수 있으므로, 연결 코드 PR에서 늦은 응답을 버리는 방법(예: 응답 순번 대조 또는 시간 초과 시 연결 재수립)을 정한다.
- 이미지는 **linux/arm64** 로 빌드할 수 있어야 한다 (EC2 c7g).

## 4. 서버 연결 계획 (별도 PR)

`server/src/plugins/streamAudioFilter.ts` 의 `STREAM_FILTERS` 에 `'sidecar'` 를 등록한다.

```ts
const STREAM_FILTERS: Record<string, () => StreamAudioFilter> = {
  passthrough: () => new PassthroughStreamFilter(),
  sidecar: () => new SidecarStreamFilter(process.env.DENOISE_URL ?? "ws://denoise:8765"), // 별도 PR
};
```

- `SidecarStreamFilter.open(context)` → 웹소켓 연결 1개, `process(frame)` → 바이너리 전송 후 응답 1개를 기다려 `Int16Array` 로 돌려줌, `close()` → 연결 닫기
- 서버 의존성 `ws` 는 이미 있다
- 켜기: `deploy/.env` 에 `STREAM_AUDIO_FILTER=sidecar` (지금 `render-env.sh` 는 `passthrough` 고정 — 연결 PR에서 인자 추가), `docker compose --profile denoise up -d`
- 확인: `server/test/integration/streaming.test.ts` 의 "서버 노이즈 필터" 시험과 같은 방식으로 가짜 사이드카(웹소켓 에코 서버)를 띄워 순서·시간 초과·연속 실패 끄기를 검사한다

## 5. 사이드카 단독 확인 방법 (권장)

1. 16kHz mono PCM16 음성 파일을 3,200 바이트씩 잘라 보낸다
2. 받은 조각이 모두 3,200 바이트인지, 보낸 수와 같은지 확인한다
3. 조각별 왕복 시간 P50·P99 를 잰다 — **P99 가 50ms 미만**이어야 한다 (동시 연결 4개 상태에서도)
4. 받은 조각을 이어 붙여 wav 로 저장해 귀로 확인한다
