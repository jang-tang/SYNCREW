# 실시간 통역 네트워크·서버 경로 성능 점검 (2026-10-20, 브랜치 `perf/network`)

대상: 휴대폰 ↔ 서버 ↔ OpenAI 경로 중 **우리가 손댈 수 있는 부분** — `stream:audio`(100ms PCM16 16kHz) → Socket.IO →
`streamHub` → 엔진 `append`, 엔진 출력 → `stream:out:audio` → 앱 재생. 배포 구조: Caddy → `server:4000`(Docker, EC2 c7g.xlarge 시드니),
휴대폰은 한국 LTE (RTT ≈ 150ms, 고정 — 지역은 바꾸지 않는다). 원칙: **측정으로 근거가 있는 것만 바꾼다.**

모든 측정은 Mac(M-시리즈)에서 `ENGINE=fake`(비용 0) 로 했다. 절대값은 EC2 ARM 과 다르지만 **상대 비교**(전/후, 경유/직결)가 목적이다.

## 1. 측정 도구

`server/scripts/stream-latency.ts` (새로 추가). 서버 프로세스 안에 임시 Postgres(54332) + 서버(가짜 스트리밍 엔진) 를 띄우고,
자식 프로세스가 휴대폰 역할로 통화 N쌍(말하는 사람·듣는 사람 소켓)을 만들어 조각을 **실시간 속도**로 보낸다 (말 2초 + 무음 1초 반복).

| 항목 | 방법 |
|---|---|
| (a) 수신 → 엔진 append | 소켓 미들웨어(`socket.use`)에서 `stream:audio` 수신 시각, 엔진 래퍼에서 `append` 시각 |
| (b) 엔진 출력 → 앱 수신 | 엔진 래퍼의 `events.audio` 시각 → 듣는 쪽 소켓의 `stream:out:audio` 수신 시각 (같은 PC, 같은 시계) + 도착 간격 지터 `\|간격 − 100ms\|` |
| (c) 서버 CPU | `process.cpuUsage` (측정 구간만, 자식 = 앱 역할은 별도 프로세스라 제외) + `node --cpu-prof` |
| (d) 말 끝 → `stream:out:start` | 마지막 말소리 조각 보낸 시각 → 듣는 쪽 `stream:out:start` (가짜 엔진 무음 판단 500ms 포함) |
| 연결 끊김 감지 | `--drop-test`: 자식을 `SIGSTOP` 으로 얼려(TCP 는 살아 있지만 ping 에 답 못함 = LTE 터널·기지국 이동) 서버가 disconnect 를 내기까지 |
| 리버스 프록시 | `--port 4100 --via http://127.0.0.1:8080` 으로 Docker 의 Caddy 2.11 을 경유 |

```bash
cd server
npx tsx scripts/stream-latency.ts --pairs 4 --seconds 30            # 기본
npx tsx scripts/stream-latency.ts --frame-ms 60                      # 조각 크기 실험
npx tsx scripts/stream-latency.ts --drop-test                        # 끊김 감지 시간
node --cpu-prof --cpu-prof-dir=/tmp/prof --import tsx scripts/stream-latency.ts   # 서버 프로파일
```

## 2. 결과 요약 (통화 4쌍 · 30초 · 100ms 조각 · 입력 1,200조각 · 출력 800조각 · 턴 40개)

| 측정 | 기준선 | 변경 후 | 변경 |
|---|---|---|---|
| (a) 수신 → 엔진 append P50 / P95 | 0.244 / 0.338 ms | **0.066 / 0.146 ms** | 표본률 변환기 재작성 |
| (b) 엔진 출력 → 앱 수신 P50 / P95 | 0.448 / 1.249 ms | 0.323 / 0.989 ms | (변경 없음, 실행 편차 범위) |
| 앱 도착 간격 지터 P50 / P95 | 2.0 / 3.3 ms | 2.2 / 3.4 ms | (변경 없음) |
| (d) 말 끝 → `stream:out:start` P50 | 501 ms | 500 ms | (무음 판단 500ms 가 전부) |
| (c) 서버 CPU (34초 구간, 4스트림) | 2,284 ms = 코어 1개의 6.7% | **1,524 ms = 4.5%** | 표본률 변환기 (실행 편차 ±20%) |
| 프로파일 자체 시간: `LinearResampler.push` | 154 ms | **40 ms** | |
| 프로파일 자체 시간: GC | 151 ms | 81 ms | |
| 조용히 끊긴 연결 감지 (서버) | **44.6초** (25s+20s) | **19.6초** (10s+10s) | Socket.IO ping |
| 표본률 변환 마이크로벤치 (조각당) | 31.7 µs | **9.7 µs** | 출력 바이트 동일 확인 |
| 앱 base64 디코드 3,200B / 인코드 4,800B (Node/V8) | 28.7 / 22.9 µs | **10.1 / 15.9 µs** | Hermes 미측정 |

