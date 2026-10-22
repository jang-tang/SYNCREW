# SYNCREW 인수인계 문서 (작업 재개 기준)

작성 2026-10-14 (커밋 `12831ff` 기준), **최종 갱신 2026-10-17 (실기기 없이 할 수 있는 일 마무리, 커밋 `74a7969`)**. 이 문서만 읽고 바로 작업을 이어 갈 수 있도록 작성했다.
더 자세한 근거는 각 절에 적은 문서·파일에 있다. 작업 규칙의 원본은 루트 `CLAUDE.md`.

표기: ✅ 완료(실제로 실행·확인함) · 🟡 진행 중/부분 완료 · ⬜ 미완료(아직 안 함) · ❓ 미확인(상태를 확인하지 못함)

---

## 1. 프로젝트 한눈에 보기

### 목표
건설·제조 현장의 **외국인 작업자와 한국인 관리자가 서로 다른 언어로 실시간 대화**할 수 있게 하는 AI 통역 모바일 서비스 MVP (팀 SyncField, 대한민국 청소년 창업경진대회 출품작).
- 안전모 부착 모듈 = **일반 블루투스 헤드셋**으로 취급
- **Android·iOS 앱**(Expo) + **로컬 PC 서버**(Express + Socket.IO + Postgres). 휴대폰은 같은 Wi-Fi 로 PC 서버에 접속
- 언어: 한국어(ko)·중국어(zh)·베트남어(vi)·우즈베크어(uz)·러시아어(ru)
- 기능: 1:1 대화, 현장 그룹 대화, 관리자 일괄 지시(문자·실시간 음성) + 확인·완료 응답, **1:1 실시간 통역 통화**

### 현재 상태 (2026-10-17) — 한 줄 요약: **"네이티브 오디오까지 만들었지만 실제 휴대폰으로는 아직 한 번도 안 켜 봤다. 실기기 없이 할 수 있는 일은 모두 끝났다"**
- 2026-10-17 실기기 없이 마무리: S3 네이티브 코드 전체 재점검(네이티브 결함 없음), **통화 버그 1개 발견·수정(한쪽만 스트리밍하면 문장 단위 쪽이 상대 말을 못 들음)**, **상대 역할 스크립트 `server/scripts/call-peer.ts`** 추가(스크립트끼리 통화로 확인), OpenAI 가격 공식 페이지 대조(일치), 빌드 캐시 정리. 상세는 2절 "실기기 없이 마무리 (2)"
- **⚠ 디스크 여유 약 2GB (10-17 작업 후)** — 네이티브 빌드(Android 수 GB·iOS 수 GB)가 들어가지 않는다. 실기기 시험 전에 사용자가 공간 확보 필요 (7절 "시작 전에")
- 서버·앱 기능은 대부분 완성. 웹·에뮬레이터 검증 완료, **실기기는 문장 단위 통화까지만 확인**(10-14 밤 T2)
- 진행 중인 큰 작업: **Phase 7 = 1:1 통화 "진짜 스트리밍 통역"** (지연 약 6초 → 2초 이하)
  - S1 서버·S2 웹 완료(실제 OpenAI 확인), **S3 네이티브 오디오는 코드 구현 완료**(10-15 새벽, 자체 Expo 모듈 `frontend/modules/syncrew-duplex/`) — 휴대폰 앱이 통화를 걸면 스트리밍으로 연결을 시도하고, 안 되면 자동으로 문장 단위. 상세 `docs/streaming-plan.md` 5-3절
  - **다음 할 일 = S3 실기기 시험** (7절). 실기기에서 처음 켜 보는 코드라 고칠 것이 나올 가능성이 크다
  - **⚠ 2026-10-17 인수인계 후: 새 담당자에게 Android 기기가 없어 Android 시험은 하지 못한다.** 가진 기기는 iPhone 15 Pro Max + AirPods Pro → S3 는 iOS 만 진행. Android 헤드셋 마이크 재시험·Android 스트리밍·2대 통화(S4)는 Android 기기를 구할 때까지 보류 (`docs/device-test-log.md` 상단)
  - **✅ 2026-10-17 밤 S3 iOS 실기기 시험 (iPhone 15 Pro Max + AirPods Pro, 가짜 엔진, 비용 0)**: 점검 화면 스피커·에어팟·통화 중 전환 통과, **F 스트리밍 통화 통과**(상대 `call-peer.ts`, 12턴, 에어팟 마이크 포함). 실기기에서 처음 켜 보니 **iOS 네이티브 버그 1개 발견·수정**: voice processing 을 켠 엔진이 설정 변경 알림으로 멈추고 재구성하면 또 멈추는 무한 반복(스피커에서 간헐, 블루투스 HFP 에서 항상) → 48kHz 고정 + 블루투스에서는 voice processing 안 씀 + 반복 보호. 알려진 한계: 통화 도중 스피커로 바뀌면 에코 제거가 꺼진 채 남음. G·H 는 가짜 엔진으로 볼 수 없어 실제 OpenAI 시험 필요. 상세 `docs/device-test-log.md`. **코드는 미커밋**(브랜치 `docs/handover-android-unavailable`)
- 실기기: Galaxy S22 + Galaxy Buds2, iPhone 17 Pro + AirPods Pro (사용자 소유, 연결은 매번 확인)
  - T2 결과 (10-14 밤–10-15): 문자 수신·문장 단위 통화 양쪽 통과, iPhone 헤드셋 통과, **Android 헤드셋 마이크 무음(SCO 미시작) → S3 에서 처리, 재시험 필요**. 실기기에서만 드러난 버그 6개 수정(커밋 `0c995ad`) — `docs/implementation-plan.md` T2 절, `docs/device-test-log.md`
  - 네트워크: 일반 Wi-Fi 는 기기 간 통신 막힘. Galaxy 핫스팟에 Mac·iPhone 무선 접속 가능, Galaxy 자신은 USB 터널(`adb reverse`). 두 휴대폰 동시(S4)는 둘 다 핫스팟 손님인 구성 필요(미시험)
  - iOS 개발 빌드는 빌드 때 Mac 주소가 앱에 들어감(`ip.txt`) → 네트워크가 바뀌면 다시 빌드 (7절 명령)
- 자동 시험 (10-15 아침, 모두 통과): 서버 200, 앱 단위 22, 데모 e2e 99, live e2e 43, 마이크 e2e 2
- **주의 (이 PC)**: 에뮬레이터·시뮬레이터가 Mac 마이크를 쓰게 하면(`adb emu avd hostmicon` 등) 권한 창 때문에 CoreAudio 입력이 막혀 앱이 멈추고 웹 e2e 마이크까지 꼬인다(10-15 새벽, Mac 정리 후 회복). 에뮬레이터는 오디오 입력이 무음/가짜 신호라 "소리"는 실기기에서만 확인

### 최종 완료 기준 (MVP)
1. Android·iOS **실기기 2대**로 1:1 스트리밍 통역 통화가 된다: 말 끝 → 상대 이어폰 첫 소리 **P50 ≤ 2.0초, P90 ≤ 3.0초** (같은 Wi-Fi, 실기기 + 블루투스 헤드셋, 20회 이상 측정)
2. 블루투스 헤드셋으로 녹음·재생 동시, 에코 루프 없음, 두 사람이 겹쳐 말해도 끊기지 않음
3. 통화 기록(원문·번역문·음성)이 남고, 스트리밍이 실패하면 문장 단위로 자동 전환, 비용 한도를 넘지 않음
4. 기존 기능(대화·그룹·일괄 지시·작업조·가입·비밀번호 재설정)이 **실기기 Android·iOS 모두**에서 동작
- 근거: `docs/streaming-plan.md` 1절 "완료 기준", 0-2절(목표 조정)

---

## 2. 현재까지의 진행 상황

### ✅ 완료 (커밋됨, GitHub `jang-tang/SYNCREW` `main`)
| 단계 | 내용 | 커밋 |
|---|---|---|
| Phase 1–6 | 서버 기반·인증(Supabase)·현장/멤버십·실시간(Socket.IO)·통역 파이프라인·1:1 통화와 실시간 일괄 지시(문장 단위)·안정화·실제 OpenAI 확인·live 모드 2인 e2e | `9371620`~`022f261` |
| Phase 7 B1 | 일괄 지시 대상 선택 UX (빠른 선택 칩·검색·전체 선택·지난번 대상·요약) | `b1eb6d6` |
| Phase 7 S0 ① | OpenAI 스트리밍 측정: 서버→OpenAI 말 끝→첫 번역 음성 P50 1.83초, 말한 1분당 약 $0.175 (`docs/s0-report.md` 1절) | `b1eb6d6` |
| Phase 7 S1 | 서버 스트리밍 경로 `server/src/streaming/` (OpenAI 세션 유지, 턴마다 문맥 삭제+직전 2문장 텍스트, 비용 기록, 끊김→재연결→문장 단위 폴백, 같은 언어는 OpenAI 없이 직접 전달) | `b1eb6d6` |
| Phase 7 S2 | 웹 앱 스트리밍 (`frontend/src/audio/duplex/` 웹 구현, `useStreamingCall`, 실시간 자막, **스트림으로 들은 문장 다시 재생 안 함**), 실제 OpenAI 2회 확인($0.025, 음성 조각 손실 버그 발견·수정) | `713c5e3`, `14a55da` |
| Phase 7 B2 | 작업조 저장 (DB 표 2개, 관리자 API, 칩·저장·덮어쓰기·관리 화면) | `d47b83d` |
| 안정화 | 서버 시작 시 정리 테스트, 업로드 음성 형식 허용 목록, 알림 사라짐 버그, Expo 패치 4개 | `d47b83d` |
| 모델 비교 | 번역 전용 `gpt-realtime-translate` 비교 → **쓰지 않기로 결정** (`docs/s0-report.md` 4절) | `d47b83d` |
| 실기기 없이 마무리 | 관리자 지정·해제 API·화면, 같은 언어 통화 앱 e2e, 서버 노이즈 필터 조각 단위 연결 지점, 받아쓰기 모델 `gpt-4o-transcribe` 교체 | `12831ff` |
| Supabase 재설정 | 사용자 대시보드 설정(앱 주소 `syncrew://reset-password` 등록·메일 문구·Gmail SMTP) + 메일 수신·링크 이동 확인 (`docs/operations.md` 8절) | `12831ff`(문서) |

