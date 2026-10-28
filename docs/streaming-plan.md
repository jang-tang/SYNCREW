# 진짜 스트리밍 통역 계획 (말하는 동안 음성을 흘려보내는 방식)

작성 2026-10-12, **수정 2026-10-13** (S0 ① 결과와 사용자 결정 반영: 0-1절 아래 표). 진행: B1 완료, S0 ① 완료([s0-report.md](s0-report.md)), S1 서버 스트리밍 경로 완료(2026-10-13, 4-1절), **S2 웹 검증 클라이언트 완료(2026-10-14, 5-1절, 실제 OpenAI 확인 포함)**. **S3 네이티브 오디오 구현(2026-10-15, 5-3절, 자체 Expo 모듈) — 실기기 시험 대기.**
대상: SYNCREW 팀(PM·개발자)과 다음 작업 세션. 현재 구조는 `docs/live-interpretation.md`, 측정값은 `docs/phase6-report.md`를 기준으로 한다.

## 0. 요약

- **목표**: 말이 끝난 뒤 상대 이어폰에서 통역이 들리기까지 **약 6초 → P50 2.0초 이하** (2026-10-13 조정. S0 실측: 서버 기준 P50 1.83초). 1.5초는 S6 튜닝 목표.
- **방식**: 앱이 말하는 동안 PCM 음성을 100ms 단위로 서버에 계속 보내고, 서버는 OpenAI Realtime 세션을 통화 내내 열어 둔다. OpenAI가 말 끝을 감지해 바로 번역 음성을 만들기 시작하고, 서버는 만들어지는 조각을 그대로 상대 앱에 흘려보낸다. 상대 앱은 조각이 오는 대로 재생한다.
- **가장 큰 일**: 휴대폰에서 "블루투스 헤드셋 마이크로 녹음하면서 동시에 헤드셋으로 재생 + 에코 제거 + PCM 실시간 입출력"을 하는 **네이티브 오디오 계층**. 지금 쓰는 `expo-audio` 57로는 안 된다 (2절).
- **권장안**: 서버·Socket.IO 구조는 그대로 두고(새 이벤트 추가), 네이티브 오디오는 **기존 라이브러리를 실기기로 먼저 검증하고, 안 되면 자체 Expo 모듈을 만든다**. 지금의 발화 단위 방식은 **폴백으로 유지**한다.
- **진행**: 스트리밍 S0–S4·S6 (1:1 통화만, S5 일괄 지시 스트리밍은 취소) + 일괄 지시 대상 선택 UX 개선 B1·B2. S0(실기기 기술 검증)에서 계속할지 결정한다. 각 단계가 끝나면 멈추고 승인받는다.
- **전제 조건**: 실기기는 **S3부터** 필요(헤드셋 없이 휴대폰 스피커·마이크로 시작, 헤드셋은 S6), 2인 통화 확인(S4)에는 2대. OpenAI는 **충전 완료(2026-10-13)** — 서버 한도 상향은 금액을 정해 별도 승인. iOS 빌드를 위한 영문 경로 이동 권장.

## 0-1. 사용자 결정 (2026-10-12)

| 항목 | 결정 |
|---|---|
| 계획 진행 | **승인** — 이 문서대로 진행. 각 단계가 끝나면 멈추고 승인받는 규칙은 그대로 |
| D1 음성 경로 | **A. 우리 서버 경유 (Socket.IO + PCM)** |
| D2 네이티브 오디오 | 권장안대로: 라이브러리 실기기 검증 → 안 되면 자체 Expo 모듈 |
| 범위 | **스트리밍은 1:1 통역 통화만.** 일괄 지시는 지연이 있어도 괜찮으므로 **지금의 발화 단위 방식 유지** (일괄 지시 스트리밍 S5 취소). **2026-10-27 사용자 결정으로 확장: 현장 전체 연결(여러 명 실시간)도 스트리밍** — 말하는 사람마다 언어별 레인, 방 전체 반이중 (`docs/live-interpretation.md` 3-3절). 일괄 지시는 여전히 발화 단위 |
| 추가 요청 | **일괄 지시에서 구성원 중 누구에게 보낼지 정하는 UX 개선** (8-1절, 새 단계 B1·B2) |
| 실기기·헤드셋 | ~~2026-10-13 준비 → S0 ②부터~~ → 0-2절에서 변경: 휴대폰은 S3부터, 헤드셋은 S6 |
| S0 측정 비용 | 계획 승인에 포함 (약 $0.1–0.2). 실행 직전 예상 비용을 다시 안내하고 진행 |

### 0-2. 수정 결정 (2026-10-13, S0 ① 결과 후)

| 항목 | 결정 |
|---|---|
| 목표 지연 (P2) | 완료 기준 1 = **P50 ≤ 2.0초, P90 ≤ 3.0초**. 1.5초는 S6 튜닝 목표 |
| 비용·충전 (P4) | 말한 1분당 약 $0.18 기준. **OpenAI 충전 완료**. 서버 한도(`OPENAI_BUDGET_USD`, 현재 $0.5 누적)는 아직 그대로 — 새 금액은 사용자가 정한다 |
| OpenAI 세션 문맥 (P3) | 응답이 끝날 때마다 **OpenAI 세션 안의** 이전 대화 항목을 모두 지운다. **우리 DB 기록(원문·번역문·음성)은 지금처럼 저장** |
| 문맥 유지 방식 (P3 대안 채택) | 앞 **1–2문장을 짧은 텍스트(원문 → 번역)로 지시문에 넣는다** (음성으로 다시 읽히는 것보다 훨씬 쌈, D3 참고) |
| 진행 순서 | **실기기·헤드셋 검증(S0 ②)을 앞에서 빼고** S1 → S2 → S3 → S4 → S6으로 바로 구축 (7절) |
| 실기기 시험 방식 | **먼저 구현하고, 실기기 시험(2026-10-13 오후부터)에서 고친다.** S3은 1순위 라이브러리로 바로 구현해 두고, 휴대폰이 준비되면 스피커·마이크와 **블루투스 헤드셋까지 함께 시험**한다 (라이브러리가 블루투스에서도 될 수 있으므로). 안 되는 부분만 2순위 라이브러리나 자체 모듈로 바꾼다 |
| P1 말 끝 감지 | **승인**: OpenAI `server_vad`, 무음 500ms·앞 패딩 300ms로 시작 (semantic_vad 안 씀). S6에서 300–400ms 실험 |
| P5 원문 기록 | **승인**: 입력 전사(원문)에 `DomainProcessor` 현장 용어 보정 적용 + 전사 설정에 용어 힌트 |
| P6 세션 끊김 | **승인**: 통화 중 OpenAI 세션이 끊기면 진행 중 턴은 실패 처리 후 새 세션으로 다시 연결, 반복되면 발화 단위 방식으로 자동 전환 (S1 통합 테스트에 "중간 끊김" 주입 포함) |
| P7 추론 강도 | **승인**: S6에서 `reasoning: minimal`을 low와 비교 (지연·비용·번역 품질) |
| 같은 언어 통화 (2026-10-13) | **OpenAI 없이 음성을 그대로 상대에게 바로 전달** (전화 회선이 아니라 같은 스트리밍 경로로, 통역 API 안 거침). 자막·기록 없음 |
| 실패한 문장 (2026-10-13) | **기록하지 않는다** — 듣는 사람에게 "통역 실패"만 알림 |
| 용어집 미리 넣기 (2026-10-13) | ~~**보류** — 전체 788개는 문장마다 수천 토큰. S2 실제 확인에서 범위를 정해 비용을 잰 뒤 결정~~ → **2026-10-19 구현**: 언어 쌍 기준 용어 ≤110개 + 검증 문장 ≤12개(약 3,900자)를 지시문 앞쪽에 고정 (4-2절). **2026-10-24**: 한국어 은어 = 표준어 230개 전부 추가, 지시문 상한 7,500자 (`docs/field-terms.md` 7·8절) |
| 중복 재생 방지 (2026-10-13) | **S2 필수**: 스트림으로 이미 들은 문장의 기록 알림(`message:new`)은 다시 재생하지 않는다 |
| 서버 비용 한도 | **$3 누적으로 상향 (사용자 승인 2026-10-13, `server/.env` 적용)**. 더 올릴 때는 금액을 먼저 알리고 승인받는다 (S6 본격 튜닝 전) |
| 받아쓰기 모델 (2026-10-14) | **gpt-4o-transcribe** (mini 보다 정확, 용어 힌트는 오히려 나빠 쓰지 않음, 5-2절) |
| 번역 모델 (2026-10-14 비교) | 번역 전용 `gpt-realtime-translate` 와 같은 문장으로 비교 — 빠르고 싸지만 현장 용어·숫자·명령문 오역이 많고 우즈베크어 출력 불가 → **사용자 결정: 지금 `gpt-realtime-2.1` 유지, 번역 전용 모델 쓰지 않음** (이유·재검토 조건: [s0-report.md](s0-report.md) 4-3절) |
| 시험 플랫폼 | **iOS와 Android 모두에서 확인** (사용자 지시 2026-10-13). S3·S4·S6 실기기 시험은 iPhone·Android 휴대폰 둘 다 — iOS는 Apple 계정 필요 (프로젝트는 10-14 영문 경로로 이동 완료) |
| 노이즈 필터 (2026-10-14) | **서버에서 실행**. 발화 단위는 `AUDIO_PREPROCESSOR`, 스트리밍은 조각 단위 `STREAM_AUDIO_FILTER` 연결 지점 완료(5-2절). 실제 필터 구현은 담당 개발자 |
| 비용 (2026-10-14) | 충전 잔액 $80, 서버 한도 $3 유지, 막 쓰지 않기. 실제 청구액 대조는 하지 않음 |

## 1. 현재와 목표

### 지금 (발화 단위 방식, 2026-10-12 실측)

| 구간 | 시간 | 스트리밍에서 |
|---|---|---|
| 말 끝 감지 (단말, 무음 0.8초) | 0.8초 | OpenAI 서버 VAD로 옮기고 0.5초 안팎으로 조정 |
| 녹음 파일 업로드 | 0.03초 | 없음 (말하는 동안 이미 전송됨) |
| STT (`gpt-4o-mini-transcribe`) | 1–2초 | **없음** (음성 → 음성 직접 번역. 원문 기록은 병렬로) |
| 번역 + 음성 생성, **끝까지 만든 뒤 한 번에 전송** | 약 3초 | **첫 조각이 나오는 즉시 전송** |
| 내려받기·재생 시작 | 약 0.1초 | 조각 재생 버퍼 0.1–0.2초 |
| **합계 (말 끝 → 들리기 시작)** | **약 6초** | **목표 P50 ≤ 2.0초, P90 ≤ 3.0초** (2026-10-13 조정, 처음 목표 1.5초는 S6 튜닝 목표) |

목표값은 추정이다. OpenAI의 첫 음성 조각까지 걸리는 시간을 S0에서 실측해 확정한다.

> **S0 ① 실측 (2026-10-13, [s0-report.md](s0-report.md))**: 이 PC → OpenAI 기준 말 끝 → 첫 번역 음성 **P50 1.83초** (server_vad 500ms, 11턴), 말 끝 감지 0.95초 + 첫 음성까지 0.85초. 휴대폰 구간·재생 버퍼를 더하면 P50 약 2.0–2.1초 예상 → 목표 조정 제안(P2) 승인 대기.

### 완료 기준 (전체)

1. (범위: 1:1 통역 통화만. 일괄 지시는 발화 단위 방식 유지) 1:1 통역 통화에서 말 끝 → 상대 이어폰 첫 소리 **P50 ≤ 2.0초, P90 ≤ 3.0초** (같은 Wi-Fi, 실기기 + 블루투스 헤드셋, 20회 이상 측정. 2026-10-13 조정, 1.5초는 S6 튜닝 목표)
2. 블루투스 헤드셋으로 녹음·재생을 동시에 하고, 상대 통역이 내 마이크로 다시 들어가 번역되는 일(에코 루프)이 없다
3. 두 사람이 겹쳐 말해도 각 방향 통역이 끊기지 않는다 (전이중)
4. 통화·지시 기록(원문·번역문·음성)이 지금과 같은 형식으로 남는다
5. 스트리밍이 실패하면 발화 단위 방식으로 자동 전환되고 통화는 계속된다
6. 비용이 BudgetGuard 한도를 넘지 않는다 (통화 중 한도 도달 시 안내 후 발화 단위·텍스트로 전환 또는 종료)

## 2. 핵심 결정 (승인 필요)

### D1. 음성이 지나가는 길 — **권장: A**

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A. 우리 서버 경유 (Socket.IO + PCM)** | 앱 → (PCM 조각) → 서버 → OpenAI Realtime WebSocket → 서버 → (번역 음성 조각) → 상대 앱 | 지금 구조(인증·권한·세션·BudgetGuard·기록) 그대로 확장. 키가 서버에만 있음. 새 인프라 없음 | 지터 버퍼·재전송을 직접 다룸 (TCP라 와이파이가 나쁘면 순간 지연). 대역폭 PCM16 16kHz ≈ 256kbps/방향 (같은 Wi-Fi에서는 충분) |
| B. WebRTC 미디어 서버 (예: LiveKit 자체 호스팅 + 서버 측 에이전트) | 앱은 WebRTC로 방에 참여, 서버 에이전트가 각 화자 음성을 OpenAI로 보내고 번역 음성을 상대에게 발행 | 에코 제거·지터 버퍼·코덱(Opus)·블루투스 경로를 WebRTC 스택이 해결 → 네이티브 오디오 작업 크게 줄어듦 | **인프라 추가**(미디어 서버를 로컬 PC에서 운영), 기술 스택 큰 변경, Node 에이전트 SDK는 베타(공식 문서 기준 운영은 Python 권장), 기존 Socket.IO 세션과 이중 관리 |
| C. 휴대폰 → OpenAI 직접 WebRTC | 서버가 임시 키 발급, 앱이 OpenAI와 직접 연결 | 가장 간단, 지연 최소 | **번역 음성이 상대가 아니라 말한 사람에게 돌아온다** → 다시 상대에게 넘기는 경로가 필요. 비용·기록 통제 약함. 1:N 부적합 → **제외** |

- A를 권장하는 이유: 로컬 PC 호스팅·$ 비용 제약·이미 만든 서버 자산과 맞고, 필요한 변경이 "새 이벤트 + 새 서버 모듈 + 네이티브 오디오"로 한정된다.
- B는 S0에서 A의 네이티브 오디오가 실기기에서 기준을 못 넘을 때(특히 에코·블루투스) 다시 검토한다.

### D2. 네이티브 오디오 계층 — **권장: 라이브러리 실기기 검증 → 안 되면 자체 Expo 모듈**

필요한 기능: ① 블루투스 HFP·유선·휴대폰 마이크에서 PCM 실시간 캡처, ② 동시에 PCM 조각 연속 재생(같은 헤드셋으로), ③ 하드웨어 에코 제거(AEC), ④ 경로 변경(헤드셋 연결·해제) 알림, ⑤ 음량(dB) 제공(단말 VAD용).

| 후보 | 알려진 것 (2026-10 검색) | S0에서 확인할 것 |
|---|---|---|
| `expo-audio` 57 `AudioStream` | PCM 캡처만. iOS 녹음 전용 세션(재생·블루투스 불가), Android 휴대폰 마이크만 (Phase 5 소스 확인) | — (부적합) |
| `@speechmatics/expo-two-way-audio` | Expo 모듈. PCM 마이크 캡처 + PCM 재생(`playPCMData`) + 에코 제거 | 블루투스 HFP 입력·출력, Expo SDK 57 호환, 샘플레이트, 유지보수 상태 |
| `react-native-realtime-audio` | Expo 모듈. pcm16 녹음, base64 버퍼 실시간 재생, 에코 제거 옵션, VAD | 위와 같음 |
| `@siteed/expo-audio-studio` | 블루투스·USB·유선 입력, PCM 녹음 | 재생·에코 제거 없음 → 재생은 따로 필요 |
| **자체 Expo 모듈 (폴백)** | iOS: `AVAudioSession` playAndRecord + mode voiceChat + allowBluetooth(HFP), `AVAudioEngine` 입력 탭 + voice processing(AEC), `AVAudioPlayerNode` 버퍼 재생. Android: `AudioRecord`(VOICE_COMMUNICATION) + `AcousticEchoCanceler`, `MODE_IN_COMMUNICATION`, `setCommunicationDevice`(API 31+)/`startBluetoothSco`(이전), `AudioTrack` 스트리밍(USAGE_VOICE_COMMUNICATION) | 직접 구현 (S3에서 가장 큰 작업, Swift·Kotlin) |

- 어떤 것을 쓰든 앱 코드는 아래 인터페이스 하나에만 의존하게 해서, 구현을 바꿔 끼울 수 있게 한다 (`frontend/src/audio/duplex/`).

```ts
// 앱이 쓰는 이중 오디오 인터페이스 (구현: 라이브러리 어댑터 | 자체 모듈 | 웹 AudioWorklet)
export interface DuplexAudio {
  start(options: { sampleRate: 16000; frameMs: 100; echoCancellation: true }): Promise<void>;
  stop(): Promise<void>;
  onFrame(listener: (frame: { pcm: ArrayBuffer; levelDb: number; timestamp: number }) => void): () => void;
  /** 상대 통역 음성 조각을 이어서 재생 (streamId 별 순서 보장, 내부 지터 버퍼 100–200ms) */
  enqueue(streamId: string, pcm: ArrayBuffer, sampleRate: number): void;
  endStream(streamId: string): void;
  stopPlayback(): void;
  onRoute(listener: (route: "bluetooth" | "wired" | "speaker" | "unknown", deviceName?: string) => void): () => void;
  onPlayback(listener: (state: { streamId: string | null; playing: boolean }) => void): () => void;
}
```

