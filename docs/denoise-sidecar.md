# 노이즈 필터 사이드카 규격 (스트리밍 통화용)

작성 2026-10-19. 대상: 노이즈 필터 담당 개발자, 서버 연결 PR 작성자.

노이즈 필터는 서버에서 실행한다 (2026-10-14 결정, `docs/operations.md` 5절). 필터를 Python 등 다른 언어로 만들 수 있게,
서버 프로세스 밖의 **사이드카 컨테이너**로 띄우고 서버가 웹소켓으로 100ms 조각을 주고받는다.
배포 자리는 `deploy/docker-compose.yml` 의 `denoise` 서비스 (`profiles: ["denoise"]`, `build: ../denoise`).
구현: `denoise/` (GTCRN 스트리밍 ONNX, 추가 지연 32ms — `denoise/README.md`).

> 서버 쪽 연결 코드는 `sidecar` 필터(`server/src/engine/audio/sidecarStreamFilter.ts`, 4절)다. 기본은 여전히 `STREAM_AUDIO_FILTER=passthrough` 이고, `sidecar` 로 바꿔야 서버가 사이드카를 쓴다.
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
- 서버는 앞 조각 응답을 기다린 뒤 다음 조각을 보낸다. 시간 초과로 원본을 쓴 조각의 응답이 늦게 도착할 수 있다 — 서버는 **응답 수 대조**로 버린다 (4절). 그래서 사이드카는 받은 조각마다 **빠짐없이 정확히 1개**를 순서대로 돌려줘야 한다 (늦어도 건너뛰지 말 것).
- 이미지는 **linux/arm64** 로 빌드할 수 있어야 한다 (EC2 c7g).

## 4. 서버 연결 (`sidecar` 필터, 2026-10-19 구현)

`server/src/plugins/streamAudioFilter.ts` 의 `STREAM_FILTERS` 에 `sidecar` 로 등록돼 있다. 구현: `server/src/engine/audio/sidecarStreamFilter.ts`.

```ts
const STREAM_FILTERS: Record<string, () => StreamAudioFilter> = {
  passthrough: () => new PassthroughStreamFilter(),
  sidecar: () => new SidecarStreamFilter(process.env.DENOISE_URL || "ws://denoise:8765"),
};
```

| 동작 | 내용 |
|---|---|
| `open(context)` | 웹소켓 1개를 연다 (스트림당 1개). 16kHz 가 아니면 던짐 → 그 통화는 필터 없이 계속 |
| `process(frame)` | 3,200바이트를 바이너리 프레임으로 보내고, 응답 1개를 `Int16Array` 로 돌려준다. 시간 재기는 `SafeStreamFilter`(50ms)가 한다 |
| 연결 전 조각 | 연결을 기다렸다가 순서대로 보낸다 (compose 내부망에서는 보통 첫 조각 전에 열림). 그동안 50ms 를 넘기면 그 조각은 원본 |
| 연결 실패·끊김 | 기다리던 조각과 이후 조각이 모두 바로 실패 → 원본 사용, 연속 5번이면 그 통화에서 끔 (다시 연결하지 않는다) |
| 응답 밀림 | 응답을 기다리는 조각이 8개(`maxInFlight`)면 새 조각은 보내지 않고 바로 실패 |
| `close()` | 연결을 닫는다. 기다리던 조각은 실패 처리 |
| 텍스트 프레임 | 무시 (응답으로 세지 않는다) |

**늦은 응답 버리기 — 응답 수 대조로 정함.** 보낸 조각마다 대기열에 자리 1개를 두고, 응답이 오면 맨 앞 자리에 채운다.
시간 초과로 서버가 원본을 쓴 조각도 자리를 빼지 않으므로, 그 늦은 응답은 자기 자리(이미 아무도 기다리지 않음)에 채워져 버려지고
다음 조각은 항상 자기 응답을 받는다. 연결 재수립 방식과 비교해 고른 이유:
- 사이드카의 연결별 모델 상태(GTCRN 스트리밍 캐시)가 유지된다 — 재연결하면 상태가 초기화돼 첫 32ms 가 다시 0 이 된다
- 재연결 비용·경합(닫는 중인 연결의 응답)이 없다
- 대신 늦은 응답이 남아 있는 동안 다음 조각 응답도 그만큼 늦는다. 계속 밀리면 연속 5번 실패로 그 통화에서 꺼진다