| T2 실기기 기준선 | Android·iPhone 문장 단위 통화·문자 수신, iPhone 헤드셋 + 실기기 버그 6개 수정 (업로드·Range·iOS 녹음 파일·헤드셋 판별·음량·빈 화면) | `0c995ad` |
| S3 네이티브 오디오 (구현) | 자체 Expo 모듈(iOS AVAudioEngine+voice processing+HFP / Android 통신 모드+SCO+AudioRecord/AudioTrack), JS 어댑터, 문장 단위에도 Android SCO, 점검 화면 `/audio-check`, 소켓 재연결 — **실기기 시험 전** | `b038223` |
| 실기기 없이 마무리 (2) | S3 코드 재점검, **혼합 통화 무음 버그 수정 + e2e `E2E_MIXED`**, 상대 역할 스크립트 `call-peer.ts`, OpenAI 가격 대조, 캐시 정리 (아래 상세) | `74a7969` |

#### 보안 검사·수정 (Claude Security 플러그인) — 2026-10-22 (브랜치 `claude/laughing-feynman-2h2wyz`)
- **검사**: 저장소 전체(파일 304개) medium 강도. 검증단(3명 중 2명 이상 확인)을 통과한 발견 12건(MEDIUM 4·LOW 8), CRITICAL·HIGH 없음. 보고서는 로컬 `CLAUDE-SECURITY-20261022-022703/`(git 제외)
- **적용한 수정 9건** (각각 별도 에이전트 검토 + 수정이 새 공격 경로를 만들지 않는지 재확인 통과):
  - F1·F6·F7 e2e 정적 서버(`frontend/e2e/live.mjs`·`flows.mjs`·`mic.mjs`) 경로 조작으로 `server/.env` 읽힘 → dist 밖 경로 404, 잘못된 % 인코딩 400, 루프백(127.0.0.1·::1)에서만 열림
  - F2 업로드 음성 ffmpeg 디코딩(`server/src/engine/audio/codec.ts`) → 형식·프로토콜 허용 목록, 길이(-t)·출력 크기·시간(15초) 제한
  - F3 출시 빌드(live, `__DEV__` false)는 https 가 아닌 API 주소면 시작 시 거부(루프백만 예외, `frontend/src/releaseApiUrl.ts`). 개발 빌드는 그대로 http 가능
  - F5 `syncrew://reset-password` 링크의 토큰 직접 수신(로그인 CSRF) 제거 → PKCE `?code=` 만 처리 (관리자 키로 만든 `#access_token` 링크는 이제 앱에서 안 열림, `docs/operations.md` 8절)
  - F8(+F10) 관리자에서 해제되면 해제 전에 시작한 일괄 지시로 더 말할 수 없음(403)
  - F9 `site:subscribe` 와 제외·관리자 해제가 겹칠 때 방에 남는 경쟁 상태 제거
  - F11 통화 종료·구성원 제거와 `stream:open` 이 겹칠 때 스트림이 살아남는 경쟁 상태 제거
- **수정하지 않은 것**: F4·F10 은 F3·F8 과 같은 원인이라 그 패치로 함께 해결. **F12(같은 언어 통화에서 상대가 음성 조각을 대량으로 보내 듣는 쪽 앱 메모리 고갈, LOW)는 미해결** — 서버 재생 대기 상한 시도 2번 모두 검토에서 반려(두 번째는 아주 작은 조각을 대량으로 보내는 공격을 못 막음). 다음 시도: 조각마다 최소 시간(예: 20ms) 부과 + 네이티브 재생 큐 상한
- **보고서 밖 같은 문제 — 2026-10-22 수정(미커밋)**: `frontend/e2e/screens.mjs`(포트 8765)도 같은 경로 처리 패턴(접두사 검사만 있고 모든 인터페이스에서 열림)이었다 → live·flows·mic 와 같은 방식으로 수정: dist 밖 경로 404, 잘못된 % 인코딩 400, 127.0.0.1·::1 루프백에서만 열림(::1 없는 PC 는 건너뜀, 포트 사용 중이면 중단). 포트는 `SCREENS_PORT` 환경 변수로 바꿀 수 있다(기본 8765 유지 — 새 담당자 Mac 은 8765 를 다른 프로그램(agentcat)이 쓰고 있어 `SCREENS_PORT=8775 npm run e2e:screens` 로 확인). 확인: 캡처 18장·오류 0, 경로 조작 7종 404·잘못된 인코딩 2종 400·루프백 바인딩 직접 점검 통과
- 시험: 서버 **248** (+9), 앱 단위 **46** (+4). e2e(Chrome 필요)·실기기는 이 환경에서 못 돌림

#### 말하는 도중 원문 자막: 전사 세션을 gpt-live-transcribe 로 — 2026-10-20 (브랜치 `feat/live-transcribe`, 실제 OpenAI 확인)
- **무엇**: 전사 전용 세션 모델을 `STREAM_STT_MODEL`(새 환경 변수, 기본 **`gpt-live-transcribe`**, `$0.017/분`)로 분리. VAD 없이(`turn_detection: null`, `languages:[원문]`, `delay:"low"`, 용어집 `keywords` ≤50) 입력을 따라가며 받아쓰므로 **`original_partial` 이 말 시작 0.47–0.76초 뒤(말하는 도중)** 에 온다 — 전에는 말 끝 뒤(3.4–4.2초). 말 끝은 그대로 번역 세션 server_vad 가 정하고, 번역 세션 `committed` 때 서버가 전사 세션에 `input_audio_buffer.commit` 을 턴당 1번 보내 두 세션 항목을 1:1 로 맞춘다. `STREAM_STT_MODEL=gpt-4o-transcribe` 면 예전(server_vad) 그대로. 발화 단위 STT 는 `STT_MODEL` 유지
- **비용 기록**: duration(초) 사용량 → 1분 = 1,000 음성 토큰 환산(`durationUsage`), `DEFAULT_PRICING["gpt-live-transcribe"]` 음성 입력 $17/1M = $0.017/분. 턴당 약 $0.001
- **실제 OpenAI 확인 ($0.075, DB 누적 $0.2616)**: `call-peer.ts` 2개 ko↔vi 각 3턴 — 6턴 모두 done·원문·짝 맞음, 비계 → giàn giáo, 경고 0. 표는 `docs/streaming-plan.md` 4-3절 ③. 6턴 원문이 잘린 것은 두 스크립트가 동시에 말해 메아리 차단(`echoDropped: 40`)이 조각을 무음으로 바꾼 탓(반이중 한계)
- 파일: `server/src/streaming/realtimeStream.ts`, `config/env.ts`, `bootstrap.ts`, `engine/budget/pricing.ts`, `.env.example`, `deploy/render-env.sh`. 시험: 서버 **239** (+6). **실기기 미검증** — 다음 실기기 시험에서 "나" 자막이 말하는 도중 뜨는지 확인

#### 전사 전용 세션 + 폰 재생 신호 메아리 차단 — 2026-10-19 밤 (브랜치 `fix/stream-commit-race`, 실기기 2차 발견 2건)
- **증상 (iPhone 스피커, 시드니 서버)**: 내 말 자막이 말 끝 0.5–1.5초 뒤에야 뜨고 4턴 중 2턴은 원문 없음(6초 말이 "안녕." 으로) / 메아리 차단이 39조각을 무음으로 바꿨는데도 한 번 샘(폰 재생이 서버 추정 + 300ms 보다 늦음)
- **A. 전사 전용 세션** (`realtimeStream.ts`, `STREAM_LIVE_TRANSCRIPTION=on|off` 기본 on): 화자 스트림마다 `?intent=transcription` 세션(gpt-4o-transcribe, 같은 server_vad)을 하나 더 열어 같은 음성을 넣고, 번역 세션의 입력 전사는 끔(2번 청구 방지). 턴 id 는 엔진 uuid, 두 세션 항목을 순서(FIFO)로 짝짓기 + 4초 뒤 버림. 전사 세션 실패 시 번역 세션 전사로 자동 복귀. `STREAM_DEBUG=1` 로 두 세션 이벤트 추적
  - **실제 OpenAI 확인 ($0.039)**: 4턴 모두 done·원문 있음, 짝 모두 맞음. **그러나 gpt-4o-transcribe 는 전사 세션에서도 턴 확정 뒤에야 조각을 낸다** — 첫 조각은 말 끝 0.07–0.40초 뒤(완성본 0.52–0.76초), 말하는 도중 자막은 안 됨. 말하는 도중 자막은 `gpt-live-transcribe`(OpenAI 문서, VAD 없음) 후속 — 모델·가격 결정 필요 (`docs/streaming-plan.md` 4-3절)