### D3. OpenAI 구성 — **권장: 화자 × 대상 언어마다 음성→음성 세션 1개**

- 1:1 통화: 세션 2개 (A의 말 → B 언어, B의 말 → A 언어). 같은 언어끼리면 통역 없이 원음 중계 — **확정·구현 (2026-10-13): OpenAI 없이 음성 직접 전달(relay), 자막·기록 없음**.
- 일괄 지시(1:N): **이번 범위 밖 (사용자 결정: 발화 단위 방식 유지).** 나중에 한다면 관리자 말 → 대상 **언어 수만큼** 세션 (사람 수 아님). 서버 모듈은 언어별 팬아웃을 막지 않게 설계만 해 둔다.
- 비교안: 스트리밍 STT 1개 → 언어별 번역(텍스트) → 음성 생성. 세션 수는 줄지만 단계가 늘어 지연이 커지고 출력 음성 비용은 같다 → 채택 안 함 (S0 결과가 예상과 다르면 재검토).
- 세션 설정 (GA 인터페이스, S0에서 공식 API 레퍼런스로 다시 확인):
  - `session.type: "realtime"`, `output_modalities: ["audio"]`, 출력 PCM 24kHz, 음성 `marin`
  - `session.audio.input.turn_detection`: `server_vad`(무음 기준, 기본) 또는 `semantic_vad`(문장 완결 판단) — S0에서 둘 다 측정. **`interrupt_response: false`**: 화자가 이어서 말해도 진행 중인 번역을 끊지 않는다 (끊기면 앞 문장 통역이 사라짐)
  - 입력 음성 전사(원문 기록용)를 켠다 (`session.audio.input.transcription`) — 원문 기록, 자막, 현장 용어 감지 사후 기록
  - 지시문: 지금 `buildInstructions`의 규칙(번역만, 답하지 말 것, 안전 지시 짧고 강하게, 숫자 보존) + **현장 용어집을 세션 시작 때 지시문에 미리 넣는다** (지금은 원문 텍스트에서 감지한 용어만 넣지만, 스트리밍에선 원문이 번역보다 늦게 나오므로). 지시문은 고정이라 캐시 단가 적용 기대
- **대화 컨텍스트 관리 (2026-10-13 결정)**: Realtime 세션은 남아 있는 이전 턴을 다음 응답의 입력으로 다시 읽는다(이전 입력은 음성 토큰으로). S0 실측: 이전 1턴 유지만으로 턴당 +15%, 지우지 않으면 통화가 길수록 선형 증가.
  - 응답이 끝날 때마다 **세션 안의 이전 항목을 모두 지운다** (`conversation.item.delete`, 유지 0턴). 이것은 OpenAI가 들고 있는 문맥일 뿐이고, 통화 기록은 `persistTurn`으로 우리 DB에 저장된다.
  - 문맥은 **텍스트로 넘긴다**: 직전 1–2턴의 "원문 전사 → 번역문"을 지시문 끝의 "참고 문맥(번역하지 말 것)" 칸에 넣고 `session.update`로 바꾼다. 비용은 2문장 약 60–100 텍스트 토큰(턴당 약 $0.0004)으로 음성 재입력(약 $0.0015)보다 싸다.
  - 주의: 원문 전사는 말 끝 뒤 약 1.8초에 도착하므로 바로 이어 말하면 직전 턴이 아직 없을 수 있다(있는 것만 넣는다). 문맥 칸을 번역해 버리거나 대답하는 일이 없는지 S2 실제 확인에서 함정 문장과 함께 본다. 지시문이 매 턴 바뀌면 캐시가 안 맞지만, S0에서 캐시는 원래 거의 안 맞았다.
- 세션 최대 시간·재연결: 세션 시간 제한에 닿거나 끊기면 서버가 새 세션을 열고 이어 받는다 (그 사이 조각은 버퍼링).

### D4. 말 끝 감지와 전송 게이트 — **권장: 단말 VAD로 "보낼지" 결정 + OpenAI VAD로 "말 끝" 결정**

- 단말: 지금 `audio/vad.ts`(소음 기준 +12dB, 0.15초 이상)를 프레임 단위로 재사용해 **말소리가 있을 때만** 서버로 보낸다. 앞부분이 잘리지 않게 0.3–0.5초 사전 버퍼를 함께 보내고, 말이 멎은 뒤 0.6초 동안은 계속 보낸다(OpenAI가 말 끝을 판단할 무음 제공).
  - 이유: 통화 시간 내내 무음까지 보내면 입력 음성 요금이 계속 나간다. 대역폭·배터리도 줄어든다.
- 서버/OpenAI: `server_vad`(예: 무음 500ms, 앞 패딩 300ms)로 턴 종료 → 자동 응답. ~~단말 게이트가 끝나면 서버가 `input_audio_buffer.commit`으로 확정해 늦어지지 않게 한다.~~ **2026-10-19 폐기: 수동 commit 을 한 번 보내면 그 세션의 서버 VAD 가 멈춰 뒤의 말이 모두 사라진다(실제 API 실측). 말 끝은 서버 VAD 만 정하고 `stream:pause` 는 보내기 중단 뜻만 갖는다** (`docs/realtime-protocol.md` 10절).
- 긴 발화: 지금처럼 25초에서 강제로 끊는 대신, S6에서 "쉼(300ms)마다 확정해 말하는 도중에도 앞부분 통역 시작" 실험 (번역 정확도와 교환).

### D5. 기존 발화 단위 방식 — **권장: 폴백으로 유지**

- 세션에 `transport: "stream" | "utterance"`를 두고, 앱 능력(네이티브 모듈 유무·웹)·서버 설정·실패 상황에 따라 고른다.
- 스트리밍 중 오류(소켓 끊김 반복, OpenAI 세션 실패, 한도 임박) → 자동으로 발화 단위 방식으로 바꾸고 화면에 안내.
- 지금 테스트(서버 157개, e2e 79개)와 기능은 그대로 유지된다.

## 3. 전체 구조

```
 [화자 휴대폰]                       [로컬 서버 (Express + Socket.IO)]                         [OpenAI]
  DuplexAudio.onFrame (100ms PCM)
   └ 단말 VAD 게이트 ──stream:audio──▶ StreamHub (인증·세션·권한 확인)
                                       └ InterpreterSession (화자 × 대상 언어)
                                           ├ 16k→24k 변환 ──input_audio_buffer.append──▶ Realtime 세션 (server_vad)
                                           │                                              │
                                           ◀── response.output_audio.delta (24k PCM) ──────┤
                                           ◀── output_audio_transcript.delta / 입력 전사 ──┘
                                           ├ 조각 그대로 전달 ──stream:out:audio──▶ [청자 휴대폰] DuplexAudio.enqueue → 헤드셋
                                           ├ 자막 전달 ─────────stream:out:text───▶ 통화 화면 실시간 자막
                                           └ response.done → 메시지 저장(원문·번역문·WAV) + 비용 기록 → message:new (기록·동기화)
```

### 실시간 이벤트 (추가, `server/src/shared/realtime.ts`)

| 방향 | 이벤트 | 내용 |
|---|---|---|
| 앱 → 서버 | `stream:open` (ack) | `{sessionId, format: {encoding: "pcm16", sampleRate: 16000, channels: 1}}` → `{ok, streamId}` 또는 오류(권한·한도·미지원) |
| 앱 → 서버 | `stream:audio` | 바이너리 PCM 조각 + `{streamId, seq}` (100ms ≈ 3.2KB). 서버는 순서 확인, 큐가 넘치면 오래된 것부터 버리고 경고 |
| 앱 → 서버 | `stream:pause` / `stream:close` | 단말 게이트 종료(말 멎음) / 통화 종료 |
| 서버 → 앱 | `stream:out:start` | `{sessionId, turnId, fromUserId, lang, sampleRate: 24000}` (청자에게) |
| 서버 → 앱 | `stream:out:audio` | 바이너리 PCM 조각 + `{turnId, seq}` |
| 서버 → 앱 | `stream:out:text` | `{turnId, kind: "original" \| "translation", delta}` 실시간 자막 |
| 서버 → 앱 | `stream:out:end` | `{turnId, messageId}` (기록 저장 완료, 기존 `message:new`와 연결) |
| 서버 → 앱 | `stream:fallback` | `{sessionId, reason}` → 앱이 발화 단위 방식으로 전환 |

- 상태 변경(통화 걸기·수락·끊기)은 지금처럼 REST. 음성 조각만 Socket.IO(웹소켓 전송, 바이너리).
- React Native socket.io-client의 바이너리 전송 성능·호환은 S0에서 확인 (안 되면 base64, 약 33% 증가).

## 4. 서버 설계 (`server/src/streaming/`)

| 모듈 | 역할 |
|---|---|
| `streamHub.ts` | Socket.IO 이벤트 처리. 세션 참여자·활성 상태·화자 권한(일괄 지시는 관리자만) 확인 — 기존 `LiveSessionService.utteranceTarget` 규칙 재사용 |
| `interpreterSession.ts` | 화자 × 대상 언어 1개. OpenAI 세션 수명(열기·재연결·닫기), 입력 조각 전달, 출력 조각 팬아웃(같은 언어 청자 모두), 턴 상태, 컨텍스트 정리 |
| `realtimeStream.ts` | OpenAI Realtime WebSocket 어댑터 (지금 `realtimeTranslator.ts`의 연결·이벤트 처리 재사용, 세션 유지형) |
| `fakeStream.ts` | 테스트·개발용 가짜 스트림 엔진: 입력 길이에 비례한 무음/톤 PCM 조각과 "[vi] …" 자막을 일정 간격으로 생성 (비용 0, 지연 주입 가능) |
| `resample.ts` | PCM16 16k ↔ 24k 변환 (선형 보간이면 충분, 필요시 다상 필터) |
| `persistTurn.ts` | 턴 종료 시 메시지 저장: 원문(입력 전사)·번역문·번역 음성 WAV·`sessionId`. 기존 `messages`·`message_translations`·기록 API와 같은 형식이어야 함 (지금 파이프라인을 거치지 않는 "이미 번역된 메시지" 저장 경로 추가) |
| 비용 (`StreamingMeter`) | 세션 열기 전 남은 한도 확인(최소 N분 분량), 턴마다 말한 초 × 예상 단가로 예약 → `response.done` 사용량으로 확정. 통화당 최대 시간, 한도 임박 시 `stream:fallback` 또는 종료 |

- 장애 처리: OpenAI 오류·시간 초과 → 그 턴만 실패 처리(청자에게 "통역 실패" 자막) + 재시도 1회, 반복되면 폴백. 서버 재시작 → 열린 스트림은 모두 닫히고 앱은 재연결 후 `stream:open` 다시.
- 동시성: 서버 1대·현장 1곳 기준. 동시 OpenAI 세션 수 상한 설정(`STREAM_MAX_SESSIONS`), 넘치면 발화 단위 방식.
- 로그: 턴마다 단계별 시각(첫 입력, 말 끝, 첫 출력 조각, 마지막 조각, 청자 전달)을 기록해 지연을 상시 측정.

### 4-1. S1 구현 결과 (2026-10-13)

| 파일 (`server/src/streaming/`) | 내용 |
|---|---|
| `engine.ts` | 엔진 계약(`StreamEngine`·`StreamConnection`·이벤트), 스트리밍 지시문(`buildStreamInstructions`: 기존 번역 규칙 + 직전 턴 텍스트 문맥 "참고용, 다시 번역·대답 금지") |
| `realtimeStream.ts` | OpenAI 어댑터: 통화 내내 세션 유지, server_vad 500ms·interrupt_response=false·입력 전사, 턴 = 확정된 입력 항목(item_id). 턴마다 비용 예약 → `response.done`·전사 사용량으로 기록. 턴이 끝나면 세션 안 항목 삭제, 문맥은 `session.update`. 연결 끊김 → 진행 중 턴 실패 + `closed` |
| `fakeStream.ts` | 가짜 엔진(`ENGINE=fake`·테스트): 음량으로 말 끝 판단, 톤 PCM·"[vi] [음성 ko] 1.0s" 자막, 실패·끊김·한도·열기 실패 주입 |
| `resample.ts` | 16k→24k 선형 보간(조각 경계 유지), RMS |
| `persistTurn.ts` | 턴 → 기록 (발화 단위 방식과 같은 형식, 원문 전사에 현장 용어 보정 P5, `timings.streamed=1`) |
| `streamHub.ts` | 권한(`utteranceTarget` 재사용), 1:1만, 듣는 사람 개인 방으로 조각 전달, 직전 2턴 텍스트 문맥, 엔진 끊김 → 다시 연결(60초 안 2번이면 폴백), 통화 종료·연결 끊김 시 닫기, 동시 상한 |

- 연결: `realtime/gateway.ts`(소켓 이벤트, 바이너리 수신), `sessions/liveSessions.ts`(통화 종료 시 스트림 닫기), `bootstrap.ts`(엔진 선택), 환경 변수 `STREAMING`·`STREAM_MAX_SESSIONS`·`STREAM_VAD_SILENCE_MS`.
- 이벤트 계약: `server/src/shared/realtime.ts`, 문서 [realtime-protocol.md](realtime-protocol.md) 10절. 3절 표와 달라진 점: `stream:fallback` 이유는 `ENGINE_FAILED`·`BUDGET_EXCEEDED` 두 가지, `stream:out:text` 의 original 은 조각이 아니라 완성본.
- **S1 후 사용자 결정 (2026-10-13, 0-2절)**
  - 같은 언어 통화: **OpenAI 없이 음성 직접 전달(relay)** — 구현·테스트 완료. `stream:open` 결과 `mode: "relay"`, 자막·기록 없음.
  - 실패한 턴은 기록하지 않는다 (듣는 사람에게 `stream:out:end` failed 만) — 승인.
  - 현장 용어집 미리 넣기 **보류** — 승인 (`engine.ts` TODO, S2 실제 확인에서 범위·비용 측정 후 결정). → 2026-10-19 구현 (4-2절).
  - **S2 필수**: 앱은 스트림으로 이미 재생한 messageId 의 `message:new` 를 다시 재생하지 않는다.
- 검증: 서버 테스트 **181개** 통과 (기존 157 + 스트리밍 24 — 같은 언어 직접 전달 1 추가. 아래 23개 설명은 처음 구현 기준: 통합 13 — 양방향·기록 형식·대조군·문맥·pause·권한 매트릭스·순번·통화 종료·연결 끊김·재열기·엔진 끊김 재연결·반복 끊김 폴백·한도 폴백·열기 실패·상한·엔진 없음 / 단위 10 — 표본률 변환·지시문·OpenAI 어댑터 프로토콜(로컬 가짜 서버)·사용량 계산). 스트리밍 테스트 5회 반복 모두 통과. `ENGINE=fake` 서버 시작 확인.
- 고친 버그: ① OpenAI 응답이 비용 예약보다 먼저 끝나면 사용량이 기록되지 않고 예약이 남던 문제 ② 비용 한도로 턴을 취소할 때 응답이 아직 만들어지기 전이면 취소 요청을 보내지 않던 문제(반복 실행에서 가끔 실패해 발견) — 둘 다 테스트로 발견. 수정 후 스트리밍 테스트 12회 반복 실패 0.
- 미검증: 실제 OpenAI 로 스트리밍 경로 전체 (S2에서 1–2회), 앱(웹·네이티브) 쪽 전체 — S2·S3.

### 4-2. 반이중 메아리 차단 + 스트리밍 용어집 (2026-10-19, 실기기 발견 2건)

실기기(iPhone, 스피커) 1:1 스트리밍 통화에서 발견: ① 스피커로 나온 통역 소리가 마이크로 다시 들어가 내 다음 턴에 섞였다(음향 메아리) ② 발화 단위 방식과 달리 스트리밍은 현장 용어집을 전혀 쓰지 않았다(`buildInstructions(..., { terms: [] })`).