서버 CPU 중 입력·출력 조각 처리는 작은 부분이고, 나머지는 턴 기록(`persistTurn`: wav 인코딩·DB)·가짜 엔진의 톤 생성·모듈 로딩이다.
변경 후 프로파일에서 유휴(92.5%)·설정(`spawnSync` = prisma migrate)을 빼면 남는 상위는 `writev`(소켓 쓰기) 98ms, GC 81ms,
`tone`(가짜 엔진) 57ms, 표본률 변환 40ms, ws `send` 35ms — **서버 경로에 더 깎을 만한 큰 덩어리가 없다.**

## 3. 바꾼 것 (커밋별 전/후는 커밋 메시지에도 있음)

1. **측정 도구** `server/scripts/stream-latency.ts` (`c30b0f2`).
2. **표본률 변환기 `LinearResampler` Int16Array 재작성** (`dbe06ee`): `number[]` 2,400개 + 클로저 + `readInt16LE`/`writeInt16LE` →
   Int16Array 뷰(2바이트 정렬이 안 된 풀 Buffer 는 복사). 반복 조건은 기존 `while (t <= end)` 그대로라 출력이 바이트 단위로 같다
   (무작위 600조각·홀수 byteOffset 포함 비교). 정수 위상 누적 변형(9.1µs)도 해 봤지만 이득이 없어 채택하지 않았다.
3. **Socket.IO `pingInterval 10s` + `pingTimeout 10s`** (`b09a358`): 기본 25s+20s 면 LTE 가 조용히 끊겼을 때 서버·앱 모두 45초 뒤에야
   스트림을 닫고 다시 연다. 20초로 줄였다. ping 은 수 바이트이고 10초 제한은 RTT 150ms 의 60배라 오탐 위험은 낮다.
   앱(engine.io-client)은 핸드셰이크로 같은 값을 받으므로 앱 쪽 코드는 바꾸지 않았다. `perMessageDeflate: false` 는 기본값을 명시한 것.
4. **앱 base64** `frontend/src/audio/duplex/base64.ts` (`0843442`): 글자 단위 `+=` 제거. API·동작 동일, 단위 테스트 4개 통과.

## 4. 점검했지만 바꾸지 않은 것 (근거)

