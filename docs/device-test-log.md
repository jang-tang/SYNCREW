# 실기기 시험 기록

실기기(휴대폰)에서 한 시험을 여기에 남긴다. 시나리오 ID·절차는 `docs/HANDOFF.md` 5절.
에뮬레이터·시뮬레이터·웹 결과는 여기에 적지 않는다 (실기기 검증이 아님).

**2026-10-14 현재: 실기기 시험 기록 없음** (실기기 미준비).

**2026-10-17 인수인계 후 (새 담당자 Mac): Android 실기기 없음 → Android 시험은 진행하지 않음.** 아래 표의 Galaxy S22·iPhone 17 Pro 는 이전 담당자 기기다. 새 담당자가 가진 기기는 iPhone 15 Pro Max(iPhone16,2) + AirPods Pro 뿐이라, S3 실기기 시험은 **iOS 만** 할 수 있다 (상대 역할은 `server/scripts/call-peer.ts`). 그래서 다음은 Android 기기를 구할 때까지 미검증으로 남는다: Android 헤드셋 마이크 무음(10-14 C 실패) 재시험, Android 스트리밍 통화(F·G·H), Android ↔ iPhone 2대 통화(S4).

## 기기 목록

| 기기 | 모델 | OS 버전 | 비고 (헤드셋 등) |
|---|---|---|---|
| (예) Android 1 | | | |
| (예) iPhone 1 | | | |
| (예) 헤드셋 1 | | — | HFP 지원 여부 |

## 시험 결과