- **B. 폰 재생 신호** (`stream:playing {streamId, playing}`, 앱 `useStreamingCall.ts`·`playingSignal.ts`, 서버 `streamHub.ts`): 앱이 이중 오디오의 실제 재생 시작/끝을 알리면(끝은 200ms 떨림 제거) 서버는 그 신호(+꼬리 300ms)로만 무음 처리, 신호 없는 옛 앱은 서버 추정 그대로. **실기기 미검증**(스크립트는 소리를 재생하지 않음) — 다음 실기기 시험에서 `echoDropped` 와 메아리 유무 확인
- 문서: `docs/realtime-protocol.md` 10절, `docs/streaming-plan.md` 4-3절. 시험: 서버 **233** (+4), 앱 단위 **36** (+3)

#### 반이중 메아리 차단 + 스트리밍 용어집 — 2026-10-19 (브랜치 `fix/stream-commit-race`, 실기기 발견 2건)
- **메아리**: iPhone 스피커로 들은 통역이 마이크로 되돌아와 내 다음 턴에 섞였다 → 서버가 X 에게 턴을 보내는 동안 + 꼬리 300ms(`StreamHubOptions.echoGuardMs`) 동안 X 의 조각을 버린다 — 통역 스트림은 **같은 길이 무음으로 바꿔** 엔진에 넣는다(그냥 버리면 말 끝 무음이 사라져 OpenAI VAD 가 턴을 못 끝냄 — 실제 확인에서 발견), relay 는 그냥 버림. 버린 수는 스트림 닫힐 때 로그 `echoDropped`·기록 `timings.echoDropped`. 반이중이라 상대 턴 중 끼어들기는 안 된다 — 단말 AEC 가 1순위, 꼬리 길이는 실기기에서 조정
- **실제 OpenAI 확인**: `call-peer.ts` 2개로 4턴 모두 done, ko→vi 에서 비계 → giàn giáo·안전모 → mũ bảo hộ, 2번째 턴부터 지시문 캐시 적중(cached 1,408). 비용 $0.061 (DB 기록 누적 $0.147)
- **용어집**: 스트리밍은 `terms: []` 였다 → 언어 쌍 기준 용어 ≤110개 + 검증 문장 ≤12개(약 3,900자, 결정적 순서)를 세션 지시문 앞쪽에 고정. 지금 데이터는 ko↔vi 만 번역이 있다
- 문서: `docs/streaming-plan.md` 4-2절, `docs/realtime-protocol.md` 10절. 시험: 서버 **229** (+8)

#### 스트리밍 말 끝 판단 변경 — 2026-10-19 (브랜치 `fix/stream-commit-race`)
- **증상**: 실기기(iPhone, LTE) 스트리밍 통화에서 2번째 말부터 번역이 안 됨 (7~8번 말해 5번만 기록). 같은 날 앞 커밋(`72e34d1`)은 `response.create` 경쟁을 고쳤지만 근본 원인이 아니었다
- **근본 원인 (실제 OpenAI API 탐침으로 실측)**: 서버가 `stream:pause` 를 수동 `input_audio_buffer.commit` 으로 바꿔 보냈는데, **수동 commit 을 한 번 보내면 그 세션의 서버 VAD 가 다시는 `speech_started` 를 내지 않는다** → 뒤의 말이 모두 조용히 사라짐. 수동 commit 없이 뒤 무음 ≥0.5초만 보내면 VAD 가 `speech_stopped → committed → response.created` 로 턴마다 알아서 끝내고(말 끝 뒤 약 10ms 에 응답 시작) 여러 턴이 모두 된다
- **결정: 말 끝은 서버 VAD 만 정한다.** 단말은 말이 멎은 뒤 ≥0.6초 무음까지 보내고, `stream:pause` 는 "보내기 중단" 뜻만 갖는다 (통역 스트림은 엔진에 아무것도 보내지 않고, 같은 언어 직접 전달만 턴을 닫는다). 서버는 `input_audio_buffer.commit`·`response.create` 를 보내지 않는다 — `server/src/streaming/realtimeStream.ts` 의 수동 commit·응답 경쟁 코드를 모두 지움
- **덧붙임**: 원문 전사 조각(`conversation.item.input_audio_transcription.delta`)을 `stream:mine:text` `kind: "original_partial"` 로 말한 사람에게 보내 받아쓰는 중 글자가 바로 뜬다(완성본 `original` 이 오면 바꿈). 듣는 사람은 완성본만. `scripts/call-peer.ts` 뒤 무음 0.3 → 0.8초
- 문서: `docs/realtime-protocol.md` 10절, `docs/streaming-plan.md` D4. 시험: 서버 221 (수동 commit 시험 5개 삭제, 새 시험 3개), 앱 단위 31

#### 실기기 없이 마무리 (2) — 2026-10-17
- **S3 네이티브 코드 재점검** (Swift 482줄·Kotlin 554줄·JS 어댑터·`useStreamingCall`·`useHandsFree` 를 처음부터 읽음): 실기기 전에 고쳐야 할 결함은 찾지 못했다. 확인한 것 — Android: 통신 모드 진입·복원, Android 12+ `setCommunicationDevice`(블루투스 SCO > 유선 > 스피커, 수화기 제외), 장치 붙음·빠짐 재선택, 녹음·재생 논블로킹 스레드와 정지 순서, 시작 실패 시 정리, AEC/NS/AGC. iOS: playAndRecord+voiceChat+HFP, voice processing 실패 시 계속, 경로 변경·엔진 설정 변경·중단·미디어 서비스 재시작 시 재구성, 재생 세대 번호로 이전 콜백 무시, 권한 요청. JS: 스트림 열기 실패·마이크 실패 → 문장 단위, 들은 문장 재생 안 함
  - 실기기에서 눈여겨볼 점(결함은 아님): ① Android 블루투스 SCO 는 켜지는 데 시간이 걸려 통화 첫 0.5–1초는 휴대폰 마이크로 녹음될 수 있다 ② 재생 오류가 계속되면 `onError` 가 20ms 마다 반복될 수 있다(로그가 많아짐) ③ iOS 녹음 탭 크기는 iOS 가 정해 첫 조각까지 약 100ms 더 걸릴 수 있다 ④ 오디오 포커스(다른 앱 음악 멈춤)는 요청하지 않는다
- **버그 발견·수정 — 한쪽만 스트리밍하는 통화에서 문장 단위 쪽이 상대 말을 하나도 못 들음** (`frontend/src/audio/useStreamingCall.ts`): 서버는 듣는 사람이 스트리밍 중인지와 상관없이 통역 조각(`stream:out:*`)을 보내는데, 앱은 자기가 문장 단위(폴백)여도 그 턴을 "스트림으로 들음"으로 표시해 이어 오는 기록 알림(`message:new`)까지 건너뛰었다(스트림 조각은 이중 오디오가 멈춰 있어 재생 안 됨). 휴대폰 2대 통화(S4)에서 한쪽만 마이크 열기 실패·서버 상한(BUSY)·`EXPO_PUBLIC_STREAMING=off` 등으로 폴백하면 그쪽이 무음이 되는 문제. → **내 스트림이 열려 있을 때만 스트림 턴을 받도록** 고침
  - 확인: live e2e 에 `E2E_MIXED=1` 추가(서버 `STREAM_MAX_SESSIONS=1` 로 한쪽만 스트리밍). **수정 전 코드: 문장 단위 쪽 재생 0건·건너뜀 3건으로 실패(대조군)**, 수정 후 18/18 통과(재생 3건·건너뜀 0). 회귀: live e2e 43/43, 데모 e2e 99/99, 단위 22/22
  - 같은 언어 통화(직접 전달)는 기록이 남지 않으므로, 한쪽만 스트리밍이면 문장 단위 쪽은 여전히 상대 말을 듣지 못한다 (남은 한계 — 같은 언어 + 혼합 상황은 드물어 그대로 둠, 필요하면 서버가 상대 스트림이 없을 때 직접 전달 대신 기록을 남기게 바꿔야 함)