**① 반이중 메아리 차단 (`streamHub.ts`)**
- 규칙: 서버가 X 에게 턴을 보내는 동안(`stream:out:start` ~ 그 턴의 `stream:out:end`) + 꼬리 `echoGuardMs`(기본 300ms) 동안 X 가 보낸 조각은 `audio()` 에서 바로 버린다. **통역 스트림은 버리는 대신 같은 길이의 무음으로 바꿔**(필터 생략, 순서 유지) 엔진에 넣는다 — 말소리가 아니라 서버 VAD 가 턴을 시작하지 않고, 재생 전에 하던 말의 말 끝 무음 역할을 한다. 같은 언어 직접 전달(relay)은 그냥 버린다(상대 원음도 스피커로 나오므로 규칙은 같다).
- **왜 무음인가 (실제 OpenAI 확인, 2026-10-19)**: 처음엔 조각을 그냥 버렸다. 두 스크립트가 거의 동시에 말한 1차 확인에서 관리자 말의 **말 끝 무음 조각이 버려져**(상대 통역 재생 중) OpenAI 서버 VAD 가 턴을 끝내지 못했고, 다음 말과 붙어 ko→vi 2턴이 모두 사라졌다 (`echoDropped: 22`, 번역 0건). 무음으로 바꾸니 타임라인이 끊기지 않아 턴이 끝난다 (2차 확인 결과는 아래).
- 구현: 듣는 사람별 재생 상태(`playback: Map<userId, { turns, guardUntil }>`). 모든 `stream:out:start`/`end` 는 `playbackStarted`/`playbackEnded` 를 거친다(통역 턴·relay 턴·닫힐 때 실패 처리 포함). 타이머 없이 시각 비교. `echoGuardMs: 0` 이면 꼬리 없음.
- 경계: X 에게 재생 중인 턴이 없으면 아무것도 바뀌지 않는다. 재생이 끝났을 때 X 가 말하는 중이면 그 뒤 조각부터 정상(앞부분은 무음으로 끝난 별도 턴이 될 수 있다). 버린 조각은 순번을 받은 것으로 세어 `inputGaps` 에 들어가지 않는다.
- 진단: 스트림이 닫힐 때 로그 "스트리밍 노이즈 필터·메아리 차단 결과" (`echoDropped`·`gaps`·필터 통계, 필터가 passthrough 여도 남김), 기록 `timings.echoDropped`, 시험용 `StreamHub.stats(streamId)`.
- 한계: 상대 턴 재생 중에는 내가 말해도 들어가지 않는다(반이중). 실기기에서 "상대가 말하는 동안 끼어들기"가 필요하면 단말 AEC(S3 voice processing)가 먼저고, 서버 차단은 그 보조다. 꼬리 300ms 는 재생 지연(단말 버퍼 + 네트워크)보다 짧을 수 있어 실기기에서 조정한다.

**② 스트리밍 용어집 (`engine.ts`·`domainProcessor.ts`·`realtimeStream.ts`)**
- 스트리밍은 번역 전에 원문 텍스트가 없어 용어를 원문에서 고를 수 없다 → **언어 쌍(원문→대상) 기준으로 고정된 묶음**을 세션을 열 때 지시문에 넣는다 (`DomainProcessor.streamGlossary(source, target)`, 쌍마다 한 번 만들어 캐시).
- 선택·순서 (결정적 — OpenAI 프롬프트 캐시가 앞부분 일치로 맞으려면 매번 같아야 한다): 원문·대상 표현이 모두 있는 용어만. 묶음 critical → high+안전 분야(데이터셋 domain 에 safety/ppe/emergency) → high+핵심(core) → high → normal+핵심 → normal, 묶음 안은 원문 코드 포인트 순. 같은 원문 표현이 여러 항목이면(vi→ko 의 "giàn giáo" = 비계·아시바) 표준 용어가 은어보다 우선. 검증 문장은 데이터셋 순서(긴급 문장이 앞) 그대로.
- **상한**: 용어 **110개**, 검증 문장 **12개** → ko↔vi 지시문 약 3,800–3,900자(문맥 2줄 포함), `STREAM_INSTRUCTIONS_MAX_CHARS = 4,500` 을 시험이 모든 언어 쌍에서 확인. 110개인 이유: ko→vi 데이터의 critical 용어가 64개라 60개로 자르면 critical 만 남아 안전모·장갑 같은 PPE 용어(high)가 빠진다. 지금 데이터는 **ko↔vi 만 번역이 있어** zh·ru·uz 쌍은 용어 0개(데이터 보강은 다른 팀원 몫).
- 글자 수를 아끼려 의미(meaning)·규칙(rule)은 넣지 않고 `원문 → 대상` 만 넣는다 (발화 단위 방식은 감지된 용어 ≤12개에 의미·규칙까지).
- 지시문 구조: [고정] 번역 규칙 + 용어집 + 검증 문장 + 실시간 통화 안내 → [턴마다] 직전 1–2턴 문맥. `setContext` 는 뒤쪽만 바꿔 앞부분 캐시가 유지된다 (단위 시험: 문맥을 넣은 지시문이 문맥 없는 지시문으로 시작함).
- 비용: 지시문 약 1,500 입력 텍스트 토큰/턴. 첫 턴은 정가, 2번째 턴부터 캐시 — **실제 확인(아래)에서 세션의 2번째 턴은 `cached_tokens` 1,408 / 비캐시 텍스트 102** 로 캐시가 맞았다 (턴당 $0.011–0.014 → $0.007–0.008). S0(1절)에서 캐시가 거의 안 맞은 것은 지시문이 캐시 최소 길이(1,024토큰) 미만이었기 때문으로 보인다.
- 데이터셋 어댑터에 `risk`(risk_level)·`core`(vi-priority 의 priority: core)·`domain` 을 추가했다 (`LexiconEntry` 선택 필드, 정규화 JSON 어댑터도 같은 이름).
- 시험: `test/streamingEngine.test.ts` 용어집 4개(비계·안전모 포함, 앞부분 고정, 모든 쌍 크기 상한, 결정적 순서) + OpenAI 어댑터 1개(세션 지시문에 용어집, setContext 뒤 앞부분 유지), `test/integration/streaming.test.ts` 메아리 차단 3개(통역 재생 중·꼬리 안 무음 대체 + 대조군, `echoGuardMs: 0`, relay). 서버 전체 **229개** 통과.

**실제 OpenAI 확인 (2026-10-19, `scripts/call-peer.ts` 2개로 스크립트끼리 통화, 관리자 ko ↔ 구성원 vi, 각 2턴, 9초 간격)**

| 회차 | 방향·턴 | 결과 | 원문 → 통역 |
|---|---|---|---|
| 1차 (조각 그냥 버림) | vi→ko 1·2 | done | Tôi hiểu rồi, tôi sẽ bắt đầu ngay. → 알겠습니다, 바로 시작하겠습니다. |
| 1차 | ko→vi 1·2 | **없음** (턴이 끝나지 않음) | 관리자 말 끝 무음이 상대 통역 재생 중이라 버려짐(`echoDropped: 22`) → 서버 VAD 가 턴을 못 끝냄 |
| 2차 (무음 대체) | ko→vi 1 | done | 안전모를 쓰고 3층 비계 작업을 시작하세요. → Đội mũ bảo hộ và bắt đầu làm việc trên giàn giáo tầng 3. |
| 2차 | vi→ko 1 | done | Tôi hiểu rồi, tôi sẽ bắt đầu ngay. → 알겠습니다. 바로 시작하겠습니다. |
| 2차 | ko→vi 2 | done | 안전모를 쓰고 3층 비계 작업을 시작하세요. → Đội mũ bảo hộ và bắt đầu làm việc trên giàn giáo tầng 3. |
| 2차 | vi→ko 2 | done | Tôi hiểu rồi, tôi sẽ bắt đầu ngay. → 알겠습니다. 바로 시작하겠습니다. |

- **비계 → giàn giáo, 안전모 → mũ bảo hộ** 가 ko→vi 2턴 모두에서 나왔다 (용어집 효과. 2차도 두 스크립트가 거의 동시에 말해 관리자 조각 12개가 무음으로 바뀌었지만 턴은 끝났다).
- 비용: 1차 $0.019 + 2차 $0.042 = **$0.061** (승인 상한 $0.15). 말 끝 → 첫 조각 0.73–1.13초.
- 남은 한계: 두 사람이 겹쳐 말하면 겹친 부분은 무음이 된다(반이중). 실기기에서 스피커 에코가 실제로 사라지는지, 꼬리 300ms 가 단말 재생 지연에 맞는지는 실기기 시험에서 확인.

### 4-3. 전사 전용 세션(실시간 원문 자막) + 폰 재생 신호 메아리 차단 (2026-10-19, 실기기 2차 발견)

실기기(iPhone, 스피커, 시드니 서버) 1:1 스트리밍 통화에서 발견: ① 내 말 자막("나" 상자)이 말을 멈춘 뒤 0.5–1.5초 뒤에야 뜨고, 4턴 중 2턴은 원문이 아예 없었으며 6초짜리 말이 "안녕." 으로만 전사됐다 — 번역 세션의 입력 전사(`audio.input.transcription`)는 **턴이 확정된 뒤에야** 시작되기 때문 ② 메아리 차단이 조각 39개를 무음으로 바꿨지만 한 번 샜다 — 서버 추정(`stream:out:start`~`end`+300ms)보다 폰의 실제 재생이 늦다(네트워크 + 지터 버퍼).

**① 전사 전용 세션 (`realtimeStream.ts`, `STREAM_LIVE_TRANSCRIPTION=on|off`, 기본 on)** — 아래 ③(2026-10-20)에서 모델을 `gpt-live-transcribe` 로 바꿔 "말하는 도중 자막"을 달성했다. 이 절의 측정은 `gpt-4o-transcribe` 기준.
- 화자 스트림마다 OpenAI 연결 2개: **번역 세션**(기존, `?model=gpt-realtime-2.1`) + **전사 세션**(`?intent=transcription`, `session.update {type:"transcription", audio.input: {format pcm 24k, transcription: {model: STT_MODEL, language, prompt: STT_PROMPT}, turn_detection: server_vad(같은 무음 설정)}}`). `append` 는 같은 PCM 을 두 세션에 모두 보낸다. 전사 세션의 `...transcription.delta` 를 `originalDelta`(앱 `original_partial`)로, `completed` 를 `original`(완성본)으로 올린다.
- **실측 결과가 기대와 다름 (아래 표)**: 계획은 "전사 세션은 말하는 도중 조각을 낸다" 였으나, `gpt-4o-transcribe` 는 전사 세션에서도 **턴 확정(speech_stopped→committed) 뒤에야** 조각을 내기 시작한다 — 확정 구간을 전사하면서 글자를 흘리는 것이지 입력을 따라가며 받아쓰는 것이 아니다. 그래도 번역 응답과 분리돼 **첫 조각이 말 끝 0.07–0.40초, 완성본 0.52–0.76초 뒤**에 오고 **4턴 모두 원문**이 있었다 (전: 0.5–1.5초, 4턴 중 2턴 누락). 말하는 도중 자막은 OpenAI 문서의 **`gpt-live-transcribe`**(turn_detection 없이 연속 전사, `delay: low`, `languages` 배열) 가 필요 — 설계 초안: 전사 세션은 VAD 없이 열고, 번역 세션이 `committed` 를 낼 때 서버가 전사 세션에 `input_audio_buffer.commit` 을 보내 1:1 로 짝을 맞춘다(수동 commit 금지는 번역 세션 VAD 얘기). 모델·가격(`DEFAULT_PRICING` 추가)·`STT_PROMPT` 호환(`prompt` 길이 제한)은 사용자 결정 뒤 실제 호출로 확인(탐침 약 $0.01–0.02).
- 번역 세션의 `audio.input.transcription` 은 **끈다**(받아쓰기 2번 청구 방지). 전사 세션을 못 열거나(설정 거부·HTTP 오류·시간 초과) 통화 중 끊기면 번역 세션 설정을 전사가 켜진 채로 다시 보내 **예전 동작으로 되돌아간다**(로그 "번역 세션 전사로 대체").
- **턴 짝짓기 규칙**: 턴 id 는 엔진이 만든 uuid. 두 세션은 같은 음성·같은 VAD 설정이라 같은 자리에서 말 끝을 낸다고 가정하고, 어느 세션이든 새 `item_id` 가 처음 보이면 "상대 세션 항목이 아직 안 붙은 가장 오래된 턴"에 붙이고 없으면 새 턴을 만든다(FIFO). 전사 세션의 `speech_started`/조각이 먼저 턴을 만들고, 번역 세션의 `committed` 가 거기 붙는 것이 보통 순서. 완성본 `original` 은 번역 턴이 시작된(`response.created`) 뒤에만 올린다(듣는 사람 앱은 `stream:out:start` 뒤의 자막만 받으므로). 기록(`persistTurn`)의 원문은 전사 세션 완성본.
  - **실패 모드**: 한 세션만 말을 둘로 나누면(VAD 판단이 다르면) 그 뒤 턴들의 원문이 하나씩 밀린다. 완화: 번역 턴이 없는 전사 턴은 완성 뒤 `ORIGINAL_WAIT_MS`(4초) 안에 짝이 안 생기면 버리고(로그 "전사만 있고 번역 턴이 없어 버림"), 전사가 없는 번역 턴은 응답 뒤 4초만 기다렸다 원문 없이 끝낸다(기존 규칙). 밀림이 실제로 보이면 `STREAM_DEBUG=1` 로 두 세션의 `committed` 시각을 대조한다.
- 비용: 전사 completed 의 `usage`(tokens 형, 없으면 duration·초 추정)를 BudgetGuard 에 kind `stt` 로 기록(예약은 번역 턴 확정 때 잡고, 완성본이 먼저 와도 예약 뒤에 기록). 번역 턴이 끝내 안 생긴 전사는 기록하지 않는다(소액 누락).
- **엔진 이벤트 추적 `STREAM_DEBUG=1`**: 두 세션의 조각(delta) 아닌 모든 이벤트 + 턴마다 첫 전사 조각(`... (first)`)을 세션 종류(`session: conversation|transcription`)와 함께 info 로 남긴다("스트리밍 엔진 이벤트"). 기본 꺼짐, 비용 0.
- OpenAI 문서 대조(2026-10-19): 공식 "Realtime transcription" 안내 페이지는 새 모델 `gpt-live-transcribe`(turn_detection 없이 연속 전사, `delay`·`keywords`·`languages` 필드) 중심으로 바뀌어 `gpt-4o-transcribe` + `server_vad` 모양은 더 이상 예시에 없다. 이 프로젝트는 번역 턴과 **같은 VAD 경계**가 필요해 `STT_MODEL`(gpt-4o-transcribe) + `server_vad` 를 쓰고 실제 호출로 동작을 확인했다(아래). `gpt-live-transcribe` 는 나중 개선 후보.

**② 폰 재생 신호 메아리 차단 (`streamHub.ts`, 앱 `useStreamingCall.ts`·`playingSignal.ts`)**
- 앱은 이중 오디오 `onPlayback` 이 실제 재생 시작/끝을 알리면 `stream:playing {streamId, playing}` 을 보낸다. "끝" 은 200ms 떨림 제거(턴 사이 짧은 끊김에 끝→시작을 보내지 않음), "시작" 은 바로. 스트림이 닫히면 기다리던 "끝" 은 버린다.
- 서버: 스트림마다 `appPlaying`(null = 한 번도 안 보냄). 앱 신호가 있으면 `playing=true` 동안 + `false` 뒤 꼬리 `echoGuardMs` 동안 조각을 무음으로 바꾸고(기존 기전), 없으면 서버 추정(4-2절)을 쓴다. 둘을 섞지 않는다 — 어긋나면 앱 신호가 이긴다. 버린 수는 둘 다 `echoDropped`.
- 시험: `test/streamingEngine.test.ts` +4 (전사 세션 설정·같은 음성, off 면 예전 그대로, 전사 세션 거부 → 되돌림, 말하는 도중 조각 → 턴 시작 뒤 완성본, 2턴 순서 짝짓기, STREAM_DEBUG 추적), `test/integration/streaming.test.ts` +1 (앱 신호 재생 중 무음 → 끝+꼬리 뒤 통역, 서버 추정과 어긋나도 앱 신호 우선, 남의 스트림 신호 무시; 신호 없는 스트림은 기존 시험이 서버 추정을 확인), 앱 단위 +3 (`e2e/playingSignal.test.mjs`).

**실제 OpenAI 확인 (2026-10-19 밤, `scripts/call-peer.ts` 2개, 관리자 ko ↔ 구성원 vi, 각 2턴, 9초 간격, `STREAM_DEBUG=1`, 비용 $0.039 — stt 4건·translate 4건 기록, DB 누적 $0.186)**

서버 로그의 전사 세션 이벤트 시각 기준 (말 시작 = `input_audio_buffer.speech_started`, 말 끝 = `speech_stopped`; 두 세션의 `committed` 는 같은 시각(≤10ms)에 왔고 짝짓기는 4턴 모두 맞았다):

| 턴 | 방향 | 말 시작→말 끝 | 말 시작→첫 `original_partial` | 말 끝→첫 조각 | 말 끝→완성본 | 원문 | 결과 |
|---|---|---|---|---|---|---|---|
| 1 | vi→ko | 3.41초 | **3.62초** (말 끝 뒤) | 0.21초 | 0.54초 | Tôi hiểu rồi, tôi sẽ bắt đầu ngay. | done |
| 2 | ko→vi | 3.80초 | **4.20초** (말 끝 뒤) | 0.40초 | 0.76초 | 안전모를 쓰고 3층 비계 작업을 시작하세요. | done |
| 3 | vi→ko | 3.14초 | **3.39초** (말 끝 뒤) | 0.25초 | 0.57초 | Tôi hiểu rồi, tôi sẽ bắt đầu ngay. | done |
| 4 | ko→vi | 3.67초 | **3.75초** (말 끝 뒤) | 0.08초 | 0.53초 | 안전모를 쓰고 3층 비계 작업을 시작하시오. | done |

- 핵심 지표(말 시작→첫 조각)가 "말 길이보다 훨씬 짧아야" 한다는 목표는 **달성하지 못했다** — 모델 특성(위). 대신 원문 누락 0건, 말 끝→원문 완성본 0.5–0.8초(번역 첫 조각 0.76–1.45초보다 앞).
- 통역: ko→vi 2턴 모두 비계 → giàn giáo, 안전모 → mũ bảo hộ. 서버 경고·오류 0건. 메아리 차단: 관리자 스트림 `echoDropped: 18`(스크립트는 `stream:playing` 을 안 보내므로 서버 추정), 구성원 0. **폰 재생 신호(②)는 스크립트가 소리를 재생하지 않아 이 확인으로는 검증되지 않았다** — 실기기 시험 항목.