| 날짜 | 기기 | 헤드셋 | 앱 빌드(커밋) | 서버 모드(fake/openai) | 시나리오 | 결과 | 증상·측정값 | 원인 | 해결(커밋) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-14 | Galaxy S22 (SM-S901N) | 블루투스 헤드셋 (A2DP 연결 확인) | a62d653 + live 모드 | fake | 설치·실행·로그인 (관리자) | 통과 | 현장 목록이 실제 서버에서 표시 | - | - |
| 2026-10-14 | Galaxy S22 | 블루투스 헤드셋 | a62d653 | fake | A: 상대(구성원 스크립트)가 보낸 그룹 문자 수신 | 통과 | 베트남어 문자가 `[ko] …` 로 실시간 도착, 안 읽은 표시 2 | - | - |
| 2026-10-14 | Galaxy S22 | - | a62d653 | fake | 앱 → PC 서버 무선 접속 | 실패 | Wi-Fi 에서 휴대폰→PC 핑·포트 모두 "No route to host" (macOS 방화벽은 꺼짐). 핫스팟(Galaxy 가 핫스팟, Mac 이 접속)에서는 `adb shell` 로는 닿지만 앱 트래픽은 닿지 않음 (앱이 스플래시에서 멈춤) | Wi-Fi 클라이언트 격리 추정 / 앱 네트워크 경로 | USB 터널(`adb reverse 4000/8081`) + `localhost` 주소로 우회. iPhone 은 우회 불가 → 아이폰 핫스팟 시험 필요 |
| 2026-10-14 | iPhone 17 Pro | - | a62d653 | - | 빌드·설치 | 빌드 성공(설치 전) | 서명 인증서 0개였으나 `xcodebuild -allowProvisioningUpdates DEVELOPMENT_TEAM=RVB3MMNVS6` 자동 서명으로 빌드 성공. 아직 iPhone 에 설치·실행 안 함 | - | 사용자 지시로 Android 먼저 |
| 2026-10-14 | Galaxy S22 | Galaxy Buds2 (해제 상태) | a62d653 | fake | 통화 화면·대화 화면 빈 안내문 | 실패→수정 | 빈 화면 안내문이 좌우 거울 글자로 보임 | 역순 목록 빈 화면을 우리가 한 번 더 뒤집음(최신 RN 은 네이티브에서 이미 바로 세움, Android 는 `scale:-1`) | 웹에서만 뒤집도록 수정, 실기기에서 바로 보임 확인 (미커밋) |
| 2026-10-14 | Galaxy S22 | 없음(휴대폰 마이크) | a62d653 | fake | B: 통화에서 말하기 → 상대 수신 | 실패→수정→통과 | ① 음량 값에 -160(값 없음)이 계속 끼어들어 말 감지가 끊김 ② 음성 업로드가 `Unsupported FormDataPart implementation` 으로 전부 실패 (화면엔 "네트워크 연결을 확인해 주세요") | ① expo-audio Android 음량 측정 특성 ② Expo SDK 57 기본 fetch(expo/fetch)가 RN 파일 첨부 `{uri,name,type}` 미지원 → 문장 단위 통화·음성 메시지 업로드가 휴대폰에서 전부 실패하던 상태 | ① -160 은 건너뜀 ② 휴대폰 multipart 는 XMLHttpRequest 로 전송. 이후 말 감지·업로드(202)·상대 실시간 수신 확인 (미커밋) |
| 2026-10-14 | Galaxy S22 | 없음 | a62d653 | fake | B: 두 번째 문장 | 실패(환경) | `Network request failed` | 같은 순간 adbd "timeout expired while flushing socket, closing" → USB 터널 순간 끊김 | 실제 Wi-Fi 에서는 해당 없음. 앱은 실패한 문장을 다시 보내지 않음 (기록만) |
| 2026-10-14 | Galaxy S22 | Galaxy Buds2 (HFP 연결) | a62d653 | fake | C: 헤드셋 마이크로 통화 | **실패** | 입력 장치는 `AUDIO_DEVICE_IN_BLUETOOTH_SCO_HEADSET` 로 선택되지만 녹음 파일이 완전 무음(-90dB, 14.9초), 음량 값 전부 -160 → 말 감지 안 됨. 화면도 "이어폰이 연결되지 않았어요" | 블루투스 SCO 연결이 켜지지 않음(`SCO_STATE_INACTIVE`). expo-audio 는 입력만 고르고 SCO 를 시작하지 않음 (`docs/s0-report.md` 2절의 위험과 같음) | 미해결 → 네이티브 처리(S3: `setCommunicationDevice`/SCO 시작) 필요 |
| 2026-10-14 | Galaxy S22 | - | a62d653 | fake | 무선 접속 재시험 (Wi-Fi 끄고 셀룰러 + Galaxy 핫스팟, Mac 접속) | 실패 | `adb shell` 로는 Mac:4000·8081 접속되지만 앱은 스플래시에서 멈춤, 서버에 휴대폰 요청 0건 | 핫스팟을 켠 휴대폰의 앱은 자기 핫스팟 손님(Mac)에 닿지 못함 | Galaxy 가 손님이 되는 구성(예: iPhone 핫스팟에 Mac·Galaxy 둘 다 접속) 시험 필요 |
| 2026-10-15 | iPhone 17 Pro (iOS 26.7.1) | - | a62d653 + 수정(미커밋) | fake | 설치·실행 (Galaxy 핫스팟에 Mac·iPhone 둘 다 접속, 무선) | 통과 | 자동 서명 빌드 → `devicectl` 설치. 처음엔 "No script URL": 빌드 때 Mac 주소(`ip.txt`)가 박혀 있어 네트워크가 바뀌면 다시 빌드해야 함 | 개발 빌드가 expo-dev-client 없이 `ip.txt` 로 Metro 를 찾음 | 현재 주소로 다시 빌드 |
| 2026-10-15 | iPhone 17 Pro | - | 〃 | fake | A: 상대 그룹 문자 수신 | 통과 | 실시간 도착 | - | - |
| 2026-10-15 | iPhone 17 Pro | - | 〃 | fake | 받은 통역 음성 자동 재생 | 실패→수정→통과 | 재생이 끝나지 않아 통화 화면이 "통역 음성 재생 중 — 끝나면 말하세요"에 멈춤 (마이크 정지) | 서버 음성 주소가 `Range` 요청에 206 을 주지 않아 iOS 재생기(AVPlayer)가 파일을 열지 못함 → 끝 이벤트 없음 | 서버 음성 라우트에 Range(206/416) 지원 + 시험 추가, 앱 재생에 끝 감시 안전장치 |
| 2026-10-15 | iPhone 17 Pro | 없음(휴대폰 마이크) | 〃 | fake | B: 통화에서 말하기 | 실패→수정→통과 | 업로드 파일이 28바이트(빈 파일) → 받아쓰기 실패 | iOS 녹음기가 다음 녹음을 **같은 파일 경로**에 다시 써서, 업로드가 읽기 전에 덮어씀 (Android 는 매번 새 파일) | iOS 는 업로드가 끝난 뒤 다음 녹음 시작. 이후 2문장 정상(약 44KB) 전달 |
| 2026-10-15 | iPhone 17 Pro | AirPods Pro (HFP) | 〃 | fake | C: 헤드셋 마이크로 통화 | 실패→수정→통과 | 에어팟이 입력 목록에 있는데 화면은 "이어폰이 연결되지 않았어요" | expo-audio `getCurrentInput()` 이 타입은 Promise 인데 iOS 는 값을 바로 돌려줘 `.catch` 에서 오류 → "알 수 없음" 처리 | Promise 로 감싸 처리. 현재 입력 `AirPods Pro (BluetoothHFP)` 확인, 녹음 최대 -12dB 로 목소리 담김, 3문장 전달. **헤드셋으로 통역이 들리는지는 미확인** (가짜 엔진 음성은 0.1초 무음) |
| 2026-10-17 | iPhone 15 Pro Max (iOS 26.6.1, 새 담당자) | - | 74a7969 + S3 수정(미커밋, 번들 ID `com.syncfield.syncrew.hyeonsyu` 개인 팀 서명) | fake | 빌드·설치·Metro 접속 | 통과 (환경 시행착오) | ① Xcode 계정 로그인 만료 → 재로그인 ② Mac 이 iPhone 핫스팟으로 자동 전환돼 앱에 박힌 주소와 어긋남("No script URL") ③ 집 Wi-Fi 에서 핫스팟을 동시에 켜 두면 Metro 전송 13KB/s ④ iPhone 핫스팟(USB)은 Safari 로도 Mac 에 못 닿음 (팀원 Galaxy 와 같은 제약) | 네트워크 | 핫스팟 끄고 둘 다 같은 Wi-Fi(5GHz) → 정상 |
| 2026-10-17 | iPhone 15 Pro Max | - | 〃 | - | S3 점검 화면 `/audio-check` 스피커 | **실패→수정→통과** | 시작은 되는데 녹음 조각 0개, 시험음·녹음 재생 안 됨 | voice processing 을 켠 AVAudioEngine 이 시작 직후 `AVAudioEngineConfigurationChange` 로 멈추고, 재구성하면 또 멈춰 **0.4초 간격 무한 반복** (원래 코드는 알림마다 엔진을 새로 만듦) | 세션 샘플레이트 48kHz 고정(입력 48k/출력 44.1k 불일치 완화) + 반복 보호(10초에 4회 넘으면 voice processing 끄고 재구성, 그래도 반복이면 멈추고 `onError`). 수정 후: 조각 간격 100ms(최대 103), 말할 때 -15dB, **시험음 중 마이크 -62dB(에코 제거 동작)**, 시험음·녹음 재생 들림 |
| 2026-10-17 | iPhone 15 Pro Max | AirPods Pro (HFP, "현슈크림붕어빵 2세") | 〃 | - | S3 점검 화면 에어팟 | **실패→수정→통과** | 경로는 bluetooth 로 잡히는데 소리가 안 나고 캡처가 멈춤 | 블루투스 HFP + voice processing 조합은 **항상** 위 반복에 빠짐(약 1초 간격) | **블루투스 경로에서는 voice processing 을 쓰지 않음**(HFP 헤드셋은 되울림 구조가 아니고 자체 처리 있음), 경로 변경으로 켜야 할지 바뀌면 엔진 재구성. 수정 후: 에어팟으로 시험음·녹음 재생 들림, 조각 100ms. 시험음 중 에어팟 마이크 -25dB(말소리 -20dB) — 에코 제거 없음, 통화에서 상대 음성이 되돌아가는지는 실제 OpenAI 시험 필요 |
| 2026-10-17 | iPhone 15 Pro Max | AirPods Pro ↔ 스피커 전환 | 〃 | - | S3 점검 화면 통화 중 헤드셋 해제·연결 | 통과 (알려진 한계) | 에어팟 → 스피커: 약 2.6초 공백 뒤 스피커로 재생. 스피커 → 에어팟: 바로 에어팟으로 재생 | 스피커로 바뀔 때 voice processing 을 켜면 반복 4회 → 보호 장치가 끄고 안정 | **통화 도중 스피커로 바뀐 뒤에는 에코 제거가 꺼진 상태로 남는다** (처음부터 스피커로 시작하면 켜짐). 미해결, S6 에서 |
| 2026-10-17 | iPhone 15 Pro Max | 없음 → AirPods Pro → 없음 → AirPods Pro | 〃 | fake | **F: 스트리밍 통화** (상대 `call-peer.ts` 구성원 vi, 약 3분) | **통과** | iPhone 발화 12턴이 스트리밍 조각으로 상대 도착(조각 100ms, 첫 조각 약 0.8s = 가짜 엔진 지연, 음량 -15~-18dB), 턴마다 기록(`message:new`) 도착, 경로 보고 builtin→bluetooth→builtin→bluetooth 정상, **에어팟 마이크로 말한 턴(2.5s·2.2s) 정상 도착**. 통화 시작 시 스피커에서 voice processing 반복 1회 → 보호 장치로 끄고 진행(`voice_processing_loop` 경고 1건). 한국어 한 문장이 0.2초짜리 턴으로 쪼개진 경우 있음(가짜 엔진 VAD) | - | 화면 문구 "실시간 통역 · 말하는 동안 전송"은 사용자가 인지 못 함(작은 칩) — 동작은 로그로 확인. 자막·"통화가 끝났어요" 표시는 미확인 |
| 2026-10-17 | - | - | - | - | G(스피커 에코 루프)·H(와이파이 끊김·같은 언어) | 미실시 | 가짜 엔진 통역 음성은 거의 무음이라 에코 루프를 볼 수 없음 → 실제 OpenAI 로 해야 함(비용 안내 후) | - | - |
| 2026-10-17 | (Android 없음) | - | - | - | Android 전부 (C 재시험·F·G·H·S4) | **미실시** | 새 담당자에게 Android 기기 없음 | - | Android 기기 확보 후 |
| | | | | | | | | | |

- 실패는 재현 절차, 화면 캡처·로그 위치를 함께 적는다.
- 실제 OpenAI 를 썼으면 서버 `/health` 의 `budget.spentUsd` 전후 값을 적는다.
- 지연 측정(S6)은 회차별 값을 아래에 따로 표로 남기고 P50·P90 을 계산한다.

## 지연 측정 (S6)

| 회차 | 방향 | 말 길이(초) | 말 끝 → 상대 첫 소리(초) | 헤드셋 | 비고 |
|---|---|---|---|---|---|