- **상대 역할 스크립트 `server/scripts/call-peer.ts`** (예전에는 세션 임시 폴더에만 있어 사라졌던 것을 정식 추가): e2e 계정으로 휴대폰(다른 e2e 계정)과 통화 → 몇 초마다 합성 음성으로 말하기(스트리밍 또는 `--utterance` 문장 단위) → 휴대폰이 보낸 소리의 조각 수·첫 조각 시간·**음량(dBFS, 최대 -50dB 미만이면 "거의 무음" 경고)** 출력·wav 저장, 휴대폰 오디오 경로 보고 출력, Ctrl+C 로 통화 끊기. 같은 언어 통화면 휴대폰 마이크 소리가 그대로 와서 **헤드셋 마이크 무음·에코를 바로 확인**할 수 있다. 확인: `ENGINE=fake` 서버에서 스크립트 두 개(관리자 `--answer`, 구성원 걸기)로 통화 — 걸기·받기·양방향 스트리밍·받은 음성 저장·기록 도착·끊기, `--utterance` 업로드 모두 동작 (비용 0)
- **OpenAI 가격 대조** (공식 가격표 developers.openai.com/api/docs/pricing, 2026-10-17): `gpt-realtime-2.1` 텍스트 입력 $4·캐시 $0.4·출력 $24, 음성 입력 $32·출력 $64 (/1M 토큰) — 서버 표와 일치. `gpt-4o-transcribe` 분당 약 $0.006 — 서버 설정과 일치 (미확인 항목 해소)
- **캐시 정리**: Android 빌드 캐시(예전 한글 경로가 남아 있던 `frontend/android/app/.cxx`·`build`, 2.6GB — 다음 빌드 전에 지워야 했던 것), Xcode `ModuleCache.noindex`, npm 캐시
- **하지 못한 것**: 에뮬레이터에서 앱이 상대 통역 음성 조각(이진 데이터)을 받아 재생하는지 확인 — 디스크가 1.5GB 까지 줄어(원인은 이 작업 밖, 프로젝트·에뮬레이터 파일은 그대로) 에뮬레이터가 켜지지 않았고, 캐시 정리 뒤(3.3GB)에는 시작 중 비정상 종료. 실기기 시험의 점검 화면·F 시나리오에서 함께 확인된다
- 자동 시험 (10-17, 모두 통과): 서버 **200**, 앱 단위 **22**, 데모 e2e **99**, live e2e **43** + 혼합 통화 `E2E_MIXED` **18**, 타입 검사 양쪽. (`e2e:mic` 는 바뀐 코드와 무관해 다시 돌리지 않음 — 10-15 아침 2/2)

자동 시험 (마지막 실행 2026-10-15 아침, 모두 통과): 서버 **200**, 앱 단위 **22**, 데모 e2e **99**, live e2e **43**, 마이크 e2e **2**. 네이티브 빌드: Android(Gradle)·iOS 시뮬레이터 성공 (iOS 실기기용은 10-14 S3 이전 코드로만 성공).

### 🟡 진행 중
- **Phase 7 스트리밍 — S3 실기기 시험 대기**: 코드는 완료. 에뮬레이터에서 녹음 조각 100ms·시험음·녹음 재생·스트림 열림까지 확인. 실제 소리·에코·헤드셋·통화 전체는 미확인 (7절 절차)
- T2 남은 것: D(일괄 지시)·E(비밀번호 메일 링크) 양쪽, 헤드셋으로 통역 듣기