부수 수정 (같은 PR): `SafeStreamFilter` 가 필터를 끈 뒤에도 이미 대기열에 있던 조각을 닫힌 세션에 넘겨 `error → disabled` 를 되풀이하던 문제를 고쳤다 (끈 뒤에는 원본 그대로). 스트림을 닫을 때 `스트리밍 노이즈 필터 결과` 로그(`frames`·`filtered`·`failed`·`disabled`)를 남긴다 (passthrough 는 남기지 않음).

켜기:
- `deploy/render-env.sh <fake|openai> sidecar` (또는 `STREAM_AUDIO_FILTER=sidecar ./render-env.sh openai`) → `.env` 에 `STREAM_AUDIO_FILTER=sidecar`, `DENOISE_URL='ws://denoise:8765'`
- `docker compose --profile denoise up -d` (사이드카와 서버를 함께). 절차는 `deploy/README.md` 7절
- 로컬: `server/.env` 에 `STREAM_AUDIO_FILTER=sidecar`, `DENOISE_URL=ws://127.0.0.1:8765`

확인 (2026-10-19, Mac, 모두 비용 0):
- 가짜 사이드카(`server/test/helpers/fakeSidecar.ts`): `server/test/sidecarStreamFilter.test.ts` 12개 — 순서·길이, 연결 전 조각, 스트림별 연결, 텍스트 프레임 무시, 16kHz 외 거부, 밀림, **늦은 응답 버리기**(3번째만 150ms 지연 → 3번째 원본, 4번째는 자기 응답), 연속 5번 시간 초과 끄기·연결 닫기, 통화 중 끊김, 연결 불가. `server/test/integration/streaming.test.ts` 의 "노이즈 필터 사이드카 연결" 4개 — 실제 통화 경로(가짜 엔진, Socket.IO, Postgres)
- 실제 사이드카(`feat/denoise-sidecar` 의 `denoise/`, Docker): 선택 시험 "실제 사이드카"(`DENOISE_TEST_URL` 이 있을 때만 실행)

  ```bash
  docker run -p 8765:8765 syncrew-denoise                     # 또는 -e DENOISE_MODEL=identity (32ms 지연만)
  cd server && DENOISE_TEST_URL=ws://127.0.0.1:8765 TEST_LOG_LEVEL=info \
    npx vitest run test/integration/streaming.test.ts -t "실제 사이드카"
  ```

  | 모델 | 서버 로그 `스트리밍 노이즈 필터 결과` | 사이드카 로그 (처리 ms) | 턴 |
  |---|---|---|---|
  | GTCRN | frames 17, filtered 17, failed 0 | P50 3.1 / P99 8.0 / 최대 8.8, 실패 0 | 없음 — 시험용 220Hz 순음을 잡음으로 지워 말 감지 안 됨 (필터가 일한 것) |
  | identity | frames 17, filtered 17, failed 0 | P50 0.1 / P99 1.6, 실패 0 | done (`DENOISE_TEST_EXPECT_TURN=1`) |

- 미확인: EC2 c7g 의 compose 내부망에서의 연결 (10/23), 실제 음성으로 GTCRN 을 거친 받아쓰기 품질

## 5. 사이드카 단독 확인 방법 (권장)

1. 16kHz mono PCM16 음성 파일을 3,200 바이트씩 잘라 보낸다
2. 받은 조각이 모두 3,200 바이트인지, 보낸 수와 같은지 확인한다
3. 조각별 왕복 시간 P50·P99 를 잰다 — **P99 가 50ms 미만**이어야 한다 (동시 연결 4개 상태에서도)
4. 받은 조각을 이어 붙여 wav 로 저장해 귀로 확인한다