| 항목 | 확인 결과 |
|---|---|
| Socket.IO `perMessageDeflate` | engine.io 6.6 기본값 꺼짐(`opts.perMessageDeflate` 가 있을 때만 설정) — PCM 압축 없음. 명시만 했다 |
| `maxHttpBufferSize` 1MB | 조각 3.2KB, 상한 `MAX_FRAME_BYTES` 24KB 로 충분 |
| `stream:audio` 의 zod 검증 | 없음 (직접 필드 검사). 바이너리는 ws → engine.io → socket.io-parser 가 Buffer 를 그대로 넘기고 `toBuffer` 는 복사하지 않는다. 홀수 길이 처리는 `subarray` |
| pino-http `request completed` | Express 미들웨어라 소켓 경로를 타지 않음 — 1쌍 3초(조각 30개) 실행에서 REST 8건만 기록, 조각 로그 0 |
| `SafeStreamFilter` passthrough | 조각마다 Promise 1개(마이크로태스크). (a) 전체가 P50 0.066ms 라 바꿀 이유 없음. **관찰**: `deliver` 가 예외를 던지면 체인이 거절 상태로 남아 그 스트림의 이후 조각이 모두 조용히 버려진다 — 성능 문제가 아니라 손대지 않았다, 별도 수정 권장 |
| `pendingInput` concat / 조각당 로그 | 턴 시작 때만 concat, 조각당 로그 없음 |
| ws `setNoDelay` | ws 8.22 가 연결마다 `socket.setNoDelay()` 호출 (Nagle 없음) |
| **Caddy** | Docker 의 Caddy 2.11 (`reverse_proxy`, 접근 로그로 12건의 websocket 업그레이드 경유 확인) 경유 시 (b) P50 0.376ms vs 직결 0.369ms — 차이 없음. `flush_interval -1` 도 동일(0.365ms): 웹소켓은 업그레이드 뒤 Caddy 가 연결을 넘겨받아 버퍼링하지 않는다. 압축(`encode`)은 Caddyfile 에 없어 `/socket.io` 에 적용되지 않는다. HTTP/2 는 웹소켓 업그레이드와 무관(클라이언트가 HTTP/1.1 Upgrade). → `deploy/Caddyfile` 변경 없음 |
| 앱 transports | 이미 `["websocket"]` (폴링 없음) |
| 앱 재연결 백오프 | socket.io-client 기본 1s(±50%)→최대 5s. 측정할 수단이 없어(LTE 끊김 재현 불가) 두었다. ping 단축으로 끊김 감지가 25초 빨라진 것이 더 크다 |
| 앱 조각 보내기 | `ArrayBuffer` 그대로 `emit` (복사 없음). 조각 1개 = 텍스트 프레임(헤더 ~80B) + 바이너리 프레임(3,200B) |
| 재생 지터 버퍼 120ms (iOS·Android·웹) | OpenAI 출력은 실시간보다 빨리 몰려오므로 지터 버퍼는 턴 시작에만 영향. 변경 근거 없음 |
| `stream:out:audio` 조각 단위 | 엔진 delta 1개 = emit 1개 = 네이티브 `enqueue` 1번. OpenAI delta 크기 분포는 실호출 없이 알 수 없어 보류 |
| **조각 크기 100ms vs 60ms** | 60ms: 입력 조각 1,200→2,000개, 서버 CPU 2,284→2,581ms(+13%), 앱 역할 CPU +45%, (b) 최대 2.8→9.3ms. **(d) 말 끝 → 턴 시작 501 → 541ms 로 오히려 늘었다** — 가짜 엔진이 무음을 조각 단위로 누적해 9×60=540ms 가 되기 때문. 실제 OpenAI server_vad 의 입력 처리 단위는 알 수 없고, 이론적 이득은 패킷화 지연 평균 20ms(최대 40ms) 뿐. 사이드카 규격(`docs/denoise-sidecar.md`, 3,200바이트 고정)·`DuplexStartOptions.frameMs: 100`·네이티브 모듈까지 바꿔야 한다 → **바꾸지 않음** |
| 지역 | 시드니 ↔ 한국 RTT ≈ 150ms 는 고정 조건 (지시) |

## 5. 다음에 해 볼 것 (예상 이득)

| 후보 | 예상 | 비고 |
|---|---|---|
| 네이티브 ↔ JS 조각 전달을 base64 대신 `Uint8Array`/SharedArrayBuffer 로 (Expo Modules 는 `Uint8Array` 인자 지원) | 앱 JS 스레드 조각당 수십 µs ~ (Hermes 에서는) ms 단위 | base64 는 전송 크기도 +33%. 네이티브 모듈 양쪽(Swift·Kotlin) 수정 필요 |
| `stream:audio` 를 바이너리 1프레임으로 (헤더를 PCM 앞 20바이트에 넣고 Buffer 하나만 emit) | 조각당 ws 프레임 2→1, 서버 parser 작업 ~절반 | 서버 경로가 이미 0.07ms 라 체감 이득 없음 — 패킷 수가 문제될 때만 |
| `STREAM_VAD_SILENCE_MS` 500 → 300–400 (S6 계획) | 말 끝 → 턴 시작 100–200ms 단축 | 실제 OpenAI 로 끊김·조기 턴 확인 필요 (비용) |
| 앱 재연결 `reconnectionDelay` 500ms | 끊김 후 첫 재시도 0.5초 단축 | 실기기 LTE 에서만 검증 가능 |
| `SafeStreamFilter` 체인 거절 복구 | 성능 아님(견고성) | `deliver` 예외 시 스트림이 조용히 죽는 문제 |
| EC2 에서 같은 도구 실행 (`--db` 로 기존 DB, 또는 임시 Postgres) | ARM 절대값 확보 | `npx tsx scripts/stream-latency.ts` 는 서버 컨테이너 안에서도 돈다 |

## 6. 검증

- `cd server && npm run typecheck && npm test`: 233 통과 + 1 건너뜀 (실제 사이드카)
- `cd frontend && npm run typecheck && npm run test:unit`: 36 통과
- 미검증: Hermes(실기기)에서의 base64 수치, EC2 ARM 절대값, LTE 실제 끊김에서의 ping 동작(측정은 SIGSTOP 모사)