**③ gpt-live-transcribe 로 말하는 도중 자막 (2026-10-20 구현·실제 OpenAI 확인, 브랜치 `feat/live-transcribe`)** — 위 설계 초안을 그대로 구현했다.
- 설정: `STREAM_STT_MODEL`(기본 **`gpt-live-transcribe`**, 전사 전용 세션에만 적용. 발화 단위 STT·전사 세션 실패 시 번역 세션 전사는 그대로 `STT_MODEL`). 단가 `DEFAULT_PRICING["gpt-live-transcribe"]` = **$0.017/분** — 사용량이 duration(초) 형이라 1분 = 1,000 음성 토큰(`durationUsage`)으로 환산해 음성 입력 $17/1M 로 적는다(결과는 정확히 $0.017/분, gpt-4o-transcribe 의 약 2.8배).
- 전사 세션 `session.update`: `{type:"transcription", audio.input:{format pcm 24k, transcription:{model:"gpt-live-transcribe", languages:[원문 언어 ISO 639-1], delay:"low", prompt: STT_PROMPT, keywords: 용어집 원문 용어 ≤50(한 줄·`<>` 없음)}, turn_detection: null}}`. `STREAM_STT_MODEL=gpt-4o-transcribe` 면 예전 server_vad 설정 그대로(회귀 경로).
- 말 끝: 번역 세션이 `input_audio_buffer.committed` 를 내는 순간 서버가 전사 세션에 `input_audio_buffer.commit` 을 **턴당 정확히 1번** 보낸다 → 전사 세션의 `committed`(약 0.3초 뒤) → `completed`. 두 세션 항목이 구조적으로 1:1 이라 FIFO 짝짓기가 어긋날 여지가 거의 없다(FIFO·4초 버림 규칙은 안전장치로 유지). 조각은 말하는 도중 `originalDelta`(앱 `original_partial`)로 — 번역 턴(`turnStart`)이 생기기 전에도 말한 사람에게 간다(`streamHub` 는 턴 없이도 보낸다, 시험으로 확인). 완성본이 뒤바뀌어 와도 `item_id` 로 제 턴에 붙는다.
- 시험 `test/streamingEngine.test.ts` +6 (설정·keywords 필터·말하는 도중 조각 + commit 1번 + duration 비용·여러 턴 순서/뒤바뀐 완성본·gpt-4o-transcribe 회귀·전사 세션 거부 시 STT_MODEL 복귀) → 서버 **239개**.

**실제 OpenAI 확인 (2026-10-20, `call-peer.ts` 2개, 관리자 ko ↔ 구성원 vi, 각 3턴, 9초 간격, `STREAM_DEBUG=1`, 서버 상한 `OPENAI_BUDGET_USD=0.3`) — 비용 $0.075 (stt 6건 $0.0071 + translate 6건 $0.0681, DB 누적 $0.2616)**

서버 로그 기준 (말 시작·말 끝 = 번역 세션 `speech_started`·`speech_stopped`, 첫 조각 = 전사 세션 `...delta (first)`). 합성 음성 길이 ko 3.4초·vi 2.7초:

| 턴 | 방향 | **말 시작→첫 `original_partial`** | 말 길이(VAD) | 말 끝→전사 `committed` | 말 끝→완성본 | 말 끝→`response.done` | 원문 | 결과 |
|---|---|---|---|---|---|---|---|---|
| 1 | ko→vi | **0.70초** (말하는 도중) | 4.02초 | 0.30초 | 0.68초 | 2.48초 | 안전모를 쓰고 삼층 비계 작업을 시작하세요. | done |
| 2 | vi→ko | **0.76초** (말하는 도중) | 3.22초 | 0.30초 | 0.75초 | 1.39초 | Tôi hiểu rồi, tôi sẽ bắt đầu ngay. | done |
| 3 | vi→ko | **0.47초** (말하는 도중) | 3.21초 | 0.30초 | 0.79초 | 1.60초 | Tôi hiểu rồi. Tôi sẽ bắt đầu ngay. | done |
| 4 | ko→vi | **0.59초** (말하는 도중) | 3.51초 | 0.30초 | 0.65초 | 2.09초 | 안전모를 쓰고 삼층 비계 작업을 시작합니다. | done |
| 5 | vi→ko | **0.67초** (말하는 도중) | 3.22초 | 0.30초 | 0.84초 | 1.67초 | Tôi hiểu rồi. Tôi sẽ bắt đầu ngay. | done |
| 6 | ko→vi | **0.50초** (말하는 도중) | 2.71초 | 0.30초 | 0.76초 | 2.10초 | 안전모를 쓰고 삼층 비계 작업 | done |

- **핵심 지표 달성**: 말 시작→첫 원문 조각 0.47–0.76초 (말 길이 2.7–4.0초보다 훨씬 짧음, 말하는 도중). 전 단계(gpt-4o-transcribe)는 3.4–4.2초(말 끝 뒤)였다. 말 끝→완성본 0.65–0.84초(전 0.52–0.76초와 비슷).
- 6턴 모두 done·원문 있음·짝 모두 맞음(커밋 1번씩, 뒤바뀜 없음). ko→vi 3턴 모두 비계 → giàn giáo, 안전모 → mũ bảo hộ. 서버 경고·오류 0건(`commit_empty` 없음).
- 6턴 원문 "안전모를 쓰고 삼층 비계 작업" 이 잘림: 두 스크립트가 거의 동시에 말해 관리자 스트림 조각 40개가 메아리 차단으로 무음이 됐다(`echoDropped: 40`, VAD 말 길이도 2.71초로 짧음) — 반이중 한계이지 전사 세션 문제가 아니다(번역은 온전함).
- 비용: 말한 1분당 stt 약 $0.017 추가(턴당 약 $0.0011, 번역 턴당 $0.007–0.015 에 비하면 작음).

### 4-4. 글자 기반 통역 — 자막과 통역을 같은 글자로 (2026-10-28 설계·구현·실제 OpenAI 비교 → 기본값으로 쓰지 않음)

**문제 (2026-10-27 사용자, 시드니 리허설)**: 빠르게 말하면 말한 사람 화면의 받아쓰기와 상대가 듣는 통역이 서로 달라 헷갈린다.
원인은 구조다. 화면 자막은 전사 세션(`gpt-live-transcribe`)이, 통역은 번역 세션(`gpt-realtime-2.1`)이 **같은 음성을 따로 듣고** 만든다.
두 모델이 다르게 알아들으면 자막과 통역이 다르고, 말 사이 쉼이 짧으면 문장이 뭉치거나 짝이 어긋나 "원문에 말이 없어 번역을 버림"(리허설 57건)이 생긴다.

**조사 (2026-10-28, 출처는 아래)**
- Azure·Google·Deepgram 실시간 API 는 모두 임시 결과(바뀔 수 있음)와 확정 결과를 나누고, 확정 원문과 그 번역을 한 묶음으로 준다. 두 모델이 따로 듣고 순서로 짝짓는 구조는 이 원칙에서 벗어난다.
- `gpt-realtime-translate` 는 지금도 지시문·용어집 불가, 우즈베크어 출력 불가 (공식 문서) → 계속 쓰지 않는다 (사용자: "용어집 못 넣으면 안 된다").
- Realtime `response.create` 는 대화 항목 대신 **글자 항목을 직접** 넣을 수 있다 (`response.input` 의 message/input_text, `conversation: "none"`).
- 고정 간격으로 음성을 자르는 방식은 쓰지 않는다: 한국어는 명령·금지·시제가 문장 끝에 있어(“…하지 마세요”) 앞 조각만 먼저 통역되면 뜻이 뒤집히고, 이미 나간 통역 음성은 고칠 수 없다.

**설계 (`STREAM_TRANSLATE_FROM=text`, 기본 `audio` = 지금 방식 그대로)**
1. 번역 세션은 말 끝 감지(server_vad)만 한다. 말 끝 항목(음성)은 응답에 쓰지 않고 바로 지운다 → 통역 모델은 음성을 듣지 않는다.
2. 전사 세션 항목 1개 = 턴 1개. 서버가 전사 세션에 commit 을 보낸 자리(말 끝·아래 3)가 턴 경계다. 두 세션 항목을 순서로 짝짓지 않는다.
3. **긴 말 나누기 (`STREAM_SEGMENT_AFTER_MS`, 기본 4000, 0=끔)**: 한 턴이 이 길이를 넘으면 그보다 짧은 쉼(`STREAM_SEGMENT_PAUSE_MS`, 기본 200ms)에서도 전사 세션만 commit 해 턴을 나눈다.
   쉼은 서버가 받은 음성의 크기로 판단한다(음성과 같은 시점이라 받아쓰기 지연과 무관, 단어 중간에서 자르지 않음). 번역 세션 VAD 는 건드리지 않는다(수동 commit 금지 규칙 유지).
   → 빠르게 이어 말해도 첫 부분 통역이 말이 다 끝나기 전에 나간다.
4. 통역 요청 = 그 턴의 **확정 원문 글자**만 넣은 `response.create` (`input: [message/input_text]`, `conversation: "none"`, 지시문·용어집은 그대로).
5. **예측 시작 (`STREAM_SPECULATIVE=on`, 기본 on)**: 턴 경계에서 그때까지의 임시 자막으로 바로 요청하고, 통역 음성·자막은 붙잡아 둔다.
   확정 원문이 오면 비교(공백·문장부호·대소문자 무시): 같으면 내보내고, 다르면 그 응답을 취소하고 확정 원문으로 다시 요청한다.
   → 확정을 기다리는 시간(실측 말 끝 → 완성본 0.65–0.84초)과 통역 생성 시간이 겹친다. 어느 경우든 내보내는 통역은 화면에 고정되는 원문과 같은 글자에서 나온다.
6. 확정 원문이 비거나 군소리뿐이면 통역 없이 조용히 버린다(자막도 통역도 없음). 확정 원문이 끝내 안 오면(전사 실패·세션 끊김) 임시 자막을 원문으로 확정해 같은 글자로 통역·표시한다.
7. 전사 세션이 없거나 `gpt-live-transcribe` 가 아니면 지금 방식(음성 통역)으로 동작한다.

**앱**: 말한 사람 화면의 임시 자막은 흐린 글자, 확정 원문은 진한 글자로 구분한다 (`CallParts.tsx` MyCaptions). 듣는 사람 화면은 지금처럼 확정 원문 + 통역만 받는다.

**예상 지연 (실측 전 추정, 폰 기준 시드니)**: 예측이 맞은 턴 약 1.9–2.1초(지금과 비슷), 틀린 턴 약 2.6–2.8초. 긴 말은 첫 부분 통역이 말이 끝나기 전에 시작된다.
**확인할 것 (실제 OpenAI, 승인 후)**: 지금 방식 대비 지연(P50·P90), 예측 적중률, 나눈 턴의 정확도, 응답 사용량(음성 입력 토큰이 0 이 되는지).
**구현·검증 (2026-10-28, 비용 0)**: `realtimeStream.ts`(text 턴·예측 시작·다시 요청·긴 말 나누기·전사 세션 끊김 시 정리), 설정 `STREAM_TRANSLATE_FROM`·`STREAM_SPECULATIVE`·`STREAM_SEGMENT_AFTER_MS`·`STREAM_SEGMENT_PAUSE_MS`(`env.ts`·`.env.example`·`deploy/render-env.sh`), 앱 임시 자막 흐리게(`CallParts.tsx`).
엔진 시험 +10 (글자만 넣은 요청·예측 적중·빗나감 2가지·말 없음·전사 실패·확정 지연·긴 말 나누기·전사 모델이 live 가 아닐 때) → 서버 **286**, 앱 단위 64, 데모 e2e 115 통과.
실제 OpenAI 비교 스크립트 `server/scripts/stream-compare.ts` (지금 방식 vs 글자 방식, 보통 6문장 + 빠르게 이어 말하기 3문장, 약 $0.22·상한 $0.6) — 10-28 실행(사용자 승인, 상한 $0.6).

**실제 OpenAI 비교 결과 (2026-10-28 새벽, `stream-compare.ts`, ko→vi, macOS 합성 음성 Yuna, 비용 $0.154, 이 Mac DB 누적 $0.416)**

| 장면 | 지금 방식 (audio) | 글자 방식 (text) |
|---|---|---|
| 보통 6문장: 말 끝 → 첫 통역 음성 | P50 1.70초 · P90 1.89초 | P50 2.09초 · P90 4.49초 |
| 빠르게 이어 말한 3문장: 첫 문장 끝 → 첫 통역 음성 | 8.70초 (세 문장이 한 턴으로 뭉침) | **3.22초** (2턴으로 나눔) |
| 비용 (보통 6문장) | $0.049 | $0.038 |

- **자막이 틀리면 글자 방식은 통역도 틀린다** (사용자 관찰 "번역은 잘 되는데 자막이 문제" 와 같은 결과):
  - "점심 먹으러 가자" → 글자 방식 실행의 자막 "정신 뭐브라우가자" → 통역 "Tập trung, đi làm việc đó"(집중해, 그 일 하러 가) — 뜻이 틀림. 지금 방식 실행에서는 자막·통역 모두 맞음(받아쓰기가 실행마다 다름)
  - "비 문" → 자막 "A비문"·"E비문". 지금 방식 통역은 음성을 직접 들어 "cửa B"(B문, 맞음), 글자 방식 통역은 자막을 따라 "cổng E"(틀림)
  - "비계" → 두 방식 모두 자막 "기계", 통역도 둘 다 "trên máy"(기계 위) — 음성 통역도 틀린 경우
- 글자 방식은 예측 빗나감이 없어도 보통 문장에서 중앙값 약 0.4초 느렸다 (예측 요청이 전사 세션 commit 응답 뒤에 나가고, 글자 응답 생성 시간)
- **결론 (2026-10-28)**: 받아쓰기 정확도가 통역보다 낮은 지금은 글자 방식을 기본으로 쓰지 않는다 (`STREAM_TRANSLATE_FROM=audio` 유지, 코드는 스위치로 남김). 빠르게 이어 말할 때 나누기 효과(첫 통역 약 5.5초 빨라짐)는 확인됐으므로, 받아쓰기 정확도를 올린 뒤 다시 검토한다. 다음 과제는 **화면 자막 자체의 정확도·표시 방식**이다