### ⬜ 미완료 (아직 하지 않음)
1. ~~실기기 준비~~ ✅ / ~~T2 기준선~~ 🟡 (D·E 남음)
2. **S3 실기기 시험** (iOS·Android) → **S4 휴대폰 2대 통화** → **S6 실기기 튜닝**
4. ~~실제 노이즈 필터 구현~~ 🟡 GTCRN 사이드카(`denoise/`, #4)와 서버 연결(`STREAM_AUDIO_FILTER=sidecar`, #6) 완료 (2026-10-19). 남은 것: 받아쓰기 CER 비교로 켤지 결정 (10/27), 시드니 EC2에서 `--profile denoise` 로 실측
5. 현장 용어 데이터 보강 (다른 팀원: "거푸집·안전모·안전고리"가 검증 문장에 없음, 번역은 베트남어만 있음)
※ **실기기 없이 할 수 있는 일은 2026-10-17 에 모두 끝났다** — 위 1–2 는 실기기, 4–5 는 다른 팀원, 6 은 사용자 결정으로 나중
6. 나중에(사용자 결정): UI 문구 원어민 검수, 업무용 메일 서비스, 우즈베크어 통역 품질(보류), ~~용어집 지시문(보류)~~ ✅ 2026-10-19 스트리밍에도 적용, 백그라운드 통화 유지, 그룹 실시간 통역, 푸시 알림

### ❓ 미확인 (확인하지 못한 것 — 완료로 보지 말 것)
- **S3 네이티브 오디오의 실기기 동작 전부**: 실제 목소리 통역 전달, 스피커 에코 루프 없음, 블루투스 헤드셋 입출력(특히 Android SCO), 경로 변경, 끊김·지연, iOS 는 실행 자체도 미확인(시뮬레이터 마이크가 Mac 권한 문제로 막혀 컴파일만 확인)
- 문장 단위 폴백에서 Android 헤드셋 마이크가 이제 소리를 받는지, 그때 통역 재생(expo-audio, media 용도)이 헤드셋으로 나오는지
- 백그라운드 통화, 두 휴대폰 동시 접속 네트워크
- 비밀번호 재설정 메일 링크 → **휴대폰에서 앱이 열리는지**
- 받아쓰기 "비계 → 기계" 오류가 **사람 목소리에서도** 나는지 (합성 음성에서만 확인)
- 사람이 귀로 듣는 통역 소리 품질·체감 지연 (헤드리스 브라우저는 소리를 못 들음)
- 웹 브라우저의 실제 확인 창(관리자 지정 등)은 사람이 눌러 본 적 없음 (e2e 는 확인 창을 자동 "확인"으로 바꿔 시험)
- 휴대폰 앱이 `stream:out:audio` 이진 조각을 받아 재생하는 경로 (웹에서만 확인, 에뮬레이터 시험은 디스크 부족으로 못 함)

---

## 3. 개발 환경 및 핵심 정보

### 위치와 도구
- 프로젝트: **`/Users/taewoongjang/PlayGround/SYNCREW`** (2026-10-14 영문 경로로 이동. 예전 경로 `/Users/taewoongjang/PlayGround/그동안 했던 프로젝트들/SYNCREW` 는 없음)
- GitHub: https://github.com/jang-tang/SYNCREW (`main`)
- macOS, Node 22, npm, Chrome(`/Applications/Google Chrome.app`, e2e 용), Xcode + iOS 시뮬레이터(iPhone 17 Pro 등), Android 에뮬레이터 `Pixel_9_Pro_XL`(SDK `~/Library/Android/sdk`)
- **Android 빌드는 JDK 21**: `export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home` (기본 JDK 26·Android Studio JDK 25 는 CMake 단계 실패)
- 디스크 여유 약 19GB (2026-10-14). 네이티브 빌드 전 `df -h /System/Volumes/Data` 확인
- 이 PC 의 Wi-Fi IP: 2026-10-14 기준 `192.168.45.160` (바뀔 수 있음 — `ipconfig getifaddr en0` 로 확인)

### 기술 스택
| 부분 | 기술 |
|---|---|
| 앱 `frontend/` | Expo SDK 57 (`expo ~57.0.28`), React Native 0.86.3 (New Architecture 전용), expo-router, TanStack Query, zustand, socket.io-client 4.8, expo-audio 57 (문장 단위 녹음), Supabase JS (인증만) |
| 서버 `server/` | Express 5, Socket.IO 4.8, Prisma 7 + 로컬 Postgres(`embedded-postgres`, 포트 5433, 데이터 `server/.pgdata/`), zod 4, ws, vitest 5 |
| 인증 | Supabase Auth (이메일+비밀번호), 서버는 JWKS 로 토큰 검증. 데이터는 Supabase 에 저장하지 않음 |
| 통역 | OpenAI `gpt-realtime-2.1` (번역·음성), `gpt-4o-transcribe` (받아쓰기, 2026-10-14부터) |

### 구조와 핵심 파일
| 경로 | 내용 |
|---|---|
| `server/src/shared/api.ts`, `realtime.ts` | 앱과 공유하는 REST·Socket.IO 계약 (외부 패키지 import 금지) |
| `server/src/routes/v1/` | REST API (`targetGroups.ts`, `sites.ts` 멤버 관리·역할 등) |
| `server/src/messaging/pipeline.ts` | 문장 단위 통역 파이프라인 (디코딩→노이즈 필터→STT→현장 용어 처리→언어별 번역) |
| `server/src/streaming/` | 스트리밍 통역: `streamHub.ts`(권한·라우팅·폴백·필터), `realtimeStream.ts`(OpenAI), `fakeStream.ts`(가짜 엔진), `persistTurn.ts`(기록), `engine.ts`(지시문) |
| `server/src/engine/audio/streamAudioFilter.ts`, `server/src/plugins/streamAudioFilter.ts` | 스트리밍 노이즈 필터 연결 지점 (조각 단위) |
| `server/src/plugins/audioPreprocessor.ts` | 문장 단위 노이즈 필터 연결 지점 |
| `server/src/engine/budget/` | 비용 한도(BudgetGuard)·단가표 |
| `frontend/src/audio/duplex/` | 이중 오디오 인터페이스(`types.ts`) + 웹 구현(`web.ts`) — **S3 에서 네이티브 구현을 여기 붙인다** (`index.ts`) |
| `frontend/src/audio/useStreamingCall.ts` | 스트리밍 통화 훅 (VAD 게이트·재생·자막·폴백) |
| `frontend/src/audio/useHandsFree.ts` | 문장 단위 통화(폴백) 훅 |
| `frontend/src/audio/streamed.ts` | 중복 재생 방지 기록 |
| `frontend/src/app/site/call/[id].tsx` | 1:1 통화 화면 |
| `frontend/src/services/live/`, `mock/` | 실제 서버 / 데모 모드 서비스 (계약을 바꾸면 둘 다) |
| `frontend/e2e/` | 헤드리스 Chrome 자동 시험 (`flows.mjs` 데모, `live.mjs` 실서버 2인, `mic.mjs`) |
| `server/scripts/` | `stream-measure.ts`, `translate-compare.ts`, `stt-hint-compare.ts`, `openai-check.ts`, `e2e-accounts.ts`, `db.ts` |

### 설정 (값은 적지 않는다 — 비밀 값은 `.env` 에만)
- `server/.env` 키: `HOST PORT DATABASE_URL OPENAI_API_KEY OPENAI_BUDGET_USD(=3) OPENAI_BUDGET_PERIOD(=total) STT_MODEL(=gpt-4o-transcribe) TRANSLATION_MODEL(=gpt-realtime-2.1) SUPABASE_URL SUPABASE_JWKS_URL SUPABASE_SECRET_KEY AUDIO_PREPROCESSOR DATASET_* RETENTION_*` 등. 스트리밍 설정 `STREAMING STREAM_MAX_SESSIONS STREAM_VAD_SILENCE_MS STREAM_AUDIO_FILTER` 는 기본값 사용(`server/.env.example` 참고)
- `frontend/.env` 키: `EXPO_PUBLIC_API_MODE`(**지금 `mock`** = 데모 모드), `EXPO_PUBLIC_API_BASE_URL`(**지금 `http://10.0.2.2:4000`** = Android 에뮬레이터에서 본 PC), `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, (선택) `EXPO_PUBLIC_STREAMING=off`
- 앱: 이름 SYNCREW, Android 패키지·iOS 번들 `com.syncfield.syncrew`, URL scheme `syncrew`, 권한: 마이크(expo-audio 문구)·카메라(QR) (`frontend/app.json`). **블루투스 관련 권한(Android `BLUETOOTH_CONNECT` 등)은 아직 없음 — S3 에서 필요 여부 확인**
- Supabase 프로젝트 `hjatiacukflqxkbqomtp`, Redirect URL `syncrew://reset-password` 등록됨, SMTP = 사용자 Gmail (`docs/operations.md` 8절)
- 테스트 계정: `syncrew-e2e-manager@example.com`, `syncrew-e2e-member@example.com` (비밀번호는 `server/.e2e-accounts.json`, git 제외)

### 실행 방법
```bash
cd /Users/taewoongjang/PlayGround/SYNCREW
# 서버
cd server && npm run db:start                         # 터미널 1: 로컬 Postgres
cd server && npm run db:deploy && npm run dev         # 터미널 2: http://0.0.0.0:4000/health (실제 OpenAI)
cd server && ENGINE=fake npm run dev                  # OpenAI 없이 가짜 통역 (비용 0)
# 시험 (비용 0)
cd server && npm run typecheck && npm test            # 200개
cd frontend && npm run typecheck && npm run test:unit # 18개
cd frontend && npm run bundle:web && npm run e2e      # 데모 99개
cd frontend && npm run bundle:web:live && npm run e2e:live   # live 43개 (ENGINE=fake 서버 + DB 실행 중이어야 함)
# 끝나면 반드시 끄기
pkill -f "src/index.ts"; pkill -INT -f scripts/db.ts
cd server && node_modules/@embedded-postgres/darwin-arm64/native/bin/pg_ctl -D .pgdata stop -m fast   # postgres 가 남았으면
lsof -nP -iTCP:4000 -sTCP:LISTEN; lsof -nP -iTCP:5433 -sTCP:LISTEN   # 둘 다 비어 있어야 함
```

---

## 4. 남은 작업 체크리스트 (우선순위·선후 관계 순)

### T1. 실기기 준비 ✅ (2026-10-14: Galaxy S22 + Buds2, iPhone 17 Pro + AirPods Pro) — 담당: 사용자 / 선행: 없음 / **모든 실기기 작업의 선행 조건**
- 무엇: 5절의 기기·준비물을 갖추고 PC 와 연결
- 왜: 남은 핵심 작업(S3·S4·S6)과 미확인 항목 대부분이 실기기에서만 확인 가능
- 완료 기준: `adb devices -l` 에 Android 휴대폰이 `device` 로 보이고, `xcrun devicectl list devices` 에 iPhone 이 보이며(또는 사용 안 하면 그 사실 확인), 블루투스 헤드셋이 휴대폰에 연결됨

### T2. 실기기 기준선: 지금 앱(문장 단위)을 휴대폰에서 실제 서버로 돌려 보기 🟡 (A·B 양쪽 통과, C iPhone 통과·Android 실패→S3, D·E 미실시 — `docs/implementation-plan.md` T2 절) — 선행: T1
- 무엇: 스트리밍 작업 전에, **이미 만든 기능이 실기기에서 되는지** 먼저 확인 (Android 먼저, 그다음 iPhone)
- 왜: 실기기 접속·네트워크·마이크·헤드셋 문제를 스트리밍 개발과 섞지 않고 먼저 걸러 낸다. 이후 문제의 원인을 좁히는 기준이 된다
- 어떻게: 5절 "앱 설치와 실행" 절차대로 live 모드 개발 빌드 설치 → 5절 시나리오 A–E
- 확인 사항: PC IP, 같은 Wi-Fi, macOS 방화벽, `frontend/.env` 를 live 모드로 바꾼 뒤 Metro 재시작(바꾼 값은 작업 후 되돌릴지 사용자와 정함)
- 완료 기준: 시나리오 A–E 결과를 `docs/device-test-log.md` 에 기록 (통과/실패/원인)
- 주의: 실제 OpenAI 를 쓰는 시나리오는 비용 안내 후. 흐름만 볼 때는 `ENGINE=fake`

### T3. S3 네이티브 오디오 구현 🟡 (구현 완료 2026-10-15, 실기기 시험 남음 — `docs/streaming-plan.md` 5-3절. 라이브러리 대신 자체 Expo 모듈로 결정) — 선행: T1
- 무엇: `frontend/src/audio/duplex/` 에 iOS·Android 구현을 붙여 휴대폰에서 "녹음하면서 동시에 PCM 조각 재생 + 에코 제거 + 블루투스 HFP" 를 한다
- 왜: 웹은 되지만 휴대폰은 `expo-audio`(녹음 파일 단위)로는 스트리밍이 불가능
- 어떻게:
  1. 1순위 `react-native-audio-api` 1.0 nightly 설치(`npx expo install` 가능 여부 확인, 버전 고정). 근거·위험: `docs/s0-report.md` 2-1절 (안정판 0.13.6 에는 에코 제거 없음, Android 블루투스 SCO 경로 지정 기능 없음)
  2. `DuplexAudio` 인터페이스(`frontend/src/audio/duplex/types.ts`)를 그대로 구현하는 어댑터 작성: 16kHz 100ms PCM16 프레임 + dB 음량, 24kHz 조각 이어 재생(지터 버퍼 약 120ms), 경로 변경 알림
  3. `frontend/src/audio/duplex/index.ts` 에서 iOS·Android 일 때 그 구현을 돌려주게 변경
  4. Android 권한(`BLUETOOTH_CONNECT` 등)·iOS 오디오 세션(playAndRecord + voiceChat + Bluetooth HFP) 설정 — config plugin
  5. 안 되는 부분만 2순위 `@speechmatics/expo-two-way-audio`(iOS 빌드 패치 필요, 16kHz 고정) 또는 자체 Expo 모듈로 교체
- 확인 사항: 새 경로에서 네이티브 빌드가 되는지(빌드 전 Android 캐시 삭제 `rm -rf frontend/android/app/.cxx frontend/android/app/build`, iOS 는 `npx expo prebuild` 로 `ios/` 재생성 검토)
- 완료 기준 (iOS·Android 각각): 휴대폰 스피커·마이크와 블루투스 헤드셋에서 캡처+재생 동시, 상대 통역이 내 마이크로 다시 번역되는 에코 루프 없음, 프레임 간격·끊김 측정값 기록. 웹 e2e·서버 시험 회귀 통과
- 주의: 앱 다른 코드는 `DuplexAudio` 에만 의존하므로 다른 파일은 바꾸지 않는 것이 원칙. 블루투스 확인이 안 되면 S6 로 넘겨도 된다(사용자 결정)

### T4. S4 휴대폰 2대 1:1 스트리밍 통화 ⬜ — 선행: T3
- 무엇: Android ↔ iPhone 통화로 스트리밍 전체 확인 (가짜 엔진으로 기능, 실제 OpenAI 로 지연)
- 완료 기준: 계획 완료 기준 1–5 (`docs/streaming-plan.md` 1절) 중 기능 항목 통과, 실제 OpenAI 몇 회 지연 측정 기록
- 주의: 실제 OpenAI 비용 약 $0.2–0.5 (실행 전 안내, 실행 상한)

### T5. S6 실기기 튜닝 ⬜ — 선행: T4
- 무엇: 20회 이상 지연 측정(P50·P90), 무음 판단 300–400ms(`STREAM_VAD_SILENCE_MS`)·추론 minimal(`TRANSLATION_REASONING`) 실험, 현장 소음, 블루투스, 배터리·발열
- 완료 기준: P50 ≤ 2.0초·P90 ≤ 3.0초 결과표, `docs/live-interpretation.md`·운영 문서 갱신
- 주의: 비용 약 $3–6 → 서버 한도(`OPENAI_BUDGET_USD`, 지금 $3, 누적 약 $0.34) 상향 전 금액 안내·승인

### T6. 실기기 전용 확인 묶음 ⬜ — 선행: T1 (T2 와 함께)
- 비밀번호 재설정 메일 링크 → 앱 열림 → 새 비밀번호 저장 (요청한 같은 휴대폰에서 메일을 열어야 함 — PKCE)
- 사람 목소리로 받아쓰기 확인 ("비계", "거푸집", "B문", 숫자)
- 작업조·관리자 지정·대상 선택 화면의 네이티브 표시
- 완료 기준: `docs/device-test-log.md` 기록

### T7. 다른 팀원·나중 작업 (지금 진행 대상 아님)
- 실제 노이즈 필터: `server/src/plugins/streamAudioFilter.ts`(조각, 50ms 제한) / `audioPreprocessor.ts`(문장 전체, 3초 제한)에 등록 — `docs/operations.md` 5절
- 현장 용어 데이터 보강 (데이터셋 어댑터 교체, 코드에 용어를 넣지 않는다)
- 업무용 메일 서비스(지금 개인 Gmail, 하루 약 500통), UI 문구 원어민 검수, 백그라운드 통화, 그룹 실시간 통역, 푸시 알림

---

## 5. 실기기 준비 및 검증 체크리스트

**준비 상태: ✅ 준비됨** (2026-10-14 밤: Galaxy S22 + Galaxy Buds2, iPhone 17 Pro + AirPods Pro. 실제로 된 실행 절차는 7절). `frontend/.env` 는 커밋 시점에 기본값(`mock`, `10.0.2.2`)으로 되돌려 두었다 — 실기기 시험 때 7절대로 바꾼다. 에뮬레이터·시뮬레이터·웹에서 된 것은 실기기 검증이 아니다.

### 필요한 기기·준비물
- [ ] **Android 휴대폰 1대 이상** (Android 12 이상 권장 — 블루투스 통화 경로 지정 API 가 31+) + USB 케이블
- [ ] **iPhone 1대 이상** + USB 케이블 + **Apple 계정** (무료 계정은 설치한 앱이 7일마다 만료 → 다시 설치)
- [ ] 2인 통화 시험(T4)에는 휴대폰 **2대** (Android + iPhone 조합이면 두 플랫폼을 한 번에 확인)
- [ ] **통화용(HFP 지원) 블루투스 헤드셋 1개 이상** (음악 전용 이어폰은 마이크가 안 될 수 있음), 가능하면 2개
- [ ] 휴대폰과 PC 가 **같은 Wi-Fi** (회사·학교 Wi-Fi 는 기기끼리 통신을 막을 수 있음 — 안 되면 휴대폰 핫스팟에 PC 를 연결)

### 휴대폰 설정
- Android: 설정 → 휴대전화 정보 → 빌드번호 7번 눌러 **개발자 옵션** 켜기 → **USB 디버깅** 켜기 → PC 에 연결 후 "USB 디버깅 허용" 수락
- iPhone: PC 연결 후 "이 컴퓨터를 신뢰" → (iOS 16 이상) 설정 → 개인정보 보호 및 보안 → **개발자 모드** 켜기(재시동) → 처음 설치 후 설정 → 일반 → VPN 및 기기 관리에서 개발자 앱 **신뢰**
- 앱 첫 실행 때 **마이크 권한 허용**

### PC 와 연결 확인
```bash
~/Library/Android/sdk/platform-tools/adb devices -l    # Android: "device" 로 보여야 함 (unauthorized 면 휴대폰에서 허용)
xcrun devicectl list devices                           # iPhone (Xcode 에서 기기 등록·서명 팀 선택 필요할 수 있음)
ipconfig getifaddr en0                                 # PC 의 Wi-Fi IP
```

### 앱 설치와 실행 (live 모드 = 실제 PC 서버 접속)
1. 서버: `cd server && npm run db:start` / `cd server && ENGINE=fake npm run dev` (흐름 확인, 비용 0). 휴대폰 브라우저로 `http://<PC IP>:4000/health` 가 열리는지 확인 — 안 되면 macOS 방화벽에서 node 들어오는 연결 허용
2. `frontend/.env` 를 live 모드로: `EXPO_PUBLIC_API_MODE=live`, `EXPO_PUBLIC_API_BASE_URL=http://<PC IP>:4000` (Android 는 USB 에 `adb reverse tcp:4000 tcp:4000` 을 하면 `http://localhost:4000` 도 가능). **값을 바꾸면 Metro 를 다시 시작**(`--clear` 권장). 원래 값(`mock`, `http://10.0.2.2:4000`)으로 되돌릴지는 작업 후 사용자와 정한다
3. Android 빌드·설치: 빌드 전 `rm -rf frontend/android/app/.cxx frontend/android/app/build` (예전 경로 캐시) → `export JAVA_HOME=<JDK 21>` → `cd frontend && npx expo run:android --device` (기기 선택)
4. iOS 빌드·설치: `cd frontend && npx expo run:ios --device` (서명 팀 필요 시 Xcode 에서 `frontend/ios/SYNCREW.xcworkspace` 열어 Signing 설정). `frontend/ios/` 는 예전 경로에서 만든 것 — 오류가 나면 `npx expo prebuild --platform ios --clean` 으로 다시 생성
5. 개발 빌드가 Metro 에 붙지 않으면: Android `adb reverse tcp:8081 tcp:8081`, iPhone 은 같은 Wi-Fi 에서 Metro 주소(`http://<PC IP>:8081`) 입력
6. 로그인: 테스트 계정(`server/.e2e-accounts.json`) 두 개를 휴대폰 두 대에 각각

### 실기기에서 반드시 확인할 시나리오 (iOS·Android 각각, 결과는 아래 기록 방법대로)
| ID | 시나리오 | 통과 기준 |
|---|---|---|
| A | 로그인·현장 입장·1:1 문자 대화 (실제 서버) | 상대 언어로 번역되어 도착 |
| B | 1:1 통역 통화 — **지금 휴대폰은 문장 단위로 자동 전환**되어야 함 (통화 화면에 "문장 단위 통역" 표시) | 휴대폰 마이크로 말하면 상대에게 번역 음성 재생 |
| C | 같은 통화를 **블루투스 헤드셋**으로 | 헤드셋 마이크로 녹음되고 헤드셋으로 들림, 멤버 화면에 헤드셋 이름 표시 |
| D | 관리자 실시간 일괄 지시 + 문자 지시(작업조 칩 사용) + 구성원 확인 | 선택한 사람만 수신, 확인 응답 반영 |
| E | 비밀번호 찾기 → 같은 휴대폰에서 메일 링크 → 앱 열림 → 새 비밀번호 | 새 비밀번호로 로그인 |
| F (S3 후) | **스트리밍 통화**: 통화 화면 "실시간 통역 · 말하는 동안 전송", 실시간 자막, 중복 재생 없음 | 상대가 말 끝 후 약 2초 안에 통역을 들음, 같은 문장이 두 번 재생되지 않음 |
| G (S3 후) | 스피커폰 에코: 헤드셋 없이 스트리밍 통화 | 상대 통역이 내 마이크로 다시 번역되지 않음 |
| H (S3 후) | 헤드셋 연결·해제 중 통화 / 와이파이 잠깐 끊기 / 같은 언어 통화(직접 전달) | 통화 유지 또는 문장 단위로 자동 전환 |

### 에뮬레이터·시뮬레이터·웹에서만 확인한 것 → 실기기 재확인 필요
- 말소리 자동 감지(VAD): 웹 가짜 마이크로만 확인 (에뮬레이터 마이크는 말소리가 안 들어왔음)
- 통화·일괄 지시 화면 흐름: Android 에뮬레이터(Phase 6), iOS 는 시뮬레이터 첫 화면만
- 스트리밍 전체(재생·자막·중복 방지·폴백): 웹 헤드리스 Chrome 만
- 실제 OpenAI 스트리밍: PC 웹에서만 2회
- iOS 시작 화면 로고: 시뮬레이터에서 정상(예전 문제 재현 안 됨)

### 결과 기록 방법
- `docs/device-test-log.md` 에 날짜·기기(모델/OS)·헤드셋·앱 빌드(커밋)·서버 모드(fake/openai)·시나리오 ID·결과(통과/실패)·증상·원인·해결 여부를 표로 남긴다 (서식은 그 파일에 있음)
- 실패는 재현 절차와 화면 캡처·로그 위치를 함께 적고, 고친 커밋 번호를 적는다
- 실제 OpenAI 를 쓴 경우 비용(서버 `/health` 의 `budget.spentUsd` 전후)을 적는다

---

## 6. 주의 사항 및 재작업 방지 정보

### 바꾸면 안 되는 결정 (사용자 결정, 근거 문서)
- 단계마다 멈추고 승인받는다. 커밋·푸시는 사용자가 요청할 때만 (`CLAUDE.md`)
- **OpenAI 비용**: 충전 잔액 $80 이지만 "막 쓰지 말 것". 서버 한도 `OPENAI_BUDGET_USD=3`(누적, 2026-10-14 누적 약 $0.34). **실제 호출 전 예상 비용을 말하고 실행 상한을 건다.** 한도를 올릴 때는 금액을 먼저 알린다. 흐름 확인은 `ENGINE=fake`
- 번역 모델 **`gpt-realtime-2.1` 유지**, 번역 전용 `gpt-realtime-translate` 는 쓰지 않음 (현장 용어·숫자 오역 6/9, 지시문·용어집 불가, 우즈베크어 출력 불가 — `docs/s0-report.md` 4절)
- 받아쓰기 `gpt-4o-transcribe`, 현장 용어 힌트는 쓰지 않음 (오히려 나빠짐 — `docs/streaming-plan.md` 5-2절)
- 스트리밍은 **1:1 통화만**, 일괄 지시는 문장 단위 유지. 같은 언어 통화는 OpenAI 없이 음성 직접 전달. 실패한 문장은 기록 안 함. **스트림으로 들은 문장은 다시 재생하지 않음**
- OpenAI 세션 안 문맥은 응답마다 삭제, 직전 1–2문장을 텍스트로 지시문에 (DB 기록은 그대로)
- 음성 경로: 우리 서버 경유(Socket.IO + PCM). 발화 단위 방식은 폴백으로 유지
- 목표 지연 P50 ≤ 2.0초·P90 ≤ 3.0초 (1.5초는 S6 목표)
- **시험은 iOS·Android 모두**. 먼저 구현하고 실기기에서 고친다
- 노이즈 필터는 **서버**에서. 현장 용어 데이터는 어댑터로 교체 (코드에 용어를 넣지 않는다)
- 데이터는 로컬 Postgres, Supabase 는 인증만. 비밀 값(`OPENAI_API_KEY`, `SUPABASE_SECRET_KEY`, Gmail 앱 비밀번호)은 `.env`·Supabase 화면에만 — 문서·대화·커밋에 적지 않는다 (커밋 전 `git grep --cached -nE "sk-proj-|sb_secret_"`)
- Prisma 의 `migrate reset` 은 우회하지 말고 새 마이그레이션 추가

### 알려진 문제·시행착오 (다시 겪지 않기)
- **서버 끄기**: `npm run dev` 는 `tsx watch src/index.ts` 라 `pkill -f "tsx src/index.ts"` 로는 안 꺼진다 → `pkill -f "src/index.ts"`. DB 는 래퍼만 꺼지고 postgres 가 남을 수 있다 → `pg_ctl ... stop -m fast` (3절 명령). 끝난 뒤 4000·5433 포트 확인
- `expo start` 가 `frontend/tsconfig.json` 을 고쳐 쓴다 → 작업 후 `git checkout -- frontend/tsconfig.json`
- 웹 빌드는 mock/live 설정이 섞이므로 `--clear` 로 (npm 스크립트에 반영됨)
- 헤드리스 Chrome: 비밀번호 입력 뒤 키 이벤트를 잃음(e2e 는 IME 경로 입력), 가짜 마이크 파일은 `--disable-features=AudioServiceSandbox` 필요, **클릭 중 뜬 확인 창을 수락 전에 닫는 경우가 있음**(데모 e2e 는 `window.confirm` 을 "확인"으로 바꿔 둠)
- 앱이 음성 조각을 `socket.volatile` 로 보내면 바쁠 때 버려져 말 앞부분이 사라졌다 → 일반 emit 사용 (S2 실제 OpenAI 확인에서 발견)
- 서버는 `stream:out:end`(messageId) 를 같은 문장의 `message:new` 보다 **먼저** 보내야 한다 (순서가 바뀌면 중복 재생 — 서버 테스트로 고정)
- 알림(토스트)이 사라지는 동안 새 알림이 오면 새 알림까지 지워지던 버그 → id 로 닫기 (수정됨)
- Expo 패치 후 `expo-modules-core` 가 하위 폴더에 설치되어 타입이 깨진 적 있음 → `node_modules`·`package-lock.json` 새로 설치로 해결
- 받아쓰기 단가: mini 음성 입력을 $1.25 로 잘못 두었다가 $3 로 수정 (이전 기록은 약 2.4배 적음)
- Supabase 대시보드의 "Send password recovery" 는 앱 주소 없이 보내 링크가 Site URL(`localhost:3000`)로 간다 — 정상. 실제 사용자는 앱의 "비밀번호 찾기"로 요청
- `frontend/android/app/.cxx` 등 빌드 캐시에 예전 한글 경로가 남아 있음 → 다음 Android 빌드 전 삭제
- 이 문서를 쓰던 세션은 예전 경로에서 시작해 셸이 동작하지 않았다 → **새 세션은 반드시 `/Users/taewoongjang/PlayGround/SYNCREW` 에서 시작**

### 참고 문서
| 문서 | 내용 |
|---|---|
| `CLAUDE.md` | 작업 규칙·상태 표·결정 표·명령 |
| `docs/streaming-plan.md` | Phase 7 계획·결정(0-1·0-2절)·S1(4-1)·S2(5-1)·실기기 없이 마무리(5-2) |
| `docs/s0-report.md` | OpenAI 스트리밍 측정, 네이티브 오디오 후보 조사(2절), 번역 전용 모델 비교(4절) |
| `docs/implementation-plan.md` | Phase 별 완료 내용·검증·커밋 |
| `docs/operations.md` | 설치·실행·비용·플러그인(5절)·확인 도구(6절)·기기 실행(7절)·Supabase(8절) |
| `docs/realtime-protocol.md` | Socket.IO 이벤트 (10절 스트리밍) |
| `docs/api-specification.md` | REST API (11절 세션, 12절 작업조) |
| `docs/live-interpretation.md`, `docs/phase4-report.md`, `docs/phase6-report.md` | 문장 단위 통역 구조, 에뮬레이터 실행 명령, Phase 6 결과 |

---

## 7. 가장 먼저 할 다음 작업

### 선정 (2026-10-15 새벽 갱신): **S3 네이티브 오디오 실기기 시험** (Android → iPhone)

> **2026-10-17 변경: Android 기기 없음 → iPhone(15 Pro Max + AirPods Pro)만 진행.** 아래 절차의 Android 단계(빌드·`adb`·SCO 확인·실행 순서 5번 Android 헤드셋 재시험)는 Android 기기를 구할 때까지 건너뛴다. iOS 서명은 새 담당자 Apple 계정·번들 ID 로 바꿔야 한다 (이전 팀 ID `RVB3MMNVS6` 사용 불가).

선정 이유: S3 코드는 다 썼고 에뮬레이터에서 녹음·재생·시험음까지는 확인했지만, 실제 소리·에코·블루투스 헤드셋·통화 전체는 실기기에서만 확인된다 (이 PC 의 에뮬레이터·시뮬레이터는 Mac 마이크 권한 문제로 입력이 막혔다 — `docs/streaming-plan.md` 5-3절).

### 시작 전에 (Mac)
1. **Mac 화면에 마이크 권한 창이 남아 있으면 처리**(터미널·Code·qemu·Simulator 등이 마이크를 요청). 오디오가 꼬였으면 **Mac 재부팅** — (2026-10-15 아침 정리 후 웹 e2e 재실행: `e2e:mic` 2/2, 데모 99/99, live 43/43 통과 — S3 로 인한 웹 회귀 없음)
2. **디스크 여유 확보 (사용자, 필수)**: `df -h /System/Volumes/Data` — 2026-10-17 작업 후 **약 2GB** 로 네이티브 빌드가 들어가지 않는다 (Android 빌드 약 2.6GB + Gradle, iOS 빌드 수 GB). **최소 15GB 이상** 확보 권장. 이미 정리한 것: Android 빌드 캐시, Xcode `ModuleCache.noindex`, npm 캐시. 큰 곳(10-17 측정): `~/Downloads` 8.9GB, `~/Library/Caches` 8.1GB, `~/Library/Developer/Xcode` 9.1GB(대부분 DerivedData — 지우면 iOS 는 처음부터 다시 빌드, 어차피 네트워크가 바뀌면 다시 빌드한다), `~/Library/Developer/CoreSimulator` 7.0GB(iOS 시뮬레이터 — 실기기 시험에는 필요 없음), 에뮬레이터 `~/.android/avd/Pixel_9_Pro_XL.avd` 7.7GB. 어느 것을 지울지는 사용자가 정한다
3. 에뮬레이터를 켜다 비정상 종료된 적이 있다(10-17, 공간 부족) — Mac 화면에 에뮬레이터 오류 보고 창이 남아 있으면 닫는다

### 실행 순서
1. 서버 `ENGINE=fake` + DB, 네트워크·Metro 는 아래 "실기기 실행 절차"대로 (`.env` 는 지금 기본값 mock)
2. **새 네이티브 모듈이 들어갔으므로 두 휴대폰 모두 개발 빌드를 새로 설치** (Android `expo run:android --device SM_S901N`, iOS `xcodebuild` + `devicectl install`)
3. **점검 화면 먼저** (Metro 를 `EXPO_PUBLIC_DEV_START_ROUTE="/audio-check?auto=1"` 로 켜거나 앱에서 `syncrew:///audio-check`): 
   - 휴대폰 스피커: 경로 `speaker`, 조각 간격 약 100ms, 말하면 음량이 오르는지, 시험음이 들리는지, **시험음 중 마이크 최대(에코)**가 말할 때보다 충분히 낮은지, 3초 녹음 후 다시 듣기
   - 블루투스 헤드셋 연결 후: 경로 `bluetooth (헤드셋 이름)`, 헤드셋에 말하면 음량이 오르는지(Android 는 `adb shell dumpsys audio | grep mScoAudioState` 가 ACTIVE), 시험음이 헤드셋으로 들리는지
4. **스트리밍 통화 (5절 F·G·H)**: 상대 역할은 `server/scripts/call-peer.ts`(아래 "실기기 실행 절차") 또는 두 번째 휴대폰. 통화 화면 "실시간 통역 · 말하는 동안 전송", 상대 통역 자막·재생, 중복 재생 없음, 스피커 에코 루프 없음, 헤드셋 연결·해제
5. **문장 단위 폴백에서 Android 헤드셋 재시험 (10-14 실패한 C)**: `frontend/.env` 에 `EXPO_PUBLIC_STREAMING=off` 로 Metro 재시작 → 헤드셋 마이크로 녹음되는지 + 통역 재생이 헤드셋으로 나오는지. 상대 스크립트는 **`--utterance`** 로 하면 휴대폰 2대가 모두 문장 단위인 상황과 같다 (스트리밍으로 보내도 10-17 수정 이후에는 휴대폰이 기록 음성으로 재생한다)
6. 결과를 `docs/device-test-log.md` 에, 고친 것은 커밋. 그다음 S4(2대 통화)

### 실기기 실행 절차 (2026-10-14–15 에 실제로 된 방법)
- 서버: `cd server && npm run db:start` / `cd server && ENGINE=fake npm run dev`
- **네트워크**: 일반 Wi-Fi 는 기기 간 통신이 막혔다. Galaxy 핫스팟에 Mac·iPhone 을 붙이면 iPhone 은 무선으로 됨. Galaxy 자신은 자기 핫스팟 손님(Mac)에 앱이 닿지 못함 → Galaxy 는 USB 터널:
  - Android: `adb reverse tcp:4000 tcp:4000; adb reverse tcp:8081 tcp:8081`, `frontend/.env` 의 `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000`
  - iPhone: `EXPO_PUBLIC_API_BASE_URL=http://<Mac IP>:4000` (`.env` 하나라 Android·iPhone 을 동시에 쓰려면 두 휴대폰 모두 무선으로 닿는 구성이 필요 — iPhone 핫스팟에 Mac·Galaxy 를 붙여 시험해 볼 것)
  - Metro: `cd frontend && REACT_NATIVE_PACKAGER_HOSTNAME=<Mac IP> npx expo start --dev-client --clear` (`.env` 를 바꾸면 Metro 재시작 + 앱 완전 종료 후 재실행)
- Android 빌드: `rm -rf frontend/android/app/.cxx frontend/android/app/build` → `JAVA_HOME=<JDK 21>` → `cd frontend && npx expo run:android --device SM_S901N` (기기 이름으로 지정)
- iOS 빌드: `cd frontend/ios && xcodebuild -workspace SYNCREW.xcworkspace -scheme SYNCREW -configuration Debug -destination 'id=00008150-0014783A3630C01C' -allowProvisioningUpdates DEVELOPMENT_TEAM=RVB3MMNVS6 CODE_SIGN_STYLE=Automatic build` → `xcrun devicectl device install app --device 00008150-0014783A3630C01C ~/Library/Developer/Xcode/DerivedData/SYNCREW-*/Build/Products/Debug-iphoneos/SYNCREW.app` → `xcrun devicectl device process launch --device … --terminate-existing com.syncfield.syncrew`. **빌드 때 Mac 주소가 앱에 들어가므로(`ip.txt`) 네트워크가 바뀌면 다시 빌드**
- iPhone 앱 로그는 Metro 출력에 나온다. Android 는 `adb logcat | grep ReactNativeJS`
- **상대 역할 스크립트** `server/scripts/call-peer.ts` (2026-10-17 추가, 휴대폰에는 관리자 e2e 계정으로 로그인):
  - `cd server && npx tsx scripts/call-peer.ts` — 구성원 계정(베트남어)이 휴대폰에 전화 → 받으면 8초마다 말하기. `--answer` 휴대폰이 거는 전화 받기, `--as manager` 역할 바꾸기, `--listen` 말하지 않기, `--utterance` 문장 단위, `--every 5`, `--count 3`, `--text "문장"`, `--server http://<주소>:4000`. 끝내기 Ctrl+C
  - 휴대폰이 문장 단위(폴백)면 스크립트 화면에 `◀ 휴대폰 말 …` 대신 `◀ 기록 도착` 만 나온다
  - 출력: `◀ 휴대폰 말 끝 … 조각 N개 · 첫 조각 Nms · 음량 평균/최대 dB (⚠ 거의 무음)`, `휴대폰 오디오 경로: bluetooth (Galaxy Buds2)`. 받은 소리 `server/call-peer-output/*.wav` (git 제외)
  - **휴대폰 마이크 소리를 그대로 듣고 싶으면 같은 언어 통화**(직접 전달)로: 두 계정의 언어를 같게 하면 받은 wav 가 휴대폰 마이크 원음이다 — 헤드셋 마이크 무음·에코·끊김 확인용. 다른 언어면 받은 소리는 통역 음성(`ENGINE=fake` 면 가짜)
  - 비용: `ENGINE=fake` 서버면 0
- 오디오 경로 확인: Android `adb shell dumpsys media.audio_flinger | grep "Input device"`, `adb shell dumpsys audio | grep mScoAudioState`. 녹음 파일 크기·음량은 `server/storage/uploads/*.m4a` 를 `afconvert -f WAVE -d LEI16` 로 바꿔 측정

### 확인 방법 (S3 완료 판단)
- 5절 시나리오 F·G·H 를 Android·iPhone 각각 통과, 결과를 `docs/device-test-log.md` 에 기록
- Android 헤드셋 마이크가 무음이 아니다 (`Input device` 가 BLUETOOTH_SCO 이고 녹음에 목소리)
- 서버·앱 자동 시험 통과, 서버·DB·Metro 종료, `frontend/tsconfig.json` 원복

---

## 8. 작업 재개용 프롬프트 (새 세션에서 그대로 사용)

```
/Users/taewoongjang/PlayGround/SYNCREW 프로젝트를 이어서 하자.
먼저 CLAUDE.md 와 docs/HANDOFF.md 를 읽고, HANDOFF.md 의 "새 세션 응답 규칙"대로
현재 상황 요약과 가장 먼저 할 작업 하나를 단계별로 알려줘.
실기기 준비 상태부터 확인해 주고, 실제 OpenAI 를 쓰는 작업은 하기 전에 예상 비용을 먼저 말해 줘.
단계가 끝나면 보고하고 멈춰.
```

(실기기를 이미 준비했다면 한 줄을 더한다: `실기기 준비했어: Android <모델>, iPhone <모델>, 헤드셋 <모델>. PC 에 연결해 뒀어.`)

---

## 새 세션 응답 규칙 ("이제 할 일이 뭐지?", "다음에 뭘 하면 돼?", "이어서 하자" 라고 하면)

1. **현재 진행 상황을 짧게 요약**한다 (완료된 단계, 지금 멈춘 지점: 7절).
2. **지금 당장 할 가장 우선순위 높은 작업 하나**를 명확히 말한다 — 7절의 선정 작업. 단, 문서 작성 이후 상태가 바뀌었을 수 있으니 `git log`·`docs/device-test-log.md`·사용자 답으로 먼저 확인하고, 이미 끝난 일은 다시 시키지 않는다.
3. 그 작업의 **단계별 절차**를 준다: 필요한 파일·명령·설정·확인 방법 포함 (7절 실행 순서, 5절 절차).
4. **실기기 준비가 끝나지 않았으면 반드시 먼저 알리고**, 준비해야 할 것(5절 기기·준비물·휴대폰 설정)을 가장 먼저 안내한다. 실기기가 필요한 작업을 에뮬레이터·웹 결과로 완료 처리하지 않는다.
5. 실기기 검증이 남아 있으면 **어떤 기능을 어떤 방식으로** 검증할지 알려 준다 (5절 시나리오 A–H, 재확인 목록).
6. 작업이 끝나면 **무엇을 확인하고 무엇을 보고할지** 설명한다: 실행한 시험과 결과, 실기기 결과 기록(`docs/device-test-log.md`), 미검증 항목, 알려진 문제, 다음 단계. 그리고 멈춰서 승인받는다.
7. 선행 조건이나 정보가 부족하면 그 사실을 밝히고, **꼭 필요한 경우에만** 질문한다 (예: 기기 준비 여부, `.env` 값 변경 허락, 실제 OpenAI 비용 승인).
8. 여러 선택지를 나열하고 끝내지 말고, 읽은 직후 바로 행동할 수 있게 안내한다.
9. 비용 규칙(6절)과 사용자 결정(6절)을 지킨다. 실제 OpenAI 호출 전에는 예상 비용을 말한다.