출처: [OpenAI realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations.md), [OpenAI realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription.md), [gpt-realtime-translate 안내](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide), [Azure ResultReason](https://learn.microsoft.com/en-us/dotnet/api/microsoft.cognitiveservices.speech.resultreason?view=azure-dotnet), [Google Media Translation](https://docs.cloud.google.com/php/docs/reference/cloud-media-translation/latest/V1beta1.StreamingTranslateSpeechConfig), [Deepgram interim results](https://developers.deepgram.com/docs/using-interim-results), [Re-translation strategies (Arivazhagan 2020)](https://arxiv.org/pdf/1912.03393)

### 4-5. 확정 자막 — 화면 원문을 정확한 받아쓰기로 (2026-10-28 설계·구현·실제 OpenAI 확인, 보완 모드 권장)

**배경**: 4-4절 비교에서 통역(음성을 직접 들음)은 맞는데 화면 자막(gpt-live-transcribe, 말하는 도중 자막용 속도 우선 모델)이 틀리는 경우가 확인됐다 ("비 문"→"E비문", "점심 먹으러 가자"→"정신 뭐브라우가자"). 사용자: "번역 자체는 잘 되는데 실시간 자막이 문제".

**설계 (`STREAM_FINAL_STT=on`, 기본 off = 지금 그대로)**
1. 말하는 도중 자막은 그대로 gpt-live-transcribe (말한 사람 화면에 흐린 글자, 4-4절 앱 변경).
2. 번역 세션 VAD 가 말 끝을 내면, 그 턴 음성 구간(`speech_started.audio_start_ms` − 300ms ~ `speech_stopped.audio_end_ms` + 150ms)을 서버가 받은 음성(최근 60초 보관)에서 잘라
   **문장 단위 방식과 같은 받아쓰기**(`OpenAiStt`, `STT_MODEL`=gpt-4o-transcribe, 같은 `STT_PROMPT`, 용어 힌트 없음 — 10-14 결정)로 받아쓴다.
3. 그 결과를 원문으로 화면(말한 사람·듣는 사람)과 기록·다음 턴 문맥에 쓴다. 번역 세션 항목에 바로 붙으므로 순서 짝짓기가 없다.
4. 받아쓰기가 실패·말 없음·3초(`finalSttWaitMs`) 초과면 전사 세션 완성본을 그대로 쓴다. 늦게 온 결과는 쓰지 않는다.
5. 통역은 바뀌지 않는다 (음성을 직접 듣는다). 말 있음 판정(군소리 턴 버리기)도 그대로 전사 세션 완성본으로 한다.

**지연 예상**: 화면 원문 확정이 말 끝 뒤 약 1초 안팎(받아쓰기 요청 시간)으로, 지금(약 0.7초)보다 조금 늦다. 그동안은 흐린 임시 자막이 보인다. 첫 통역 음성(약 1.7초)과 턴 끝은 거의 늦어지지 않을 것으로 본다.
**비용**: gpt-4o-transcribe 말한 1분당 약 $0.006 추가 (통역 1분당 약 $0.18 의 약 3%).

**구현·검증 (비용 0)**: `realtimeStream.ts`(받은 음성 보관·턴 음성 잘라 받아쓰기·원문 올리기를 확정 자막까지 기다림·턴 끝도 기다림·실패/시간 초과 대체), 설정 `STREAM_FINAL_STT`(`env.ts`·`.env.example`·`deploy/render-env.sh`), `bootstrap.ts`(OpenAiStt 를 엔진에 넘김).
엔진 시험 +5 (잘라 낸 구간 길이·언어·프롬프트, 완성본/확정 자막 도착 순서 두 가지, 실패·말 없음 대체, 시간 초과·늦은 결과 무시, 끔이면 예전 그대로) → 서버 **291** 통과.
실측 스크립트 `server/scripts/stream-subtitle.ts`: 현장 용어 10문장 × 2회를 말해 턴마다 지금 자막·확정 자막을 정답과 비교(글자 오류율)하고, 문장 끝 → 화면 원문 확정 시각을 잰다 (약 $0.20, 상한 $0.4) — 10-28 실행(사용자 승인, 상한 $0.4).

**실제 OpenAI 결과 (2026-10-28 새벽, ko→vi, 합성 음성 Yuna, 10문장 × 2회, 비용 $0.211, 이 Mac DB 누적 $0.627)**

| 항목 | 지금 자막 (gpt-live-transcribe 완성본) | 확정 자막 (gpt-4o-transcribe) |
|---|---|---|
| 글자 오류율 평균 | 25.3% | 2.9% |
| 비어 있던 턴 | **5/20** (공구리·지게차·아시바·점심 등) | 0/20 |
| 내용이 틀린 턴 | 0 (숫자·띄어쓰기 표기 차이만) | **"비계"→"기계" 2/2**, "거세요"→"끼우세요/꺼세요" |
| 문장 끝 → 화면 원문 확정 | 약 0.7–0.8초 (4-3절 실측) | P50 1.89초 · P90 2.51초 |

- 지금 자막은 **비는 턴**이 문제(25%), 확정 자막은 **현장 용어**가 약하다(용어 키워드가 없어 "비계"를 "기계"로 — 지금 자막은 keywords 덕분에 "비계" 맞음).
- 둘을 합치면(지금 자막에 말이 있으면 그것, 비었을 때만 확정 자막) 이 표본 기준 오류율 약 0.3%, 20턴 모두 원문 있음. 대부분 턴은 지금 속도 그대로.
- **보완 모드 `STREAM_FINAL_STT_MODE=fallback` (기본) 추가**: 전사 세션 완성본에 말이 있으면 바로 그것을 올리고 턴도 기다리지 않는다. 비었을 때만 확정 자막을 기다렸다 채운다. `replace` 는 언제나 확정 자막. 엔진 시험 +2 → 서버 **293** 통과.
- 권장: 시연 전에 `STREAM_FINAL_STT=on`(fallback)을 실기기로 확인한 뒤 켠다. 남은 약점: 지금 자막이 내용은 있는데 틀린 경우("E비문", "정신 뭐브라우가자" — 4-4절)는 보완 모드로 고쳐지지 않는다

### 5-1. S2 구현 결과 (2026-10-14, 실제 OpenAI 확인 완료)

| 파일 (`frontend/src/`) | 내용 |
|---|---|
| `audio/duplex/` | `DuplexAudio` 인터페이스(`types.ts`) + 웹 구현(`web.ts`: getUserMedia 에코 제거 → 16kHz AudioContext → AudioWorklet 100ms PCM16 조각 / 재생은 별도 AudioContext 에 턴별 이어 붙이기, 지터 버퍼 120ms). `index.ts` 는 웹이면 웹 구현, iOS·Android 는 **S3 전까지 null → 발화 단위 방식** |
| `audio/useStreamingCall.ts` | 스트림 열기 → 단말 VAD 게이트(`vad.ts` 재사용, 사전 버퍼 0.4초, 말 멎은 뒤 0.6초까지 보내고 `stream:pause`) → 상대 조각 재생·자막. `stream:open` 실패(UNSUPPORTED·BUSY·키 없음 등)·마이크 실패·`stream:fallback` 이면 `mode = "utterance"` (그 통화 동안 유지) |
| `audio/streamed.ts` | **중복 재생 방지(필수)**: `stream:out:end` 의 messageId 를 기억 → `RealtimeBridge` 가 같은 id 의 `message:new` 를 재생하지 않음(기록 목록에는 표시). 웹에서는 `window.__syncrewPlayback` 에 재생·건너뜀 기록 (e2e 검사용) |
| `app/site/call/[id].tsx` | 통역 방식 표시(실시간 통역 / 같은 언어 직접 전달 / 문장 단위), 상대 말 실시간 자막(번역 + 원문, 실패 표시), 폴백 안내 토스트. 스트리밍 중에는 `useHandsFree` 를 끈다 |
| `services/*` | `RealtimeService.openStream·sendStreamAudio(volatile)·pauseStream·closeStream`. **mock(데모) 모드는 UNSUPPORTED** → 데모는 지금처럼 발화 단위 (스트리밍 흉내 안 냄) |
| `config.ts` | `EXPO_PUBLIC_STREAMING=off` 면 앱이 스트리밍을 시도하지 않음 |

- 서버 수정: **턴 기록 알림(`message:new`)이 `stream:out:end` 보다 먼저 나가던 버그** — e2e 의 중복 재생 검사가 잡음. `persistTurn` 은 저장만 하고 알림은 허브가 end 다음에 보내도록 고침 + 순서 서버 테스트 추가.
- 검증 (모두 `ENGINE=fake` 서버, 비용 0): 서버 **182개**, 앱 타입 검사·단위 17, 데모 e2e 75(회귀), 마이크 e2e 2(회귀), **live e2e 35** (2회 연속 통과: 양쪽 스트리밍 방식 표시, 실제 가짜 마이크 음성 → 상대에게 번역 도착, 실시간 자막, 스트림 재생 1턴·조각 21개, **기록 알림 재생 건너뜀·중복 재생 0**, 대조군: 일괄 지시 발화는 재생 대기열에 들어감), **폴백 e2e 33** (서버 `STREAMING=off` → 양쪽 "문장 단위 통역"으로 통화, 스트림 조각 0·기록 알림 재생), Android 번들 빌드.
- **실제 OpenAI 확인 (2026-10-14, 사용자 승인, 2회 총 $0.0253)**: `E2E_ONLY_CALL=1 E2E_REAL=1` (서버 `OPENAI_BUDGET_USD=0.35`, 실행 상한 약 $0.115)
  - 1회차 ($0.0112): 앱까지 스트리밍 통화 동작(20/20), 중복 재생 0. 그러나 **턴마다 조각 8개(약 0.8초)가 서버에 도착하지 않아 말 앞부분이 빠짐** ("안전모를 착용하고"가 빠진 번역) → 원인: 앱이 `socket.volatile.emit` 으로 보내 소켓이 바쁠 때 조각을 버림(말 시작 순간 사전 버퍼를 한꺼번에 보낼 때). **일반 emit 으로 수정** (`services/live/socketRealtime.ts`)
  - 2회차 ($0.0141): 빠진 조각 0, 문장 전체 통역. vi "Được rồi, tôi sẽ bắt đầu ngay." → ko "알겠습니다. 바로 시작하겠습니다." / ko → vi "Hãy đội mũ bảo hộ và bắt đầu làm việc." (정확). 원문 전사는 "**단물을** 착용하고…"로 틀림(번역은 맞음 — S0와 같은 현상, 용어 보정 데이터에 없는 오인식)
  - 응답 시작 → 첫 번역 음성(`timings.firstAudioMs`, 말 끝 기준 아님): 564–1242ms. 말 끝 기준 지연은 실기기에서 S6에 측정
  - 서버 경고 1건: 단말 `stream:pause` 의 commit 이 이미 비워진 버퍼에 들어가 `input_audio_buffer_commit_empty` (무해, 기록만 남음)
  - 서버 한도 누적 $0.2602 / $3
- 남은 미검증: 실제 귀로 듣는 소리 품질·말 끝 기준 지연(실기기 S6), 같은 언어 직접 전달의 앱 쪽 e2e(서버 테스트만), iOS·Android(S3).
- `expo-doctor`: 패치 버전 4개 뒤처짐(expo 57.0.27→.28, expo-crypto, expo-router, expo-splash-screen) — 이번 변경과 무관(패키지 변경 없음), 업데이트는 별도로.
- 실제 OpenAI 확인 방법: `cd server && OPENAI_BUDGET_USD=0.35 npm run dev` (이번 실행 상한 약 $0.115) → `cd frontend && npm run bundle:web:live && E2E_ONLY_CALL=1 npm run e2e:live` → 통화 턴의 `timings.firstAudioMs`·비용 확인. 예상 2–4턴 약 $0.02–0.05.

### 5-2. 실기기 없이 마무리한 것 (2026-10-14, `docs/implementation-plan.md` "실기기 없이 마무리" 절)

- **같은 언어 통화 앱 쪽 e2e**: live e2e 5-1절 — 관리자가 구성원의 현장 언어를 한국어로 바꿔 통화 → 양쪽 "같은 언어 · 음성 그대로 전달" 표시, 구성원이 음성 조각을 받음(11개), 기록 메시지 없음 → 언어 원래대로. 통과
- **서버 노이즈 필터(조각 단위) 연결**: `server/src/engine/audio/streamAudioFilter.ts`(인터페이스 + 안전 실행기), `server/src/plugins/streamAudioFilter.ts`(등록), `.env` `STREAM_AUDIO_FILTER`(기본 passthrough). 스트림마다 세션 1개, 100ms 조각(16kHz 1600표본)을 같은 길이로 돌려줌, 조각당 50ms 제한·오류·잘못된 출력이면 원본, 연속 5번 실패하면 그 통화에서 끔, 순서 유지, `stream:pause` 도 같은 순서로. 통역·같은 언어 전달 모두 적용. **실제 딥러닝 필터는 아직 없음(담당 개발자)**
- **원문 기록 품질 (받아쓰기)**: 측정 `server/scripts/stt-hint-compare.ts` (9문장, 합성 음성)
  - 현장 용어 힌트(`server/src/engine/domain/transcriptionHints.ts`, 검증 문장 빈도순 120개): gpt-4o-mini-transcribe 에서 거의 변화 없음, gpt-4o-transcribe 에서는 오히려 오류 증가("이번 프레스", "보호세시", "下楼") → **쓰지 않음**
  - 받아쓰기 모델: gpt-4o-transcribe(기본 안내만)가 mini 보다 정확 — "거푸집·오후 3시·아시바·데스라·2번·3楼" 맞음 (mini: "커푸직/오호세시", "다시 봐", "拆楼") → **STT_MODEL 을 gpt-4o-transcribe 로 변경** (발화 단위 STT 와 스트리밍 원문 받아쓰기 모두. 실시간 세션이 이 모델을 받는 것 확인). 비용 약 $0.006/분 (mini 의 2배, 문장당 약 $0.0002 증가)
  - 여전히 틀림: "비계 → 기계"(두 모델 모두), "B문 → 뒤문/비문" — 합성 음성 발음 탓일 수 있어 **실제 사람 목소리로 다시 확인 필요**
  - 데이터 한계: 지금 샘플 데이터(제조업 위주)는 용어가 한국어만 있고 번역은 베트남어만, "거푸집·안전모·안전고리"가 검증 문장에 없다 → 데이터 교체 때 보강
  - 단가 수정: gpt-4o-mini-transcribe 음성 입력 $1.25 → $3 /1M (이전 기록은 약 2.4배 적게 잡힘), gpt-4o-transcribe 추가 (가격 정리 사이트 기준, OpenAI 가격표로 재확인 권장)
  - 비용: 측정 $0.0221 (mini $0.0066 + 4o $0.0155), 누적 $0.3371

### 5-3. S3 네이티브 오디오 구현 결과 (2026-10-15 새벽, 실기기 없이 — 사용자 지시 "실기기 확인 없이 최대한 꼼꼼히 구현")

**D2 결정 변경: 라이브러리(react-native-audio-api 1.0 nightly) 대신 자체 Expo 모듈** (계획의 폴백안을 바로 채택)
- 근거: ① 2026-10-14 실기기에서 **Android 헤드셋 마이크가 무음**(SCO 미시작) — react-native-audio-api 는 Android `setCommunicationDevice`/SCO 를 지원하지 않아(s0-report 2-1) 어차피 자체 네이티브 코드가 필요 ② 에코 제거가 nightly 에만 있어 버전 고정 위험 ③ 필요한 기능이 작고 분명해 직접 구현이 통제하기 쉽다(의존성 0, react-native-worklets 불필요)
- 위치: `frontend/modules/syncrew-duplex/` (Expo 로컬 모듈, 자동 연결. `npx expo-modules-autolinking search` 로 확인)

**구조**
| 부분 | 내용 |
|---|---|
| JS 계약 | `modules/syncrew-duplex/index.ts` — `start(sampleRate, frameMs, echo)`, `stop`, `enqueue(streamId, pcmBase64, rate)`, `endStream`, `stopPlayback`, `enterCallRoute`/`exitCallRoute`, 이벤트 `onFrame{pcm base64, timestamp}`·`onRoute{route,name}`·`onPlayback{streamId,playing}`·`onError`. PCM 은 base64(100ms = 약 4.3KB, 초당 10번) |
| iOS (`ios/SyncrewDuplexModule.swift`) | 세션 `playAndRecord` + `voiceChat` + `allowBluetoothHFP` + `defaultToSpeaker`, 블루투스 HFP·LE > 유선 입력 우선. `AVAudioEngine` 입력 `setVoiceProcessingEnabled(true)`(에코 제거) → `AVAudioConverter` 16kHz mono PCM16 → 100ms 조각. 재생은 같은 엔진의 `AVAudioPlayerNode`(24kHz), 비어 있다가 시작할 때 120ms 무음(지터 버퍼), 다른 표본율은 변환. 경로 변경·엔진 구성 변경·중단·미디어 서비스 재시작 처리 |
| Android (`android/.../DuplexEngine.kt`, `CallRoute.kt`) | `CallRoute`: `MODE_IN_COMMUNICATION` + 통신 장치 선택 (블루투스 SCO·LE > 유선 > 스피커, API 31+ `setCommunicationDevice`, 이하 `startBluetoothSco`/스피커폰), 장치 연결·해제 시 다시 선택. 캡처 `AudioRecord(VOICE_COMMUNICATION, 16kHz)` + `AcousticEchoCanceler`·`NoiseSuppressor`·`AutomaticGainControl`, 재생 `AudioTrack(USAGE_VOICE_COMMUNICATION, 24kHz, MODE_STREAM)` 쓰기 스레드 + 큐, 120ms 무음, 선형 보간 표본율 변환. **직접 버퍼 + 논블로킹 읽기·쓰기(10ms 쉬기)** — 아래 "발견한 문제" |
| JS 어댑터 | `src/audio/duplex/native.ts`(DuplexAudio 구현, 네이티브 이벤트 구독은 앱 전체 1번), `base64.ts`(Hermes atob 의존 없음, 단위 테스트 4), `index.ts`(iOS·Android 면 네이티브, 모듈이 없는 빌드면 null → 문장 단위) |
| 통화 훅 | `useStreamingCall`: 경로(헤드셋·스피커)를 `onDevice` 로 상대에게 알림 (예전엔 unknown 고정) |
| 문장 단위(폴백) | `useHandsFree` 가 Android 에서 `enterCallRoute()` 로 통신 모드 + 헤드셋 SCO 를 연 뒤 녹음 → **2026-10-14 Android 헤드셋 마이크 무음 문제의 해결 시도** (실기기 확인 필요). 장치 표시도 통신 장치 기준 |
| 점검 화면 | `src/app/audio-check.tsx` (개발 빌드 전용, 주소 `syncrew:///audio-check`, `?auto=1` 자동 시작): 경로·마이크 음량·조각 간격, 시험음 2초(재생 중 마이크 최대 = 에코 정도), 3초 녹음 후 다시 듣기. 2초마다 `[audio-check]` 콘솔 요약. `EXPO_PUBLIC_DEV_START_ROUTE="/audio-check?auto=1"` 로 Metro 를 켜면 앱이 바로 이 화면으로 감(화면을 누를 수 없는 시뮬레이터용) |

**확인한 것 (실기기 아님)**
- 빌드: Android(Gradle) 성공, iOS 시뮬레이터(xcodebuild) 성공 — 새 모듈 경고 없음. iOS 실기기용(iphoneos) 빌드는 하지 않음(같은 Swift 코드, 서명만 다름)
- Android 에뮬레이터(Pixel 9 Pro XL, API 35): 모듈 로드·시작, 경로 `speaker`(통신 장치 선택), **녹음 조각 간격 평균 100ms(최대 137ms)**, 시험음 재생 시작·끝 알림, 3초 녹음 → 16k→24k 변환 재생 정상
- Android 에뮬레이터 live 통화: 휴대폰 앱이 **스트리밍 모드로 스트림을 열었다**(서버 "스트리밍 통역 시작 ko→vi") — 휴대폰 앱의 첫 스트리밍 통화
- 회귀: 앱 타입 검사, 단위 22(새 4), 서버 200

**발견하고 고친 문제**
1. Android 캡처·재생 스레드의 블로킹 `read`/`write` — 오디오 장치가 데이터를 주지 않으면 그동안 런타임의 스레드 일시 정지가 끝나지 않아, JS 가 Java 모듈을 부르는 순간 앱 전체가 60초 멈췄다(소켓 ping timeout). 직접 버퍼 + 논블로킹으로 변경 (배열 판 read·write 는 JNI critical 로 GC 를 막기도 한다)
2. Socket.IO 가 인증 단계 거부 뒤 스스로 다시 연결하지 않는 점 → 연결을 원하는 동안 3초 뒤 새 토큰으로 재시도 (`socketRealtime.ts`). (에뮬레이터에서 처음 의심한 "로그인 직후 미연결"은 시험 스크립트가 다른 현장으로 전화를 건 것이 원인이었다 — 이 안전장치는 실제 약점을 막으므로 유지)

**이 PC 환경의 한계 (앱 문제 아님)**
- 이 세션에서 띄운 에뮬레이터·시뮬레이터는 **Mac 마이크 권한 창을 누를 사람이 없어** CoreAudio 입력이 막힌다: iOS 시뮬레이터는 마이크 입력을 처음 열 때 `AURemoteIO::Initialize` RPC timeout 으로 강제 종료, Android 에뮬레이터는 `coreaudio(input): Could not resume the device` 로 입력이 수십 초씩 멈춤 → **에뮬레이터에서 live 통화 중 상대 통역 수신·재생은 끝까지 확인하지 못했다** (입력이 막혀 앱이 멈추는 동안 소켓이 끊김)
- 그 뒤로 헤드리스 Chrome 의 마이크도 막혀 웹 e2e 의 마이크 관련 시험이 실패했다(변경 전 코드로도 동일 → 환경 문제). **2026-10-15 아침 Mac 정리 후 재실행: `e2e:mic` 2/2, 데모 e2e 99/99, live e2e 43/43 모두 통과** — S3 변경으로 웹 회귀 없음

**미검증 (실기기에서 할 것)** — 5절 시나리오 F·G·H, `docs/HANDOFF.md` 7절 절차
- iOS 실제 동작 전부 (voice processing·HFP·경로 변경), Android 실기기 동작 전부
- 에코 루프 없음(스피커), 블루투스 헤드셋 입출력(Android SCO 가 실제로 열리는지, iOS HFP), 끊김·지연 측정
- 문장 단위(폴백)에서 Android 헤드셋 마이크가 이제 소리를 받는지, 그때 통역 재생(expo-audio, media 용도)이 헤드셋으로 나오는지 (통신 모드에서 media 소리가 스피커로 갈 위험)
- 휴대폰 앱이 `stream:out:audio` 이진 조각을 받아 재생하는지 (웹에서만 확인. 10-17 에뮬레이터 확인은 디스크 부족으로 못 함)

**코드 재점검 (2026-10-17, 실기기 없이)**: Swift·Kotlin·JS 어댑터·`useStreamingCall`·`useHandsFree` 를 다시 읽었고 실기기 전에 고칠 결함은 없었다. 실기기에서 눈여겨볼 점: ① Android 블루투스 SCO 가 켜지는 동안(약 0.5–1초) 첫 소리가 휴대폰 마이크로 들어갈 수 있음 ② Android 재생 오류가 계속되면 `onError` 가 20ms 마다 반복(로그 많아짐) ③ iOS 녹음 탭 크기는 iOS 가 정해 첫 조각이 약 100ms 늦을 수 있음 ④ 오디오 포커스를 요청하지 않음(다른 앱 소리와 겹칠 수 있음). **버그 수정 (같은 날)**: 한쪽만 스트리밍하는 통화에서 문장 단위 쪽이 상대 말을 못 듣던 문제 — 서버는 듣는 사람의 방식과 상관없이 `stream:out:*` 를 보내는데, 앱이 폴백 중에도 그 턴을 "스트림으로 들음"으로 표시해 기록 알림 재생까지 건너뛰었다. 이제 **내 스트림이 열려 있을 때만** 스트림 턴을 받는다 (`useStreamingCall`). live e2e `E2E_MIXED=1` 로 확인(수정 전 실패·수정 후 통과). 남은 한계: 같은 언어(직접 전달)는 기록이 없어 혼합 상황에서 문장 단위 쪽이 듣지 못함. 시험 도구: 상대 역할 스크립트 `server/scripts/call-peer.ts` (`docs/operations.md` 6절)

### 5-4. S3 iOS 실기기 결과 (2026-10-17 밤, iPhone 15 Pro Max + AirPods Pro, 커밋 `4fd2d9d`)

- **iOS 오디오 세션·엔진 방침 변경** (`ios/SyncrewDuplexModule.swift`):
  - 세션 샘플레이트 48kHz 고정 (voice processing 을 켜면 입력 48k·출력 44.1k 로 어긋나 iOS 가 설정을 계속 다시 잡았다)
  - **voice processing(에코 제거)은 휴대폰 스피커·유선일 때만** (`shouldUseVoiceProcessing()`). 블루투스 HFP 와 함께 켜면 엔진이 시작 직후 `AVAudioEngineConfigurationChange` 로 멈추고 재구성해도 반복된다. HFP 헤드셋은 되울림 구조가 아니고 자체 처리가 있다고 보고 끈다
  - 경로 변경으로 켜야 할지가 바뀌면 엔진 재구성. 설정 변경으로 멈추면 `recoverEngine()`: 10초 안에 4회 초과 → 그 통화 동안 에코 제거를 끄고 재구성(`onError` `voice_processing_loop`), 8회 초과 → 멈추고 `onError` `restart_loop`
  - DEBUG 진단 로그 `[duplex-diag]` (엔진 생성·복구·탭·변환·재생 예약)
- 확인: 점검 화면 스피커(조각 100ms, 말소리 -15dB, 시험음 중 마이크 -62dB)·에어팟(시험음 중 마이크 -25dB, 에코 제거 없음)·통화 중 전환, **F 스트리밍 통화**(12턴, 첫 조각 약 0.8s = 가짜 엔진 지연)
- **미해결**: ① F 통화에서는 스피커로 시작해도 반복 보호가 걸려 에코 제거 없이 진행(점검 화면에서는 켜짐 — 통화 화면과의 차이를 찾아야 함) ② 통화 도중 에어팟 → 스피커 전환 뒤에도 꺼진 채 남음 ③ `tapFormat`(형식이 그대로면 재구성 대신 재시작만)은 준비만 되고 쓰이지 않음 — ①② 수정 후보
- 미검증: G·H(실제 OpenAI), 에어팟 사용 중 상대 통역이 마이크로 되돌아가는지, 실제 통역 음성 소리, 지연, Android 전부

### 5-5. S3 Android 실기기 결과 (2026-10-23 새벽, Galaxy Note 9 Android 10 + Sony WH-1000XM6, 장태웅, 상세 `docs/device-test-log.md`)

- **통과**: 점검 화면(헤드셋 SCO 열림·스피커·전환), F 스트리밍(헤드셋·스피커·통화 중 전환·종료), C 문장 단위 + 헤드셋 마이크(10-14 S22 무음 해소), 같은 언어 통화, **G 스피커 에코 루프(실제 OpenAI, 되돌아간 턴 0)**, 통역 듣기(스트리밍·문장 단위 × 헤드셋·스피커), **H 통화 중 Wi-Fi 끊김**(재연결 뒤 계속). 실제 OpenAI $0.413
- **수정 6건** (모두 실기기 재시험 통과):
  1. `CallRoute.kt`: Android 11 이하 `startBluetoothSco` 2번·`stop` 1번 → 멈춘 뒤에도 SCO 가 남음 → 요청 여부를 기억해 한 번만
  2. `useHandsFree.ts`: 조용할 때 -160 을 계속 보내는 헤드셋에서 문장 단위 VAD 가 말 끝을 못 봄(세 문장이 16.8초로 묶임) → -160 이 300ms 연속이면 무음
  3. **`streamHub.ts`: `stream:pause` 때 무음 0.7초(`pauseSilenceMs`)를 엔진에 넣는다** — 스트리밍 원문이 한 턴씩 밀려 보인 원인. 진단(`STREAM_DEBUG=1`): 두 세션 짝짓기는 정상이었고, 서버 VAD 가 3초 쉼을 말 끝으로 보지 않아 첫 문장 + 다음 문장 앞부분이 한 턴이 됐다. 단말이 말 끝 뒤 0.6초만 보내고 멈추므로 OpenAI 에는 실제 쉼이 0.6초 꼬리로 줄고, 스피커의 방 잡음이 무음 500ms 를 못 채웠다. 수동 commit 은 여전히 쓰지 않는다(D4)
  4. `CallPlayer.kt` + `playInCall`: 발화 단위 통화의 통역 음성을 **통화 용도(USAGE_VOICE_COMMUNICATION)** 로 재생 — expo-audio 재생기는 미디어 용도 고정이라 블루투스 SCO 중에는 멈춘 A2DP 로 나가 헤드셋에서 안 들렸다. 통화 경로가 없으면(대화방 다시 듣기 등) 예전처럼 expo-audio
  5. `playback.ts`·`useHandsFree.ts`: Android 에서 expo-audio `setAudioModeAsync` 가 부를 때마다 일반 모드 + 스피커폰을 강제해 "통화 소리는 블루투스로" 지정을 지웠다(Android 10 은 앱이 되살릴 수 없음) → Android 에서는 재생 전 호출 안 함, 녹음 설정은 `shouldRouteThroughEarpiece: true`
  6. `CallRoute.kt`: 통신 모드를 늘 다시 지정(이 기기는 실제 NORMAL 인데 `getMode()` 가 IN_COMMUNICATION 을 돌려줌) + 다른 코드가 스피커폰을 켰으면 SCO 재연결
- 관찰: 잘못 말한 첫 마디가 "Xe nâng đang đi qua!"(지게차가 지나갑니다)로 번역 — 스트리밍 지시문의 현장 용어집 영향 추정, 지켜볼 것. 스피커에서 받아쓰기 오류(비계→비에, 오후 세시→문제시), 헤드셋은 정확
- 미검증: Android 12+ 기기(`setCommunicationDevice` 경로), S4 휴대폰 2대, iPhone 에서 이번 JS 변경 영향(Android 분기만이지만 확인 필요)

### 5-6. iOS 에코 제거 꺼짐 수정 (2026-10-23, 현슈, 실기기 없이 — 장태웅 실기기 확인 전, 브랜치 `fix/ios-echo-cancellation`)

5-4절 미해결 ①② 를 고쳤다. 실기기 확인 절차·통과 기준은 `docs/testguide.md` 4-12절.

- **② 경로가 바뀌어도 다시 켜지지 않음 — 원인 확인(코드)**: 반복 보호(`recoverEngine`)가 앱의 요청 값 `echoCancellation` 자체를 false 로 바꿔, `start()` 전까지 `shouldUseVoiceProcessing()` 가 늘 false 였다. → 요청(`echoCancellation`)과 반복 보호(`vpSuppressed`)를 나눴다. 실제 장치 변경(경로 변경 이유 `newDeviceAvailable`·`oldDeviceUnavailable`·`override`)이나 세션 덮어쓰기 복구 뒤에는 `vpSuppressed` 를 풀고 다시 켜 본다. 다시 반복되면 반복 보호가 또 끈다
- **① 통화에서만 꺼짐 — 원인 추정(실기기 로그로 확인할 것)**: expo-audio 의 `setAudioModeAsync` 는 iOS 에서 세션 범주·모드를 통째로 다시 정한다(`node_modules/expo-audio/ios/AudioModule.swift` `setAudioMode`: `{ allowsRecording: false }` → `soloAmbient` + 기본 모드, `{ playsInSilentMode: true }` → `playback`). 통화 화면에는 스트리밍 중에도 `useHandsFree`(꺼진 상태)가 붙어 있어 처음 뜰 때 `{ allowsRecording: false }` 를 부르고, 스트리밍이 못 들은 통화 발화가 오면 `playback.ts` 가 `{ playsInSilentMode: true }` 를 부른다. 이 중 하나가 이중 오디오가 잡은 `playAndRecord` + `voiceChat` 을 덮어쓰면 voice processing 엔진이 멈추고, 같은 세션으로 다시 만들어도 또 멈춰 반복 보호가 걸린다. 점검 화면에는 expo-audio 가 없어 켜져 있었던 것과 맞다
  - 앱(JS): `src/audio/sessionOwner.ts` + `src/audio/audioMode.ts` — 이중 오디오가 `start` 부터 `stop` 이 끝날 때까지 세션을 쥔다고 표시하고, expo-audio 모드 변경은 모두 `setAudioMode()` 로 한다. iOS 에서 쥐고 있는 동안 녹음 끄기·재생용 변경은 건너뛰고, 녹음 켜기(스트리밍 → 문장 단위로 넘어간 직후)는 놓을 때까지(최대 3초) 기다렸다 적용한다. Android 는 그대로 적용(5-5절의 Android 처리 유지)
  - 네이티브(안전장치): 통화 중 세션이 `playAndRecord`/`voiceChat` 이 아니게 되면(경로 변경 이유 `categoryChange`, 또는 엔진 설정 변경 복구 때) 세션을 되돌리고 엔진을 다시 만든다. `onError` `session_overwritten` 을 보내 Metro 에 남는다 → JS 막기가 새는 경로가 있는지 알 수 있다
- 확인용 로그: `onRoute` 에 iOS 는 `voiceProcessing`(지금 엔진에 에코 제거가 켜졌는지)이 함께 오고, 개발 빌드는 Metro 에 `[duplex] route=… voiceProcessing=…` 를 찍는다. 건너뛴 모드 변경은 `[audio-mode] skipped …`
- 시험: 앱 타입 검사, 단위 52 통과(새 `e2e/sessionOwner.test.mjs` 6개), Swift 컴파일(`SyncrewDuplex` 모듈만 기기용 Debug 빌드 성공, 서명 없이 — 앱 전체 빌드·설치는 안 함). **실기기 미확인** — 특히 ① 의 원인이 맞는지는 `session_overwritten`·`[audio-mode] skipped` 로그로 판단한다
- 남은 위험: expo-audio 재생기가 재생을 마치면 `setActive(false)` 를 부른다(`deactivateSession`). 통화 중에 이것이 오면 엔진이 멈출 수 있다 — 반복 보호·복구가 다시 만들지만, 실기기에서 `restart_failed`·`restart_loop` 가 보이면 이 경로를 의심할 것

### 4-6. 되돌린 자막 — 말한 사람에게 "전달된 뜻"을 보여 준다 (2026-10-28 사용자 요청·구현, 가짜 엔진·실제 OpenAI 1:1 확인, 현장 전체 실제 OpenAI·실기기 확인 전)

**배경**: 스트리밍 통역은 음성을 직접 들어 번역하므로 받아쓰기(자막)가 틀려도 통역은 맞는 경우가 많다 ("나라시"→자막 "나란히", 통역은 "평탄화" — `docs/field-accuracy-results-v3.csv` s034). 사용자: 받아쓰기 대신 번역된 외국어를 한국어로 직역해 띄우자.

**설계 (`STREAM_MINE_CAPTION=back`, 기본 `transcript` = 예전 그대로)** — 서버만, 앱 변경 없음 (10-29 듣는 사람 원문 덮어쓰기는 앱 한 줄 변경, 5번)
1. 말하는 도중 자막(`original_partial`)은 받아쓰기 그대로 → 앱이 흐리게 보여 준다.
2. 턴이 끝나면 통역문을 말한 사람 언어로 되돌린다(`context.translator`, 글자만, 용어 없음, 최대 `backTimeoutMs` 4초). 그 글을 말한 사람에게 `stream:mine:text` `original` 로 보낸다 → 앱이 흐린 조각 대신 진하게 표시. 받아쓰기 완성본은 말한 사람에게 보내지 않는다.
3. 기록: 대표 레인 기록의 원문(`rawText`·`correctedText`)을 되돌린 글로 바꾼 뒤 기록 알림을 보낸다. `stream:out:end`(재생·반이중 판단)는 기다리지 않고 바로 보낸다.
4. 실패·시간 초과·비용 한도면 말한 사람 자막·기록은 받아쓰기 그대로.
5. 다음 턴 문맥은 받아쓰기 그대로. **듣는 사람 원문 자막 (2026-10-29 사용자 요청 "듣는 이에게도")**: 받아쓰기 원문(`stream:out:text` `original`)을 먼저 보내고, 되돌린 글이 오면 같은 턴 id 로 `original` 을 한 번 더 보내 덮어쓴다 — 현장 전체는 레인마다 자기 턴 id 에 같은 되돌린 글. 실패면 덮어쓰지 않는다. 1:1 은 보통 턴 끝 전에, 현장 전체의 늦은 레인은 턴 끝 뒤에 온다 → **앱은 턴이 끝난 뒤의 `original` 도 화면에 있는 자막에 반영하도록 고침(`useStreamingCall`, 출시용 빌드 다시 설치 필요)**. 고치기 전 앱은 턴 끝 뒤의 것만 무시한다(받아쓰기 그대로).
6. **현장 전체 연결: 먼저 통역이 끝난 언어 기준.** 언어마다 엔진이 따로 말을 끊으므로, 턴마다 입력 구간(서버가 받은 위치)을 적고 **서로 절반 이상 겹치는 턴을 같은 말**로 본다. 같은 말 중 먼저 끝난 통역을 되돌려 대표 레인 턴(흐린 조각과 같은 줄)에 붙인다. 짝이 없으면 대표 레인이 자기 통역으로 채운다. 대표가 아닌 레인의 기록 원문은 이미 채워졌으면 되돌린 글, 아니면 받아쓰기(기다리지 않음).
7. 일괄 지시(발화 단위)는 해당 없음 — 받아쓰기 글로 번역하므로 받아쓰기 오류를 고치지 못하고, 보여 줄 자리를 만들려면 앱 변경이 필요해 시연 뒤로 미룸.

**연결 미리 열기**: 번역기(`RealtimeTranslator`)는 호출마다 새 WebSocket 을 여는데, 연결 맺기만 약 1.1–1.2초였다(10-28 실측, 추론 low·minimal 차이 거의 없음). 그래서 대표 레인 턴이 시작될 때(말 끝, 통역 시작) `translator.warm()` 으로 연결을 미리 열어 둔다(최대 2개, 2분 유지, 연결만으로는 과금 없음).
**실제 OpenAI 1:1 (10-28, 이 PC 서버, 합성 음성 "공구리 치기 전에 나라시 싹 해 놔." 6번, $0.096)**: 통역 "San phẳng hết trước khi đổ bê tông." → 되돌린 자막 "콘크리트 타설 전에 전부 평탄하게 정리해." 등 6/6 뜻 맞음(은어 → 표준어). 말 끝 → 되돌린 자막: 미리 열기 전 4.7–5.6초 → **미리 연 뒤 3.8–4.4초** (턴 끝 뒤 1.3–1.8초). 통역 음성 첫 조각은 약 0.9–1.3초 그대로. 합성 음성이라 이번 받아쓰기는 맞았다(받아쓰기가 틀리는 사람 목소리에서의 효과는 실기기에서).
**더 줄이려면 (시연 뒤)**: 턴 끝(통역 음성 생성 끝)이 아니라 통역 글이 완성되는 시점에 되돌리기 시작 — 스트리밍 엔진에 이벤트 추가 필요.
**비용**: 턴마다 글자 번역 1번 추가 (매우 작음).
**시험**: 서버 5개 추가 (1:1 되돌린 자막·기록, 실패 시 받아쓰기, 현장 전체에서 먼저 끝난 언어 vi·zh 각각, 번역기 연결 미리 열기 재사용) — 서버 298 통과. 10-29 듣는 사람 원문: 같은 시험들에 듣는 사람 확인 추가(1:1 덮어쓰기·실패면 받아쓰기 하나·현장 전체 두 언어 모두 같은 되돌린 글) — 서버 298·앱 단위 69 통과, 실기기 전.
**켜기 (시드니)**: 확정 자막과 함께 `STREAM_FINAL_STT=on STREAM_FINAL_STT_MODE=fallback STREAM_MINE_CAPTION=back ./render-env.sh openai` → `docker compose up -d server` (render-env 는 `.env` 를 새로 쓰므로 켜 둔 값을 모두 다시 넣는다). 끄기는 그 변수 없이 다시. **10-29 시드니에서 켬** (조현수).

## 5. 앱 설계

- `frontend/src/audio/duplex/`: `DuplexAudio` 인터페이스 + 구현 3개 (네이티브 라이브러리 어댑터 또는 자체 모듈, 웹 `AudioWorklet` 캡처 + Web Audio 재생). 웹 구현은 제품용이 아니라 **헤드리스 Chrome 자동 검증용**이다 (가짜 마이크 음성 파일로 전체 경로 확인 — 이번 Phase 6에서 쓴 방식).
- `useStreamingCall` 훅: `useHandsFree`와 같은 화면 상태(듣는 중·말하는 중·통역 재생 중·마이크 꺼짐)를 내되, 녹음 파일 대신 프레임을 게이트해서 `stream:audio`로 보낸다. 실패 시 `useHandsFree`로 전환.
- 재생: 턴별 순서 보장 큐 + 100–200ms 지터 버퍼. 조각이 늦으면 버퍼를 늘리고, 끊김 횟수를 기록.
- 에코·전이중: 블루투스·유선 헤드셋이면 마이크를 계속 연다(전이중). **휴대폰 스피커면** 하드웨어 에코 제거를 켜되, 기준을 못 넘으면(S6) 지금처럼 재생 중 마이크 일시 정지로 되돌린다.
- 화면: 통화·지시 화면에 상대 말의 **실시간 자막**(원문·번역 진행 중 표시), 연결 품질 표시(지연·끊김), 폴백 안내.
- 권한·설정: iOS `NSMicrophoneUsageDescription`(있음), 블루투스 사용 문구, Android `RECORD_AUDIO`·`MODIFY_AUDIO_SETTINGS`·(Android 12+) `BLUETOOTH_CONNECT`. Expo config plugin으로 넣는다.
- 백그라운드(화면 꺼짐) 유지는 이 계획 범위 밖 (별도 과제: iOS 백그라운드 오디오, Android 포그라운드 서비스). 화면 꺼짐 방지는 지금처럼.

### 5-7. iPhone 실기기 확인: PR #12 뒤에도 스피커에서 에코 제거가 꺼짐 — 원인·시도·다음 (2026-10-24, 장태웅 iPhone 17 Pro, 현슈에게 전달)

**결과 요약** (`docs/device-test-log.md` 10-24 행, 절차 `docs/testguide.md` 4-12절)
- ✅ PR #12 수정 ②: 경로가 바뀌면(에어팟 → 스피커) 에코 제거를 다시 켬 / ✅ 통화 중 expo-audio 덮어쓰기 막음(`[audio-mode] skipped … playsInSilentMode` 1번, `session_overwritten` 0번)
- ❌ **스피커에서 에코 제거가 2–4초 안에 꺼짐** (통화 시작·에어팟 → 스피커 전환 모두, 점검 화면에서도 1번). PR #12 의 원인(세션 덮어쓰기)과 **다른 원인**
- ✅ **그래도 G(스피커 에코 루프, 실제 OpenAI) 통과**: 에코 제거가 꺼진 채로 되돌아간 턴 0 — 서버 반이중 차단(4-2절)이 통역 재생 중 조각 128개를 무음 처리. → **10/30 시연에 지장 없음**. 한계: 상대 통역이 나오는 동안 끼어든 말은 전달되지 않음. 시연은 에어팟·헤드셋이면 이 문제 자체가 없다

**원인 (`[duplex-diag]`, `xcrun devicectl device process launch --console …` 로 무선 수집)**
```
session sampleRate=48000.0 ioBuffer=0.02 route=speaker
buildEngine inFormat=1 ch, 48000 Hz … vp=true
engine started isRunning=false … outHw=2 ch, 44100 Hz      ← vp=true 면 출력만 44.1kHz
route change reason=8 (routeConfigurationChange) × 2
configChange isRunning=false → recover: rebuilding engine (#1 … #4)   ← 약 0.5초 간격
recover: restart loop with voice processing — suppressing it until the route changes
buildEngine … vp=false → engine started isRunning=true … outHw=2 ch, 48000 Hz   ← vp 를 끄면 48kHz 로 안정
```
- voice processing 을 켜면 **출력(`engine.outputNode.outputFormat(forBus:0)`)만 44.1kHz**, 입력·세션은 48kHz → 엔진이 멈추고 다시 만들어도 같아서 반복. 10-17 iPhone 15 Pro Max 증상과 같다 — 그때 넣은 `setPreferredSampleRate(48_000)` 은 **출력에는 먹지 않는다**

**해 본 것 (둘 다 효과 없어 되돌림, 커밋 안 함)**
1. 반복 4번 뒤 에코 제거를 끄기 전에 `setPreferredSampleRate(출력 표본률 44100)` 후 재구성 → 입력이 48kHz 그대로
2. 1 + 엔진 내리고 `setActive(false)` → 44.1kHz 로 `configureSession()` 다시 → `session sampleRate=48000.0` 그대로 (이 기기는 스피커에서 44.1kHz 요청을 무시)

**다음 후보 (현슈)**
- `mainMixerNode → outputNode` 를 입력과 같은 48kHz 형식으로 명시 연결 (`engine.connect(engine.mainMixerNode, to: engine.outputNode, format: 48kHz)`) — voice processing 을 켠 뒤, `prepare()` 전에
- 세션 mode 를 `.voiceChat` 대신 `.default`(또는 `.videoChat`) 로 두고 AVAudioEngine voice processing 만 쓰기 — voiceChat 의 시스템 처리와 겹쳐 출력 형식이 바뀌는지 확인
- `setPreferredIOBufferDuration(0.02)` 를 빼 보기 (설정 변경의 다른 원인 후보)
- 재현: 점검 화면이 아니라 **스피커로 시작한 통화**에서 매번 난다 (`ENGINE=fake`, `call-peer.ts`, 비용 0)

**10-24 후보 시험 장치 (현슈, 실기기 없이)**: 위 후보 3개에 하나를 더해 빌드 하나로 바꿔 볼 수 있게 했다 — 기본값은 지금 동작 그대로, 개발 빌드에서 `EXPO_PUBLIC_DUPLEX_EXPERIMENTS` 로 켠다 (`connect48`·`connectHw`·`modeDefault`·`noIOBuffer`·`inPlace`, 절차 `docs/testguide.md` 4-13절). 더한 후보 `inPlace`: 지금 복구는 설정 변경마다 엔진을 버리면서 voice processing 을 끄고(`teardownEngine`) 새 엔진에서 다시 켠다. 이 토글 자체가 세션 입출력 설정을 다시 바꿔(로그의 `routeConfigurationChange` × 2) 다음 설정 변경을 부르는 것일 수 있다 → 같은 엔진을 voice processing 을 켠 채 다시 시작한다. 입력 형식이 바뀌었거나 시작에 실패하면 예전처럼 새로 만들고, 반복 보호도 그대로다. 진단 로그에 `outIn`(출력 노드 입력 형식)·세션 mode 를 더했다. Swift 모듈 컴파일·앱 타입 검사·단위 52 통과, **실기기 확인 전**

**10-25 실기기 결과 (장태웅, 이 PC, iPhone 17 Pro, `docs/testguide.md` 4-13절, 기록 `docs/device-test-log.md` 10-25)**: 기준(후보 없음) 스피커 통화 1/3 통과(증상 재현) · `connect48` 1번째에 실패(출력을 처음부터 48kHz 로 맞춰도 반복 → 표본률 어긋남만이 원인은 아님) · **`inPlace` 3/3 통과**(통화마다 `inPlace` 1번 뒤 에코 제거 유지), 점검 화면·에어팟↔스피커 양방향 전환 통과, **실제 OpenAI G 통과**(되돌아간 턴 0, $0.048). 나머지 후보(`connectHw`·`modeDefault`·`noIOBuffer`)는 시험하지 않음. → **`inPlace` 를 기본값으로 바꿀지 현슈 결정**. 새로 발견한 문제 2개 (현슈): ① 에어팟 → 스피커 전환 때 엔진을 새로 만든 직후 앱 종료 1/3(signal 11, `EXC_BAD_ACCESS` `objc_release ← objc_autoreleasePoolPop`, 스레드 `app.syncrew.duplex` — `inPlace` 코드는 안 돎, 기존 `restartEngine` 경로) ② 엔진이 `isRunning=false` 로 시작했는데 `configChange` 알림이 오지 않아 통화 내내 소리·마이크가 없음(기준 1/3) — `inPlace` 도 알림이 있어야 동작하므로 이 경우는 못 막을 수 있음(시작 직후 `isRunning` 을 다시 확인하는 방안)

**10-27 수정 (장태웅이 현슈 대신, 실기기 확인 전)**: ① **`inPlace` 기본값** — 시험 후보에서 빼고 기본 동작으로(끄려면 `noInPlace`). 출시 빌드에도 적용된다(예전 후보는 개발 빌드에서만 켜짐). C2 상대 전환 때 iPhone 버퍼링도 이것으로 해결됐었다 ② **무음 시작** — 원인: `start` 가 엔진을 켠 **뒤에** 설정 변경 알림을 듣기 시작해, 켜는 도중의 알림을 놓쳤다 → 알림을 엔진 전에 듣고, 시작·재시작 0.5초 뒤 엔진이 멈춰 있으면 직접 복구(`watchdog:` 로그, 반복 보호 그대로) ③ **에어팟 → 스피커 앱 종료(추정 수정)** — 옛 엔진을 지울 때 엔진이 먼저 해제되고 큐 블록 끝에서 엔진 내부 임시 객체를 해제하다 꺼진 것으로 본다 → 정리 작업을 `autoreleasepool` 안에서 하고 옛 엔진은 1초 뒤에 놓는다. 재현 1/3 이라 실기기 여러 번 전환으로 확인 필요. iOS 빌드(`xcodebuild`)·앱 타입 검사·단위 64 통과. **같은 날 실기기 확인(iPhone 17 Pro, 실험 설정 없이)**: 스피커 3/3(2번이 멈춘 채 시작 → 알림으로 `inPlace` 복구, 무음 0), 에어팟↔스피커 전환·C2 전환 앱 꺼짐 0 (앱 꺼짐은 확정 아님, `docs/device-test-log.md` 10-27)

기타 관찰: 스피커 출력 음량이 조금 작다(점검 화면). 스트리밍 재연결은 Wi-Fi 다시 붙는 시간 포함 약 12초(Android 0.3초), 끊긴 동안 한 말은 전달 안 됨(설계상 한계). 걸려 온 전화는 그 현장 화면 안에서만 뜬다 — 시연 순서에 반영


### 5-8. 원문 받아쓰기(자막) 문제와 개선 후보 (2026-10-28, 장태웅 실기기 보고 — **개선은 조현수 담당**)

**보고**: 시드니 실기기(iPhone ↔ Note 9, 출시용 빌드, PR #24 뒤) — "통역 자체는 엄청 잘되는데 자막 받아쓰기가 문제". 같은 시기 실제 OpenAI 재현 시험(`server/scripts/stream-overlap.ts`, `docs/device-test-log.md` 10-28)에서도 확인.

| 종류 | 예 | 원인 |
|---|---|---|
| ① 문장 경계 어긋남 | "…들여오세요. 물" / "가져와. 크레인이" — 한 문장의 끝 낱말이 다음 자막으로 넘어감 | 원문 자막은 번역 세션과 **따로 도는 전사 세션**(gpt-live-transcribe, VAD 없음)이 만든다. 번역 세션 말 끝(committed)에 서버가 전사 세션에 commit 을 보내 턴을 닫는데, 전사가 실제 음성보다 늦게 따라와 경계가 한두 낱말 밀린다 (`server/src/streaming/realtimeStream.ts` 머리말 "턴 짝짓기") |
| ② 단어 오인식 | "트럭"→"지렁이", "안전모 써"→"정보서", "비계"→"기계" | 전사 모델 인식 오류. 번역 모델(gpt-realtime-2.1)은 음성을 직접 들어 맞게 번역한다 |

영향: 듣는 사람 화면의 원문 줄, 말한 사람의 "내 말" 자막, **음성 기록(DB 원문)**, 말 없는 턴 판정(`hasSpeech`, 원문이 비면 번역을 버림).

**진행 (10-28)**: 조현수가 A 에 해당하는 **확정 자막**(4-5절, `STREAM_FINAL_STT`, 보완 모드 권장)과 **글자 기반 통역**(4-4절, 기본으로 쓰지 않음)을 PR #25 로 구현·병합. 둘 다 기본 꺼짐 — 시드니에서 확정 자막을 켤지는 조현수 판단. B(듣는 사람 원문 줄 빼기)는 하지 않음.

개선 후보 (장태웅 추천: A + B, 10-28):
- **A. 문장이 끝나면 그 턴 음성만 다시 받아쓴 결과로 원문을 바꾼다** (서버만). 말하는 도중에는 지금 전사 조각을 그대로 보여 주고, 턴이 끝나면 그 턴 입력 음성(허브가 기록용으로 모아 둔 `TurnState.input`)을 gpt-4o-transcribe 로 한 번 더 받아써 `original` 을 확정 → 경계 문제는 없어지고 오인식도 줄 수 있음. 원문 확정이 0.5–1초 늦고 비용 +약 $0.006/분
- **B. 듣는 사람 화면에서는 원문 줄을 빼고 번역만** (앱 `LiveCaptions` — 출시용 빌드 다시 만들어야 함). 원문은 말한 사람 화면·음성 기록에만
- **C. 인식 자체 개선**: 받아쓰기 모델 비교(gpt-4o-transcribe vs gpt-live-transcribe, `scripts/field-accuracy.ts` 의 `termsHeard`), keywords(은어 230개) 조정 — 시연 뒤

## 6. 비용 추정

단가(`pricing.ts`, USD/1M 토큰): `gpt-realtime-2.1` 입력 음성 32, 출력 음성 64, 텍스트 입력 4, 캐시 입력 0.4. 토큰 비율: 출력 음성 약 20토큰/초(**실측**: 7.2초 → 144토큰), 입력 음성 약 10토큰/초(**추정**, S0에서 측정).

| 항목 (말하는 시간 1분 기준, 1:1 한 방향) | 계산 | 금액 |
|---|---|---|
| 입력 음성 | 60초 × 10토큰 × $32/1M | 약 $0.019 |
| 출력 음성 (번역도 약 1분이라 가정) | 60초 × 20토큰 × $64/1M | 약 $0.077 |
| 지시문·용어집 (턴마다, 대부분 캐시) | 턴 10회 × 약 1,500토큰 | 약 $0.006–0.06 (캐시 여부에 따라) |
| 입력 전사 (원문 기록) | 1분 | 약 $0.003 |
| **합계** | | **약 $0.10–0.16 / 말한 1분** (추정) → **S0 실측 약 $0.175 / 말한 1분** (턴당 약 $0.010) |

- 지금 방식(5초 발화 $0.010–0.013 → 1분 $0.12–0.16)과 **비슷한 수준**이다. 단, 단말 게이트 없이 통화 내내 보내면 무음 입력 요금(약 $0.019/분/방향)과, 컨텍스트를 정리하지 않으면 턴마다 늘어나는 입력 요금이 더해진다 → D3·D4가 비용 통제의 핵심.
- 일괄 지시: 이번 범위 밖 (발화 단위 방식 유지 — 비용은 지금과 같음).
- **S0 실측 (2026-10-13)**: 턴당 평균 $0.0102(3.5초 발화), **말한 1분당 약 $0.175**. 입력 음성 10토큰/초·출력 음성 20토큰/초 확인, 지시문 캐시는 거의 안 맞음, 이전 턴 1개 유지 시 +15% → 유지 0턴 제안. 상세 [s0-report.md](s0-report.md) 1-3·1-4절.
- **한도 영향 (2026-10-13 갱신)**: S0 ① 후 누적 $0.2348 / $0.5, 남은 $0.265 (말한 시간 약 1.5분). 아래는 작성 당시 내용: 지금 남은 $0.43(한도 $0.5)으로는 실제 스트리밍 약 3–4분. S0 측정(약 1–2분, ~$0.2)까지는 가능하지만, S2 실제 확인·S6 실기기 튜닝(통화 수십 분)에는 **충전과 한도 상향(사용자 승인)이 필요**하다.

## 7. 단계별 계획 (각 단계 끝에 멈추고 승인)

| 단계 | 목표 | 주요 작업 | 완료 기준 | 필요 환경 | OpenAI 비용 | 규모 |
|---|---|---|---|---|---|---|
| **S0 기술 검증** — ① 완료 2026-10-13 ([s0-report.md](s0-report.md)). **② 실기기 검증은 S3(라이브러리)·S6(헤드셋)으로 옮김 (2026-10-13 결정)** | 계속할지 결정할 근거 확보 | ① 서버 스크립트로 OpenAI Realtime 스트리밍 측정: 미리 녹음한 5개 언어 음성을 실시간 속도로 흘려 **말 끝 → 첫 출력 조각 시간**, server_vad vs semantic_vad, 입력 토큰/초, 컨텍스트 증가 비용, "질문에 답해 버리는지" 시험 문장 ② 네이티브 후보 2–3개를 최소 앱으로 실기기 검증(블루투스 HFP 캡처+재생 동시, 에코, 지연, SDK 57 호환) ③ RN socket.io 바이너리 전송 | 측정 보고서 + D1·D2 확정 + 계속/중단 결정 | 실기기 Android·iPhone, 블루투스 헤드셋 | 약 $0.1–0.2 (승인 후) | M |
| **S1 서버 스트리밍 경로** — **완료 2026-10-13 (4-1절)** | 서버만으로 스트리밍 동작 (가짜 엔진) | 이벤트 계약, `streamHub`·`interpreterSession`·`fakeStream`·`realtimeStream`·`resample`·`persistTurn`·`StreamingMeter`, 세션 `transport`, 폴백 이벤트 | 통합 테스트: 1:1 양방향·1:N 언어별 팬아웃·권한·순서·조각 유실·한도·재연결·기록 형식·폴백 (실제 Socket.IO, 비용 0) | 이 PC | 0 | L |
| **S2 웹 클라이언트 (검증용)** — **완료 2026-10-14 (5-1절)** | 앱 ↔ 서버 스트리밍을 자동으로 끝까지 확인 | `DuplexAudio` 웹 구현(AudioWorklet), `useStreamingCall`, 통화 화면 자막. 헤드리스 Chrome 가짜 마이크 2인 e2e | e2e: 말하는 동안 전송 → 상대에게 조각 재생·자막 → 기록 저장. 실제 OpenAI 1–2회로 지연 측정 | 이 PC | 약 $0.05–0.1 | M |
| **S3 네이티브 오디오** (iOS·Android 모두) | 휴대폰에서 이중 오디오 | **1순위 라이브러리(react-native-audio-api 1.0)로 먼저 구현**해 `DuplexAudio` 어댑터로 감싼다 + config plugin, 경로 변경(블루투스 포함)·권한·오류 처리. 실기기 시험에서 안 되는 부분만 2순위(expo-two-way-audio) 또는 자체 Expo 모듈로 교체 ([s0-report.md](s0-report.md) 2절) | 실기기: 스피커·마이크(필수)와 블루투스 헤드셋(있으면 이때 함께)에서 캡처+재생 동시, 에코 루프 없음, 프레임 지연·끊김 측정 | **iPhone + Android 휴대폰** (+ 헤드셋), 영문 경로(iOS) | 0 (가짜 엔진) | **L (가장 큼)** |
| **S4 앱 통합 (1:1 통화)** | 실제 통화에 적용 | 통화 화면을 스트리밍으로, 폴백 자동 전환, 장치 상태 연동, 설정(스트리밍 끄기) | 실기기 2대 통화: 완료 기준 1–5 (가짜 엔진으로 기능, 실제 엔진으로 지연) | 실기기 2대 + 헤드셋 | 약 $0.2–0.5 | M |
| ~~S5 일괄 지시 스트리밍~~ | **취소 (사용자 결정 2026-10-12: 일괄 지시는 지연 허용, 발화 단위 방식 유지)** | — | — | — | — | — |
| **B1 일괄 지시 대상 선택 UX (앱)** — **완료 2026-10-13** | 누구에게 보낼지 빠르게 정하기 | 8-1절 ①–⑤ (빠른 선택·검색·지난 선택 기억), 문자 지시·실시간 지시 화면 공통 컴포넌트, 5개 언어 문구 | 웹 e2e(데모·live) + 앱 타입 검사, 기존 지시 흐름 회귀 통과 | 이 PC | 0 | S–M |
| **B2 작업조 저장 (서버+앱)** — **완료 2026-10-14** | 자주 쓰는 대상 묶음 재사용 | 8-1절 ⑥: DB 테이블·API·권한·화면 (**DB 구조 변경 → 시작 전 별도 승인**) | 서버 통합 테스트(권한 매트릭스 포함) + e2e | 이 PC | 0 | M |
| **S6 실기기 튜닝·문서** | 목표 지연 달성·안정화 | 블루투스 헤드셋 마무리 확인(S3 시험에서 못 끝낸 것, 안 되면 해당 부분만 자체 모듈로), 20회 이상 지연 측정(P50·P90), 무음 300–400ms·추론 minimal 실험, VAD·패딩·지터 버퍼 조정, 현장 소음, 쉼 단위 확정 실험, 배터리·발열, 문서(`live-interpretation.md`, 운영 문서) | 완료 기준 1–6 충족 결과표 | 실기기 + 블루투스 헤드셋, 가능하면 현장 소음 환경 | **약 $3–6** (S0 실측 단가 기준, 충전 완료·한도 상향 필요) | M |

- 순서상 S1·S2·B1·B2는 실기기 없이 이 PC에서 할 수 있다. S3은 구현은 이 PC에서, 확인은 휴대폰(+ 헤드셋)으로 한다. S4는 휴대폰 2대, S6은 휴대폰 + 블루투스 헤드셋.
- **진행 순서 (2026-10-13 수정)**: S0 ① 완료 → **S1 → S2 → S3 → S4 → S6** (각 단계 끝에 멈추고 승인). B1 완료, B2는 시작 시점을 사용자와 정한다.
  - **실기기 시험 방식 (사용자 결정)**: 먼저 구현해 두고 실기기 시험(2026-10-13 오후부터)에서 고친다. 휴대폰이 준비되면 그때까지 구현된 단계(S3 이상)를 스피커·마이크와 블루투스 헤드셋으로 함께 시험한다.
  - 헤드셋 없이 먼저 구축하는 이유(사용자 판단): 헤드셋은 휴대폰에서 소리가 들어오고 나가는 경로만 바뀌는 것이므로, 서버·통신 구조와 앱 로직은 헤드셋 없이 만들 수 있다.
  - 남는 위험 (사용자 확인 2026-10-13, 구현 후 실기기에서 확인하기로 함): 휴대폰 쪽은 "통신만 바꾸면" 끝나지 않는다. 지금 쓰는 `expo-audio`는 녹음 파일 단위라 **녹음하면서 PCM 조각을 받아 바로 재생**할 수 없어, S3에서 새 오디오 모듈이 필요하다(헤드셋과 무관). 또 고른 라이브러리가 나중에 블루투스에서 안 되면 S6에서 그 부분을 다시 만들어야 할 수 있다 → 앱은 `DuplexAudio` 인터페이스(2절 D2)에만 의존하게 해서 바꿀 범위를 줄인다.
- 규모는 상대적인 크기다 (S < M < L). 일정 추정은 S0 결과(특히 D2: 라이브러리로 되는지)에 크게 좌우되므로 S0 후에 다시 잡는다.

## 8-1. 일괄 지시 대상 선택 UX 개선 (B1·B2, 사용자 요청 2026-10-12)

일괄 지시(문자 지시 `site/instruction/new.tsx`, 실시간 지시 `site/broadcast/new.tsx`)는 발화 단위 방식을 그대로 쓰고, **누구에게 보낼지 고르는 화면**을 개선한다.

**지금 있는 것**: "현장 전체 / 직접 선택" 전환, 사람마다 체크, 접속·연결 끊김과 이어폰 상태 표시, 선택한 사람의 언어별 인원 표시, 연결 끊긴 대상 안내.

**추가할 것**

| # | 기능 | 내용 | 단계 |
|---|---|---|---|
| ① | 빠른 선택 칩 | "접속 중만", 언어별("베트남어 3", "중국어 2" …), "이어폰 연결됨"을 누르면 해당 구성원을 한 번에 선택/해제 (여러 칩 조합 가능) | B1 |
| ② | 전체 선택·해제, 선택 반전 | 직접 선택 모드에서 목록 위 버튼 | B1 |
| ③ | 이름 검색 | 구성원이 많을 때 이름으로 거르기 (선택 상태는 유지) | B1 |
| ④ | 지난 선택 기억 | 관리자·현장별로 마지막 대상 묶음을 단말에 저장해 "지난번 대상(5명)"으로 바로 선택. 그 사이 제외된 사람은 자동으로 빠짐 | B1 |
| ⑤ | 보내기 전 확인 요약 | 버튼에 "5명 · 3개 언어 · 연결 4명"처럼 요약, 연결 끊긴 사람이 있으면 나중에 '받은 지시'로 확인한다는 안내(이미 있음)를 요약 옆에 | B1 |
| ⑥ | 작업조(대상 묶음) 저장 | "철근조", "2층 작업조"처럼 이름 붙여 저장·수정·삭제, 지시할 때 작업조 칩으로 선택. 현장 단위로 관리자끼리 공유 | B2 |

- B1은 앱만 바꾸고 서버 계약은 그대로다 (대상은 지금처럼 `"all"` 또는 `{userIds}`로 보낸다).
- B2는 새 DB 테이블(예: `target_groups(id, site_id, name, created_by, …)`, `target_group_members(group_id, user_id)`)과 API(`GET/POST/PATCH/DELETE /sites/:siteId/target-groups`, 관리자 전용)가 필요하다 → **DB 구조 변경이므로 시작 전 별도 승인**. 구성원이 제외되면 작업조에서도 빠지고, 다른 현장 사용자는 넣을 수 없다 (권한 매트릭스에 추가).
- 문구는 5개 언어 모두 채운다 (`frontend/src/i18n/strings.ts`). 데모 모드(mock)도 같이 고친다.

## 8. 테스트 전략

| 계층 | 방법 | 비용 |
|---|---|---|
| 서버 단위 | 리샘플러, 조각 순서·유실, 턴 상태 전이, 비용 예약·확정, 컨텍스트 정리 | 0 |
| 서버 통합 | 실제 Socket.IO + 가짜 스트림 엔진: 1:1·1:N, 권한(비참여자·구성원 화자 차단, 제외 즉시 차단), 폴백, 재연결, 기록 형식이 기존 기록 API와 같음 (대조군 포함 — 기존 규칙) | 0 |
| 웹 e2e | 헤드리스 Chrome 2개 + 가짜 마이크 음성 파일(`--disable-features=AudioServiceSandbox`): 말하는 동안 전송·상대 재생·자막·기록 | 0 (가짜 엔진) |
| 실제 OpenAI | 측정 스크립트(S0)·e2e 1–2회: 지연·토큰/초·비용 | 승인 후 소액 |
| 실기기 | 체크리스트: 블루투스·유선·스피커 × 말하기·듣기·겹쳐 말하기·헤드셋 연결 해제·네트워크 끊김·통화 30분 | 단계별 |
| 일괄 지시 대상 선택 (B1·B2) | 웹 e2e: 빠른 선택 칩·검색·전체 선택·지난 선택 복원·작업조로 지시 → 선택한 사람만 받음(대조군: 선택 안 한 사람은 못 받음) | 0 |
| 회귀 | 기존 서버 157개, e2e(데모 50·live 27·마이크 2) 그대로 통과 — 발화 단위 방식 유지 확인 | 0 |

## 9. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 네이티브 라이브러리가 블루투스 HFP 동시 입출력을 못 함 | S3 규모 커짐 | S0에서 실기기로 먼저 확인. 안 되면 자체 모듈, 그래도 어려우면 D1-B(WebRTC) 재검토 |
| 휴대폰 스피커 사용 시 에코 루프 (상대 통역이 내 마이크로 들어가 다시 번역) | 오역·무한 반복 | 하드웨어 AEC + 재생 중 게이트 기준 상향, 실패 시 반이중으로 |
| 음성→음성 모델이 번역 대신 질문에 답함 | 오역 | 지시문 강화, S0에서 시험 문장 세트로 확인, 원문 자막을 함께 표시 |
| 첫 출력 조각이 기대보다 늦음 | 목표 미달 | S0에서 먼저 측정해 목표 재설정. reasoning 최소, 지시문 축소, semantic_vad 비교 |
| 통화가 길수록 턴당 비용 증가 (컨텍스트 누적) | 비용 | 턴마다 오래된 항목 삭제, 지시문 캐시 |
| 무음·잡음까지 전송 | 비용·오역 | 단말 VAD 게이트, 노이즈 필터 플러그인(**서버 쪽**, 조각 단위 인터페이스 필요)과 연동 |
| 와이파이 순간 끊김·지연 (TCP) | 소리 끊김 | 지터 버퍼 자동 조정, 조각 큐 상한, 반복 시 폴백 |
| 블루투스 HFP 음질(협대역) | STT·번역 품질 저하 | 16kHz 광대역(HFP 1.6+) 헤드셋 권장, 실기기 비교 |
| 우즈베크어 품질(이미 확인된 문제) | 스트리밍에서도 동일 | 별도 과제 (사용자 결정: 보류) |
| OpenAI 모델·가격·인터페이스 변경 | 재작업 | 어댑터(`realtimeStream.ts`) 한 곳에 격리, 단가는 `OPENAI_PRICING_JSON` |
| 테스트 비용 (잔액 부족) | 진행 막힘 | 가짜 엔진으로 기능 확인, 실제 호출은 측정용으로만, 충전 후 S4–S6 |

## 10. 결정이 필요한 것

결정 완료 (2026-10-12): 계획 진행, D1 A, D2 권장안, 범위 1:1 통화만, 일괄 지시 대상 선택 UX 추가, 실기기·헤드셋 10-13 준비 (0-1절).

남은 것:
1. 실기기 구성: 몇 대인지, iPhone 포함 여부 (S3 전), 헤드셋 모델 (S6 전)
2. iOS 실기기 설치용 Apple 계정 (무료 계정은 7일마다 다시 설치)
3. B2 작업조 저장의 DB 변경 승인과 B1·B2 시작 시점
4. ~~서버 한도 새 금액~~ → $3 누적 적용 (2026-10-13). 남은 것: 충전 잔액 확인(한도는 잔액의 절반 이하), 충전 때 키를 교체했다면 `server/.env` 키 교체
5. ~~프로젝트 영문 경로 이동~~ → 완료 (2026-10-14, `/Users/taewoongjang/PlayGround/SYNCREW`)

## 참고

- 현재 구조·제약: `docs/live-interpretation.md` 2·5·10절, 실측: `docs/phase6-report.md` 2·3절
- OpenAI Realtime 말 끝 감지(VAD) 설정: https://developers.openai.com/api/docs/guides/realtime-vad
- Expo Audio (SDK 57): https://docs.expo.dev/versions/v57.0.0/sdk/audio.md
- 후보 라이브러리: Speechmatics Expo Two Way Audio 가이드 https://docs.speechmatics.com/flow/react-native-guide , react-native-realtime-audio https://unpkg.com/react-native-realtime-audio@1.2.0/README.md , expo-audio-studio https://classic.yarnpkg.com/en/package/@siteed/expo-audio-studio
- Expo에서 24kHz PCM 스트림 재생 사례 토론(라이브러리 한계 언급): https://discuss.ai.google.dev/t/best-practices-for-playing-gemini-live-apis-24khz-pcm-audio-stream-in-expo-react-native/95569
- WebRTC 대안(B): LiveKit Agents (Node.js) https://docs.livekit.io/agents-js/ , OpenAI 플러그인 https://docs.livekit.io/agents-js/modules/plugins_agents_plugin_openai.html
