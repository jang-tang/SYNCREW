# SYNCREW 인수인계 문서 (작업 재개 기준)

작성 2026-10-14 (커밋 `12831ff` 기준), **최종 갱신 2026-10-25 (PR #16·#17 `main` 병합 `9e0487f` 반영, 이 PC 서버 OpenAI 한도 $20, 다음 = iPhone 에코 제거 후보 시험. 그 전 10-24: 로컬 S4 휴대폰 2대 통화 통과·말 없는 턴 버리기 수정·현장 용어 400문장 정확도 측정 — `docs/field-accuracy.md`. 그 전 새벽: iPhone 17 Pro 실기기 확인 끝, 현장 용어 은어 보강·스트리밍 은어 확대 — `docs/field-terms.md`, PR #11–#13 병합. **새 세션은 1절 "▶ 새 세션은 여기부터" 를 먼저 읽는다**. 그 전 10-23: Android S3 실기기 시험 끝 — Note 9 + WH-1000XM6, 버그 6개 수정. 그 전: 10-22 PR #2–#10 병합 `3d72cad`, 10-18 S3 iOS `4fd2d9d`)**. 이 문서만 읽고 바로 작업을 이어 갈 수 있도록 작성했다.
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

### ▶ 새 세션은 여기부터 — 지금 상태와 남은 일 (2026-10-25 기준, 10/30 시연까지 5일)

**한 줄 요약**: "Android(Note 9)·iPhone(17 Pro) 모두 실기기 시험을 거의 끝냈다. 둘 다 스트리밍·문장 단위·헤드셋·스피커·Wi-Fi 끊김이 되고, iPhone 스피커에서 에코 제거가 꺼지는 문제는 남았지만 서버 반이중 차단 덕분에 에코 루프(G)는 통과해 시연에 지장 없다. 현장 은어 데이터도 보강했다. 10-24 낮 이 PC 서버(같은 Wi-Fi)로 **휴대폰 2대 통화(S4)도 통과**했고, 현장 문장 400개 실측 **정확도 89.5%·지연 중앙값 1.9초**(발표용, `docs/field-accuracy.md`). 남은 핵심은 **시드니 배포 → 시드니 서버로 짧은 리허설**."

**코드·브랜치 상태**
- **모두 `main` 에 들어갔다 (10-25 `9e0487f`, 미커밋 작업 없음)**: Android S3 수정(PR #11), iPhone 에코 제거 수정(PR #12, 현슈), 현장 용어 보강·스트리밍 은어 확대(PR #13), 10-24 iPhone 시험 기록(PR #14), S4·말 없는 턴 버리기·400문장 측정(PR #15), 실측 오역 단어 보충·무음 350ms·재측정(PR #16), **iOS 에코 제거 후보 시험 장치·시드니 배포 기록(PR #17, 현슈 — 실기기 확인 전)**
- 10-25 기준선 (이 PC, pull 직후, 비용 0): 서버 타입 검사 + 시험 **262 통과·1 건너뜀**, 앱 타입 검사 + 단위 **52 통과**. e2e 는 다시 돌리지 않음
- **PR #17 로 iOS 네이티브(Swift)가 바뀌었다 → iPhone 개발 빌드를 다시 설치해야 한다** (`docs/testguide.md` 4-6절)
- 시드니 서버(https://syncrew.hyunshu.com): **10-24 오후 `main` `bf22f8b` 배포 완료 (조현수)** — `ENGINE=openai`·필터 passthrough·한도 $20 그대로, `.env` 를 다시 만들어 무음 350ms·추론 low 반영, `/health` 정상(데이터셋 kosha·moel·measured 포함). 그 전에 AWS 계정이 지출 한도에 걸려 EC2·RDS 가 멈췄던 것을 복구함 (`deploy/README.md` 3절)
- OpenAI 누적 **$12.78** (10-24 S4 약 $0.34 + 400문장 측정 $3.84 + 설정 비교 $2.55 + 새 설정 400문장 재측정 $4.74, 사용자 승인). 재측정 결과: 지연 중앙값 1.91 → 1.60초, 정확도 89.5 → 87.75% (은어 ↓, 표준 용어 ↑) — `docs/field-accuracy.md` 9절. **사용자 결정으로 추론 low 로 되돌려 3차 측정($4.47, 누적 $17.26): 정확도 90.7%(가장 높음), 지연 vi 1.89·zh 1.85초 — 지금 기본값 = 무음 350ms·추론 low** (10절) / **10-25 사용자 지시로 이 PC `server/.env` 한도 $3 → $20** (누적 $17.26, 10-25 저녁 G 뒤 누적 $17.306, 남은 여유 약 $2.69 — 넘을 작업이면 금액 먼저 안내). 시드니 서버 한도는 따로 $20

**10-24 낮 한 일**
- **S4 휴대폰 2대 통화 (이 PC 서버·같은 Wi-Fi·실제 OpenAI)**: Note 9(구성원 Nguyen, vi) ↔ iPhone 17 Pro(관리자, ko), 양방향 걸기·받기·통역 통과 (`docs/device-test-log.md` 10-24). 두 휴대폰을 같은 계정으로 쓰면 안 됨 — Note 9 를 `syncrew-e2e-member` 로 다시 로그인(비밀번호는 `server/.e2e-accounts.json` 에서 adb 로 입력)
- **발견→수정: 원문에 말이 없는 턴에서 "멈춰!" 같은 지시를 지어냄** → 원문 전사가 비거나 군소리("음,")뿐이면 번역 음성·자막을 내보내지 않음 (말이 있으면 붙잡지 않아 지연 없음, 전사가 2초 안에 안 오면 그대로 내보냄). 서버 테스트 **262 통과**
- **현장 용어 400문장 측정** (`docs/field-accuracy.md`): vi 89.0%·zh 90.0%, 지연 중앙값 vi 2.01초·zh 1.83초. 자주 틀린 것: 슬래브→슬리브, 비계→기계, 숫자 "이 미터" 빠짐, 훅 해지장치, 우마·도비·마에가리
- **10-24 밤 개선 (`docs/field-accuracy.md` 7·8절)**: 실측 오역 단어 12개 vi·zh 번역 보충(`supplement/measured_terms.json`, zh 용어집이 0개였음)·데스라 뜻 풀어 씀·용어 상한 125. 설정 비교: 무음 350ms + 추론 minimal 이 지연 중앙값 2.15 → 1.71초(26문장, 정확도 유지). **기본값: `STREAM_VAD_SILENCE_MS=350`, `TRANSLATION_REASONING=low`** (`server/src/config/env.ts`·`.env.example`·`deploy/render-env.sh`. minimal 은 은어 정확도가 떨어져 되돌림). ⚠ 무음 350ms 는 사람 목소리로 문장이 둘로 잘리는지 실기기 확인 필요(잘리면 500 으로 되돌리기: 환경 변수만). 시드니 서버는 `.env` 를 다시 만들어야 반영. 동시 스트림 6개에서 OpenAI 한도에 걸려 번역이 비는 현상 발견

**10-23–24 한 일 (상세 문서)**
- 현장 용어 (`docs/field-terms.md`): 은어 → 표준 한국어 중심(사용자 결정), 안전보건공단 유의어 사전 은어 210개 + 고용노동부 다국어 안전표지 19문장, 보정은 받아쓰기 오인식형만, 스트리밍 지시문에 은어 230개 전부 + 받아쓰기 keywords. ko→zh 은어 문장 2/7 → 6/7
- Android S3 (`docs/device-test-log.md` 10-23): Note 9 + WH-1000XM6 전부 통과, 버그 6개 수정
- iPhone 17 Pro (`docs/device-test-log.md` 10-24, `docs/streaming-plan.md` 5-7절):
  - ✅ PR #12(경로 변경 때 에코 제거 다시 켬·통화 중 세션 덮어쓰기 막기), 에어팟↔스피커 전환, H Wi-Fi 끊김 재연결(약 12초), **G 스피커 에코 루프(실제 OpenAI, 되돌아간 턴 0)**, 문장 단위 녹음·통역 재생(스피커·에어팟, 실제 OpenAI)
  - ❌ 스피커에서 에코 제거가 2–4초 뒤 꺼짐: voice processing 출력만 44.1kHz(입력 48kHz) → 재구성 반복. 표본률 수정 2번 효과 없음(되돌림) → **조현수에게 넘김** (5-7절에 로그·다음 후보)
  - 알려진 한계: Wi-Fi 끊긴 동안 한 말은 전달 안 됨(스트리밍 설계), 통역 재생 중 끼어든 말은 서버 반이중 차단으로 막힘, 스피커 출력 음량 조금 작음

**10-25 저녁 한 일 — iPhone 에코 제거 후보 시험 (장태웅, 이 PC, iPhone 17 Pro, 상세 `docs/device-test-log.md` 10-25·`docs/streaming-plan.md` 5-7절)**
- **`inPlace` 후보가 답**: 스피커 통화 3/3 통과(기준 1/3, `connect48` 실패), 점검 화면·에어팟↔스피커 전환 통과, **실제 OpenAI G 통과**(되돌아간 턴 0, $0.048 → 누적 $17.306). 아직 코드 기본값은 그대로 — **기본값으로 바꾸는 것은 현슈**
- 새로 발견 (현슈에게): ① 에어팟 → 스피커 전환 때 앱 종료 1/3(signal 11, 기존 엔진 재구성 경로) ② 엔진이 멈춘 채 시작했는데 알림이 없어 통화 내내 무음 1/3(기준 시험). 로그·충돌 보고서는 장태웅 PC 에 있음(전달 필요)
- 이 PC 상태: 서버·DB·Metro 종료, `frontend/.env` mock 으로 되돌림, iPhone 에는 PR #17 개발 빌드 설치됨

**남은 일 (우선순위 순)** — 10-25 사용자 결정: 5번 iPhone 에코 제거 후보 시험부터 → **10-25 끝(위)** → 2번 시드니 리허설도 10-25 밤 끝, **다음은 3번 시연 진행 순서 확정**
1. ~~**`main` PR → 시드니 배포** (조현수)~~ ✅ 10-24 오후 `bf22f8b` (실기기로 시드니 접속 확인은 2번에서)
2. ~~**시드니 리허설**~~ ✅ **10-25 밤 통과** (iPhone 17 Pro 관리자 ↔ Note 9 구성원, https://syncrew.hyunshu.com, 실제 OpenAI, 통화 4번): 양방향 걸기·받기·통역, 빠름(체감). 시드니 현장 이름 **"E2E 시드니 시험 현장"**(e2e 두 계정 모두 소속). 배운 것: **iPhone 통화 음량이 낮으면 에어팟에서 안 들림 → 시연 전 통화 중 음량 올리기**, Note 9 는 Wi-Fi 를 켜야 함(유심 없음), 네트워크 오류 때 로그인 화면이 "비밀번호 틀림"으로 표시(작은 문구 문제) — `docs/device-test-log.md` 10-25
3. **시연 진행 순서 확정**: 걸려 온 전화는 **받는 사람이 그 현장 화면 안에 있어야** 뜬다(앱을 고칠지 결정). 시드니 서버면 같은 Wi-Fi 불필요(LTE 가능). 끼어드는 장면이 있으면 에어팟·헤드셋
4. 시연용 은어 뜻을 현장 사람에게 확인 (비용 0)
5. iPhone 스피커 에코 제거(5-7절) — ✅ 10-25 시험 끝: **`inPlace` 통과 → 현슈가 기본값으로 바꾸기 + 새 문제 2개(앱 종료·무음 시작) 고치기**, 바뀌면 장태웅이 iPhone 으로 다시 확인(가짜 엔진, 비용 0). 노이즈 필터 켤지 결정(10/27, 조현수)
6. **10/31 AWS 시드니 자원 삭제** (`deploy/README.md` 8절)
7. 시연 뒤: S6 지연 튜닝(약 $3–6, 서버 한도 상향 필요), Android 12+ 기기, 현장 용어 후속(field-terms.md 7–9절 "남은 것"), 보안 F12, 간헐 실패 사이드카 시험

**이 PC 에서 iPhone 시험할 때 알아 둘 것 (10-24 확인)**
- 디스크: 시뮬레이터 내용 초기화(`xcrun simctl erase all`)로 19GB 확보 — 빌드 전 `df -h /System/Volumes/Data` (15GB 이상)
- `frontend/ios` 는 생성 파일(git 제외): 패키지·플러그인이 바뀌면 `CI=1 npx expo prebuild --platform ios --no-install` → `cd ios && pod install` → **prebuild 가 바꾼 `frontend/package.json` 스크립트는 `git checkout` 으로 되돌린다**
- 빌드·설치·로그는 **무선으로 된다** (처음 한 번 USB 로 페어링 뒤): `xcodebuild …` → `xcrun devicectl device install app …` → `xcrun devicectl device process launch --console …` 로 `[duplex-diag]` 수집 (7절 명령)
- 앱 설정: `frontend/.env` 를 live·`http://<Mac IP>:4000` 으로 바꾸고 Metro `npx expo start --dev-client --lan` — 끝나면 원래 값(mock)으로 되돌린다. 문장 단위만 볼 때 `EXPO_PUBLIC_STREAMING=off`
- 통화 상대 `server/scripts/call-peer.ts` 는 **"E2E 현장 10120452"** 로 건다 (관리자 시험 계정은 현장 23개) — 휴대폰은 그 현장 화면에 있어야 받는다. 받지 않으면 30초 뒤 부재중
- **가짜 엔진은 문장 단위 통역 음성이 무음**(스트리밍만 삐 소리) → 문장 단위 재생은 실제 OpenAI 로만 확인된다
- Wi-Fi 끊김 시험 때 휴대폰이 **다른 Wi-Fi 에 자동으로 붙으면** PC 에 못 닿는다 → 그 Wi-Fi 의 "자동 연결" 끄기

### 이전 상태 (2026-10-23, 기록용) — 한 줄 요약: **"Android(Note 9)는 스트리밍·문장 단위·헤드셋·스피커·에코·Wi-Fi 끊김까지 모두 통과했다(버그 6개 수정). 남은 것은 iPhone 재확인(에코 제거 문제는 PR #12 로 수정, 실기기 확인 전)과 휴대폰 2대 통화(S4) — 10/30 시연은 Android·iPhone 모두 쓴다"**
- **2026-10-23 낮 iOS 에코 제거 꺼짐 수정 (현슈, 실기기 없이, PR #12 → `main` `71126d5`)** — `docs/streaming-plan.md` 5-6절: ① 반복 보호가 앱 요청 값을 지워 경로가 바뀌어도 다시 안 켜지던 것 → 요청과 반복 보호를 나누고 장치 변경 때 다시 켬(코드로 원인 확인) ② 통화에서만 꺼지던 것 → expo-audio `setAudioModeAsync` 가 통화 세션을 덮어쓴 것으로 추정, 앱은 통화 중 막고(`src/audio/sessionOwner.ts`·`audioMode.ts`) 네이티브는 감지해 되돌림(`session_overwritten`). 타입 검사·단위 52·Swift 모듈 컴파일 통과, **실기기 확인 전 → 장태웅이 `docs/testguide.md` 4-12절**
- **10-22 결정 (사용자)**: 10/30 시연에 Android·iPhone 모두 사용, **모든 시험은 장태웅이 이 PC 에서** (현슈 Mac 아님)
- **2026-10-19–22 현슈 작업 (PR #2–#10, `main` `3d72cad`)** — 상세는 2절 "보안 검사"·"말하는 도중 원문 자막"·"전사 전용 세션"·"반이중 메아리 차단"·"말 끝 판단 변경"
  - **AWS 시드니 배포** (#2, `deploy/README.md`): https://syncrew.hyunshu.com, EC2 + RDS + Docker Compose(Caddy). 운영 10/20–10/31, **10/30 현장 시연, 10/31 모두 삭제**. 로컬 PC 실행도 그대로 된다
  - **노이즈 필터** (#4·#6, `docs/denoise-sidecar.md`): GTCRN 사이드카(`denoise/`) + 서버 연결 `STREAM_AUDIO_FILTER=sidecar`. 켤지는 받아쓰기 CER 비교로 결정(10/27)
  - **iPhone 실기기 2차(10-19, 스피커, 시드니 서버, LTE)에서 나온 문제를 서버·앱 JS 에서 수정** (#8): ① 2번째 말부터 번역 안 됨 → 말 끝은 OpenAI 서버 VAD 만 정함(수동 commit 제거) ② 스피커 메아리 → 상대 통역 재생 중 내 조각을 무음으로(반이중) + 앱이 실제 재생 시작/끝을 알리는 `stream:playing` ③ 내 말 자막 늦음 → 전사 전용 세션 + `gpt-live-transcribe`(말 시작 0.5–0.8초 뒤 자막, $0.017/분) ④ 스트리밍에도 현장 용어집. **①–④ 모두 실기기 재확인 전** (실제 OpenAI 로는 스크립트끼리 확인)
  - **성능** (`docs/perf-app-2026-10-20.md`·`docs/perf-network-2026-10-20.md`): 앱 번들 Android −18%·iOS −19%, 통화 화면 다시 그리기 감소, 끊긴 LTE 를 20초 안에 감지, 서버 리샘플·base64 가속. 측정 도구 `server/scripts/stream-latency.ts`
  - **보안 검사** (#9·#10): 발견 12건(높음 이상 없음) 중 9건 수정 + 화면 캡처 정적 서버. **F12(같은 언어 통화 대량 조각 → 앱 메모리, LOW) 미해결**
  - 실제 OpenAI 사용: 10-19–20 확인에 약 $0.18 (시드니 DB 누적 $0.26 — 이 PC 서버 DB 누적과는 따로)
  - **네이티브 모듈(`frontend/modules/syncrew-duplex/`)은 10-18 이후 바뀌지 않았다** → 아래 "iOS 통화 시작 때 에코 제거가 꺼지는 문제"는 그대로 남아 있다(서버 반이중 차단이 그 영향을 줄이는 보완책)
- **2026-10-23 새벽 Android S3 실기기 시험 (장태웅, 이 PC, Galaxy Note 9 SM-N960N Android 10 + Sony WH-1000XM6, `ENGINE=fake`, 비용 0)** — `docs/device-test-log.md`
  - 통과: 점검 화면(헤드셋·스피커·실행 중 전환), **F 스트리밍 통화**(헤드셋·스피커·통화 중 전환·종료), **C 재시험 문장 단위 + 헤드셋 마이크**(10-14 S22 무음 → **SCO 열림, 녹음됨**), 같은 언어 통화(상대 목소리가 헤드셋으로 들림)
  - 고친 버그 2개 (10-23 커밋): ① `CallRoute.kt` Android 11 이하에서 `startBluetoothSco` 2번·`stop` 1번 → 멈춘 뒤에도 SCO 가 남음 → 한 번만 시작·끔 ② `useHandsFree.ts` 조용할 때 -160 을 계속 보내는 헤드셋에서 문장 단위 말 끝을 못 봐 세 문장이 16.8초로 묶임 → -160 이 300ms 연속이면 무음으로 처리. 서버 시험 영향 없음, 앱 타입 검사·단위 46 통과
  - 알게 된 것: **걸려 온 전화는 그 현장 화면 안에 있을 때만 뜬다**(현장 목록에서는 안 뜨고 30초 뒤 부재중) — 시연 때 받는 사람이 미리 그 현장에 들어가 있어야 함. 바꿀지 결정 필요
  - e2e 시험 계정 비밀번호를 이 PC 에서 다시 정함(사용자 승인) — 다른 PC 의 `server/.e2e-accounts.json` 은 이제 맞지 않음, 이 PC 파일을 전달할 것
  - **실제 OpenAI (10-23 새벽, $0.161, DB 누적 $0.498)**: G 스피커 에코 루프 **통과**(되돌아간 턴 0), 스트리밍 통역 스피커·헤드셋으로 들림 **통과**. **실패 2건**: ① 스트리밍 원문(받아쓰기)이 한 턴씩 밀림(번역은 정확) — 전사 전용 세션 짝 맞추기 의심, 미조사 ② **문장 단위 통화의 통역 음성이 헤드셋에서 안 나옴** — expo-audio 재생기가 미디어 용도라 A2DP 로 나가는데 헤드셋이 통화 모드(SCO)라 소리 없음. 고치는 방법 결정 필요
  - **10-23 새벽 수정·재시험 (누적 $0.709)**: ① 원문 밀림 = 서버 VAD 가 쉼을 못 봄(앱이 말 끝 뒤 0.6초만 보내 꼬리 잡음이 무음 500ms 를 못 채움) → `streamHub.ts` 가 `stream:pause` 때 무음 0.7초 주입 → **통과** ② 문장 단위 통역 음성 헤드셋 재생 → 네이티브 `playInCall`(통화 용도) + Android 에서 expo-audio `setAudioModeAsync` 가 스피커폰을 강제하지 않게 + CallRoute 모드 재지정·SCO 재연결 → **헤드셋 통과**. 미확인: 헤드셋 없을 때 문장 단위 통역이 스피커로 나오는지(수화기 아닌지), iPhone 에서 이번 JS 변경(playback·useHandsFree 는 Android 분기만) 영향 없음 확인. 상대 스크립트 `--continuous` 옵션 추가
  - **이어서 (03:4x, 무선 adb, 누적 $0.750)**: 문장 단위 통역 스피커 재생 **통과**(수화기 아님), **H 통화 중 Wi-Fi 끊김 통과**(재연결 뒤 통화·통역 계속). **Android 단독 시험 끝** — 남은 것: S4 2대 통화, Android 12+ 기기
  - **알려진 문제 (10-23 발견)**: 서버 시험 `test/sidecarStreamFilter.test.ts` "모든 조각이 사이드카를 거쳐 순서대로 전달된다" 가 간헐 실패(5번 중 2번 — 첫 두 조각이 필터를 거치지 않고 통과, 타이밍 의존 추정). 10-23 변경과 무관한 코드(PR #6). 다시 돌리면 248 통과. 고칠 것
  - **무선 adb 방법 (Note 9, Android 10)**: USB 로 한 번 `adb tcpip 5555` → `adb connect <폰 IP>:5555` → 케이블 뽑기. 휴대폰에서 "항상 허용" 이 저장돼 있어야 함(안 되면 개발자 옵션 "USB 디버깅 권한 승인 취소" 후 다시 허용). Metro 는 무선 adb 위로 `adb reverse tcp:8081 tcp:8081`(개발 빌드가 localhost:8081 을 찾음), 서버 API 는 `.env` 를 Mac Wi-Fi 주소(`http://192.168.45.160:4000`)로. 이 Wi-Fi(SK_E850)는 기기 간 통신 허용. USB 연결은 노트북 배터리를 많이 써 10-23 새벽 노트북이 꺼졌다 — 충전기 연결 권장
- **2026-10-22 이 PC 기준선 (pull 직후, 비용 0)**: 서버 타입 검사 + 시험 **248 통과·1 건너뜀**(실제 사이드카 시험, `DENOISE_TEST_URL` 없음), 앱 타입 검사 + 단위 **46/46** 통과. 앱 의존성이 바뀌어 `frontend` 에서 `npm ci` 먼저 실행. e2e(데모·live·마이크)는 이번에 돌리지 않음
- **2026-10-17 밤 S3 iOS 실기기 시험 (새 담당자 현슈, iPhone 15 Pro Max + AirPods Pro, `ENGINE=fake`, 비용 0) — 커밋 `4fd2d9d`, PR #1 로 `main` 병합(`76cac8b`, 10-18)**
  - 통과: 점검 화면(스피커·에어팟·통화 중 전환), **F 스트리밍 통화**(상대 `call-peer.ts`, 12턴, 에어팟 마이크 포함)
  - 고친 버그 1개 (iOS 네이티브): voice processing(에코 제거)을 켠 엔진이 켜지자마자 설정 변경 알림으로 멈추고, 다시 만들면 또 멈추는 무한 반복 → 48kHz 고정 + 블루투스에서는 voice processing 안 씀 + 반복 보호(10초에 4회 넘으면 에코 제거 끄고 재구성, 8회 넘으면 멈추고 `onError`) + DEBUG 진단 로그 `[duplex-diag]`. 상세 2절 "S3 iOS 실기기 시험", `docs/device-test-log.md`
  - **⚠ 남은 핵심 문제: 실제 통화(F)에서는 스피커로 시작해도 반복 보호가 걸려 에코 제거가 꺼진 채 통화했다** (점검 화면에서는 켜져 있었음). 통화 도중 에어팟 → 스피커로 바뀔 때도 꺼진 채 남는다. 실제 OpenAI 로 하는 G(스피커 에코 루프) 시험에서 실패할 가능성이 크다 → 7절 1번 작업
  - 하지 않음: G·H(가짜 엔진은 통역 음성이 거의 무음이라 에코를 볼 수 없음 → 실제 OpenAI 필요), Android 전부(새 담당자에게 Android 기기 없음)
- 이전 (10-17 낮, 커밋 `74a7969`): 실기기 없이 마무리 — S3 코드 재점검, 혼합 통화 무음 버그 수정(`E2E_MIXED`), 상대 역할 스크립트 `server/scripts/call-peer.ts`, OpenAI 가격 대조. 2절 "실기기 없이 마무리 (2)"
- 서버·앱 기능은 대부분 완성. 웹·에뮬레이터 검증 완료. 실기기: 문장 단위 통화는 Android·iPhone 양쪽(10-14 밤 T2), **스트리밍은 iPhone 만**(10-17 밤)
- 진행 중인 큰 작업: **Phase 7 = 1:1 통화 "진짜 스트리밍 통역"** (지연 약 6초 → 2초 이하)
  - S1 서버·S2 웹 완료(실제 OpenAI 확인), S3 네이티브 오디오 구현 완료(자체 Expo 모듈 `frontend/modules/syncrew-duplex/`), **S3 실기기 시험은 iOS 일부 통과·Android 미실시**. 휴대폰 앱이 통화를 걸면 스트리밍으로 연결을 시도하고, 안 되면 자동으로 문장 단위. 상세 `docs/streaming-plan.md` 5-3·5-4절
  - **다음 할 일 = 7절** (① iOS 통화 시작 때 에코 제거가 꺼지는 문제 확인·수정 → ② 실제 OpenAI 로 iOS G·H → ③ Android 기기가 있는 사람이 Android S3 → ④ S4 휴대폰 2대)
- **작업 환경이 두 곳이다 (2026-10-18 기준)** — 새 세션은 어느 쪽인지 먼저 확인한다

| 환경 | 사람 | 기기 | 비고 |
|---|---|---|---|
| 이 PC (`/Users/taewoongjang/...`) | 장태웅(팀장) | 10-14–15 T2 때 쓴 Galaxy S22 + Buds2, iPhone 17 Pro + AirPods Pro (지금도 쓸 수 있는지는 매번 확인) | **디스크 여유 9.0GB (10-22)** — 네이티브 빌드에는 15GB 이상 필요. 서버 DB(`server/.pgdata`)·e2e 계정 파일·`.env` 가 여기 있음 |
| 현슈 Mac | 현슈(새 담당자, 10-17 인수) | iPhone 15 Pro Max(iOS 26.6.1) + AirPods Pro. **Android 없음** | iOS 서명은 본인 개인 팀 + 번들 ID `com.syncfield.syncrew.hyeonsyu` 로 빌드함 (저장소 `app.json` 기본값은 `com.syncfield.syncrew`) |

- T2 실기기 (이 PC, 10-14–15): Galaxy S22 + Galaxy Buds2, iPhone 17 Pro + AirPods Pro (연결은 매번 확인)
  - T2 결과 (10-14 밤–10-15): 문자 수신·문장 단위 통화 양쪽 통과, iPhone 헤드셋 통과, **Android 헤드셋 마이크 무음(SCO 미시작) → S3 에서 처리, 재시험 필요**. 실기기에서만 드러난 버그 6개 수정(커밋 `0c995ad`) — `docs/implementation-plan.md` T2 절, `docs/device-test-log.md`
  - 네트워크: 일반 Wi-Fi 는 기기 간 통신 막힘. Galaxy 핫스팟에 Mac·iPhone 무선 접속 가능, Galaxy 자신은 USB 터널(`adb reverse`). 두 휴대폰 동시(S4)는 둘 다 핫스팟 손님인 구성 필요(미시험)
  - iOS 개발 빌드는 빌드 때 Mac 주소가 앱에 들어감(`ip.txt`) → 네트워크가 바뀌면 다시 빌드 (7절 명령)
- 자동 시험: **10-22 이 PC — 서버 248(+1 건너뜀), 앱 단위 46 통과**. e2e 마지막은 10-17(데모 99, live 43 + `E2E_MIXED` 18, 마이크 2 는 10-15) — 10-19–22 변경 뒤 이 PC 에서는 아직 다시 돌리지 않음 (현슈 브랜치에서 live e2e 수정 `c6c3a74` 있음)
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
| S3 iOS 실기기 시험 | iPhone 15 Pro Max + AirPods Pro: 점검 화면·F 스트리밍 통화 통과, **iOS voice processing 무한 재시작 버그 수정**, `app.json` iOS 번들 ID 추가 (아래 상세). Android·G·H 미실시 | `4fd2d9d` (PR #1) |

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

#### S3 iOS 실기기 시험 — 2026-10-17 밤 (현슈, 커밋 `4fd2d9d`)
- 기기: iPhone 15 Pro Max(iPhone16,2, iOS 26.6.1) + AirPods Pro(HFP). 서버 `ENGINE=fake`(비용 0), 상대 역할 `server/scripts/call-peer.ts`(구성원 vi)
- **빌드·접속 시행착오** (네트워크): ① Xcode 계정 로그인 만료 → 재로그인 ② Mac 이 iPhone 핫스팟으로 자동 전환돼 앱에 박힌 Mac 주소와 어긋남 → "No script URL" ③ 집 Wi-Fi 에서 핫스팟을 함께 켜 두면 Metro 전송이 13KB/s 로 느려짐 ④ iPhone 핫스팟(USB)은 Safari 로도 Mac 에 닿지 않음 → **핫스팟 끄고 Mac·iPhone 을 같은 Wi-Fi(5GHz)에** 두니 정상
- **버그: voice processing 무한 재시작** (`frontend/modules/syncrew-duplex/ios/SyncrewDuplexModule.swift`)
  - 증상: 점검 화면이 시작은 되는데 녹음 조각 0개, 시험음·녹음 재생 안 됨. 에어팟에서는 경로는 bluetooth 로 잡히는데 소리가 안 나고 캡처가 멈춤
  - 원인: voice processing 을 켠 `AVAudioEngine` 이 시작 직후 `AVAudioEngineConfigurationChange` 로 멈추고, 원래 코드는 알림마다 엔진을 새로 만들어 **0.4초(스피커)·약 1초(블루투스 HFP) 간격으로 끝없이 반복**. 스피커에서는 간헐적, 블루투스 HFP 에서는 항상. 입력 48kHz·출력 44.1kHz 불일치가 원인으로 추정
  - 수정: ① 세션 샘플레이트 48kHz 고정(`setPreferredSampleRate`) ② **블루투스 경로에서는 voice processing 을 쓰지 않음**(`shouldUseVoiceProcessing()` — HFP 헤드셋은 되울림 구조가 아니고 자체 처리 있음) ③ 경로 변경으로 켜야 할지가 바뀌면 엔진 재구성 ④ 반복 보호 `recoverEngine()`: 10초 안에 4회 넘으면 에코 제거를 끄고(`voice_processing_loop` 경고) 재구성, 8회 넘으면 멈추고 `onError`(`restart_loop`) ⑤ DEBUG 빌드 전용 진단 로그 `[duplex-diag]` (보는 법: `xcrun devicectl device process launch --console …`)
  - 에코 제거 끄기는 그 통화(세션) 동안만 유지된다 — 다음 `start()` 때 앱이 넘긴 값으로 다시 켠다
- 결과 (수정 후):
  - 점검 화면 스피커: 조각 간격 100ms(최대 103), 말할 때 -15dB, **시험음 중 마이크 -62dB(에코 제거 동작)**, 시험음·녹음 재생 들림
  - 점검 화면 에어팟: 시험음·녹음 재생 들림, 조각 100ms. 시험음 중 에어팟 마이크 -25dB(말소리 -20dB) — 에코 제거 없음. 통화에서 상대 음성이 되돌아가는지는 실제 OpenAI 로 봐야 함
  - 통화 중 전환: 에어팟 → 스피커 약 2.6초 공백 뒤 스피커로, 스피커 → 에어팟 바로. **스피커로 바뀌면 voice processing 을 켜다 반복 4회 → 보호 장치가 꺼서 에코 제거 없이 남음** (알려진 한계)
  - **F 스트리밍 통화 통과** (약 3분): iPhone 발화 12턴이 스트리밍 조각으로 상대 도착(조각 100ms, 첫 조각 약 0.8s = 가짜 엔진 지연, 음량 -15~-18dB), 턴마다 기록 도착, 경로 보고 builtin→bluetooth→builtin→bluetooth 정상, 에어팟 마이크로 말한 턴 정상. **단, 통화 시작 때 스피커에서 반복 보호가 걸려 에코 제거가 꺼진 채 진행**(`voice_processing_loop` 경고 1건). 한국어 한 문장이 0.2초짜리 턴으로 쪼개진 경우 있음(가짜 엔진 VAD)
  - 미확인: 통화 화면의 자막·"통화가 끝났어요" 표시(사용자가 "실시간 통역 · 말하는 동안 전송" 작은 칩을 알아채지 못함 — 동작은 로그로 확인)
- 하지 않음: G·H(실제 OpenAI 필요), Android 전부(기기 없음)
- 자동 시험: 이 커밋은 Swift·`app.json`·문서만 바꿈 → 서버·앱 JS 시험 대상 변화 없음. **수정된 Swift 는 현슈 Mac 에서 실기기 빌드로만 확인됨** (이 PC 에서는 다시 빌드하지 않음)

### 🟡 진행 중
- **⛔ 이 PC 의 디스크 여유 9.0GB** (2026-10-22, 10-18 8.1GB) — 네이티브 빌드에는 15GB 이상 필요. 이 PC 에서 실기기 작업 전에 `df -h /System/Volumes/Data` 로 확인하고, 모자라면 사용자에게 알린다 (7절 "시작 전에"). 현슈 Mac 은 해당 없음
- **Phase 7 스트리밍 — S3 실기기 시험**: iOS 점검 화면·F 통과(10-17 밤), 10-19 iPhone 2차 시험에서 나온 문제는 서버에서 수정(실기기 재확인 전). 남은 것: 10-19–20 수정의 실기기 재확인, iOS 통화 시작 때 에코 제거가 꺼지는 문제(→ 10-23 PR #12 `71126d5` 로 수정, 실기기 확인 전 — `docs/testguide.md` 4-12절), iOS G·H(실제 OpenAI), Android 전부 (7절)
- **10/30 현장 시연 준비** (시드니 서버 `https://syncrew.hyunshu.com`) — 10/31 AWS 자원 삭제(`deploy/README.md` 8절)
- T2 남은 것: D(일괄 지시)·E(비밀번호 메일 링크) 양쪽, 헤드셋으로 통역 듣기

### ⬜ 미완료 (아직 하지 않음)
0. **디스크 공간 확보** (사용자, 15GB 이상, 10-22 9.0GB) — 이 PC 에서 하는 실기기 작업의 선행 조건
1. ~~실기기 준비~~ ✅ / ~~T2 기준선~~ 🟡 (D·E 남음)
2. **S3 실기기 시험**: iOS ✅ 10-24(F·G·H·문장 단위 통과, 스피커 에코 제거 꺼짐만 미해결 → 조현수, 시연 지장 없음) / Android ✅ 10-23 → **S4 휴대폰 2대 통화** → **S6 실기기 튜닝**
4. ~~실제 노이즈 필터 구현~~ 🟡 GTCRN 사이드카(`denoise/`, #4)와 서버 연결(`STREAM_AUDIO_FILTER=sidecar`, #6) 완료 (2026-10-19). 남은 것: 받아쓰기 CER 비교로 켤지 결정 (10/27), 시드니 EC2에서 `--profile denoise` 로 실측
5. 현장 용어 데이터 보강 — **2026-10-23 장태웅이 이전받음**, 기준 문서 `docs/field-terms.md`. 방침: 언어별 데이터셋 대신 **은어 → 표준 한국어** 중심 + 검증 문장(고용노동부 다국어 안전표지, 이용 확인받음)·실측에서 틀린 단어만 언어별. 다음: ① 스트리밍 한국어 뜻 용어집(코드, 비용 0) ② ko→zh 실측($0.05–0.1, 승인 후) ③ 안전표지 검증 문장 넣기 ④ 은어 데이터 보강 — **10-23 ①③④ 반영(미커밋, `docs/field-terms.md` 7절)**: 공단 은어 210개·안전표지 검증 문장 19개(ko·vi·zh·uz)·스트리밍 한국어 은어 뜻, 데스라·아나방 공단 기준으로 대체, 기존 seed 의 표준어→은어 보정 문제 해결(보정은 받아쓰기 오인식형만 + 변형 목록 정리, 7-4절), 서버 257 통과. **10-24 스트리밍**: 턴 용어 실험(자막이 은어를 잘못 받아써 효과 없음, 기본 off) → 미리 넣는 은어를 230개 전부로(지시문 상한 7,500자), 목록 밖 은어 7문장 2 → 5 맞음, 실제 OpenAI $0.407(누적 $1.157) (`docs/field-terms.md` 8절). 이어서 받아쓰기 keywords 에 은어 230개 → 원문 자막 은어 0–1 → 4/11, 번역 6/7($0.109, 누적 **$1.266**, 9절). 남은 것: 평범한 문장·ko→vi 에서 키워드 부작용 확인(S6). 기준 자료는 안전보건공단 「산업현장 및 법률 용어 유의어 사전」(data.go.kr 15161288, 이용 제한 없음, 우리 은어 56개 중 32개 포함). 데스라는 공단 기준(데스라=출력 인원, 데스리=난간)으로 대체함 (`docs/field-terms.md` 4·6·7절)
7. 보안 F12 (같은 언어 통화에서 대량 조각 → 듣는 쪽 앱 메모리, LOW): 조각마다 최소 시간 + 네이티브 재생 큐 상한 (2절 보안 검사)
8. **10/31 AWS 시드니 자원 삭제** (`deploy/README.md` 8절)
※ 실기기 없이 할 수 있는 일은 10-17 에 한 번 끝났고, 10-19–22 에 실기기 발견 수정·성능·보안 작업이 더해졌다. 남은 실기기 밖 일은 7(F12) 정도 — 1–2 는 실기기, 4 는 다른 팀원, 5 는 장태웅(현장 용어), 6 은 사용자 결정으로 나중
6. 나중에(사용자 결정): UI 문구 원어민 검수, 업무용 메일 서비스, 우즈베크어 통역 품질(보류), ~~용어집 지시문(보류)~~ ✅ 2026-10-19 스트리밍에도 적용, 백그라운드 통화 유지, 그룹 실시간 통역, 푸시 알림

### ❓ 미확인 (확인하지 못한 것 — 완료로 보지 말 것)
- **S3 네이티브 오디오 — Android**: 10-23 Note 9(Android 10)에서 점검 화면·F·C·같은 언어 통화 통과. 남은 것: 실제 통역 음성 재생·스피커 에코(G), Android 12+ 기기(`setCommunicationDevice` 경로), 무선 네트워크에서 끊김
- **10-19–20 수정의 실기기 동작**: 2번째 말 이후 번역(서버 VAD 만 사용), 말하는 도중 "나" 자막(`gpt-live-transcribe`), 폰 재생 신호 메아리 차단(`stream:playing`, `echoDropped`), 경량화한 앱 번들(QR·Supabase auth-js·Proguard)의 네이티브 빌드·실행 — 모두 스크립트·웹·정적 분석으로만 확인
- **S3 네이티브 오디오 — iOS 에서 아직 못 본 것**: 실제 목소리 통역 재생(가짜 엔진 음성은 거의 무음), 스피커 에코 루프 없음(G), Wi-Fi 끊김·같은 언어(H), 지연 측정, 통화 화면 자막·종료 표시, 에어팟 사용 중 상대 통역이 내 마이크로 되돌아가는지
- 문장 단위 폴백에서 Android 헤드셋 마이크가 이제 소리를 받는지, 그때 통역 재생(expo-audio, media 용도)이 헤드셋으로 나오는지
- 백그라운드 통화, 두 휴대폰 동시 접속 네트워크
- 비밀번호 재설정 메일 링크 → **휴대폰에서 앱이 열리는지**
- 받아쓰기 "비계 → 기계" 오류가 **사람 목소리에서도** 나는지 (합성 음성에서만 확인)
- 사람이 귀로 듣는 통역 소리 품질·체감 지연 (헤드리스 브라우저는 소리를 못 들음)
- 웹 브라우저의 실제 확인 창(관리자 지정 등)은 사람이 눌러 본 적 없음 (e2e 는 확인 창을 자동 "확인"으로 바꿔 시험)
- 휴대폰 앱이 `stream:out:audio` 이진 조각을 받아 **소리로** 재생하는 경로 (iPhone F 에서 조각 수신·재생 예약 로그는 있으나 가짜 엔진 음성이 거의 무음이라 귀로는 미확인)

---

## 3. 개발 환경 및 핵심 정보

### 위치와 도구
- 프로젝트: **`/Users/taewoongjang/PlayGround/SYNCREW`** (2026-10-14 영문 경로로 이동. 예전 경로 `/Users/taewoongjang/PlayGround/그동안 했던 프로젝트들/SYNCREW` 는 없음)
- GitHub: https://github.com/jang-tang/SYNCREW (`main`)
- macOS, Node 22, npm, Chrome(`/Applications/Google Chrome.app`, e2e 용), Xcode + iOS 시뮬레이터(iPhone 17 Pro 등), Android 에뮬레이터 `Pixel_9_Pro_XL`(SDK `~/Library/Android/sdk`)
- **Android 빌드는 JDK 21**: `export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home` (기본 JDK 26·Android Studio JDK 25 는 CMake 단계 실패)
- 디스크 여유 (이 PC): 19GB(10-14) → 약 2GB(10-17) → **8.1GB(10-18)**. 네이티브 빌드 전 `df -h /System/Volumes/Data` 확인 (15GB 이상)
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
| `frontend/src/audio/duplex/` | 이중 오디오 인터페이스(`types.ts`) + 웹 구현(`web.ts`) + 네이티브 어댑터(`native.ts`), 기기별 선택·Android 통화 경로(`index.ts`) |
| `frontend/modules/syncrew-duplex/` | **S3 자체 Expo 모듈**: iOS `ios/SyncrewDuplexModule.swift`, Android `android/.../DuplexEngine.kt`(녹음·재생)·`CallRoute.kt`(통신 모드·블루투스 SCO)·`SyncrewDuplexModule.kt` |
| `frontend/src/app/audio-check.tsx` | 개발용 오디오 점검 화면 `syncrew:///audio-check` (경로·조각 간격·음량·시험음·에코·녹음 재생) |
| `frontend/src/audio/useStreamingCall.ts` | 스트리밍 통화 훅 (VAD 게이트·재생·자막·폴백) |
| `frontend/src/audio/useHandsFree.ts` | 문장 단위 통화(폴백) 훅 |
| `frontend/src/audio/streamed.ts` | 중복 재생 방지 기록 |
| `frontend/src/app/site/call/[id].tsx` | 1:1 통화 화면 |
| `frontend/src/services/live/`, `mock/` | 실제 서버 / 데모 모드 서비스 (계약을 바꾸면 둘 다) |
| `frontend/e2e/` | 헤드리스 Chrome 자동 시험 (`flows.mjs` 데모, `live.mjs` 실서버 2인, `mic.mjs`) |
| `server/scripts/` | **`call-peer.ts`(실기기 시험용 통화 상대, 7절)**, `stream-measure.ts`, `translate-compare.ts`, `stt-hint-compare.ts`, `openai-check.ts`, `e2e-accounts.ts`, `db.ts` |

### 설정 (값은 적지 않는다 — 비밀 값은 `.env` 에만)
- `server/.env` 키: `HOST PORT DATABASE_URL OPENAI_API_KEY OPENAI_BUDGET_USD(=20, 10-25) OPENAI_BUDGET_PERIOD(=total) STT_MODEL(=gpt-4o-transcribe) TRANSLATION_MODEL(=gpt-realtime-2.1) SUPABASE_URL SUPABASE_JWKS_URL SUPABASE_SECRET_KEY AUDIO_PREPROCESSOR DATASET_* RETENTION_*` 등. 스트리밍 설정 `STREAMING STREAM_MAX_SESSIONS STREAM_VAD_SILENCE_MS STREAM_AUDIO_FILTER` 는 기본값 사용(`server/.env.example` 참고)
- `frontend/.env` 키: `EXPO_PUBLIC_API_MODE`(**지금 `mock`** = 데모 모드), `EXPO_PUBLIC_API_BASE_URL`(**지금 `http://10.0.2.2:4000`** = Android 에뮬레이터에서 본 PC), `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, (선택) `EXPO_PUBLIC_STREAMING=off`
- 앱: 이름 SYNCREW, Android 패키지·iOS 번들 `com.syncfield.syncrew`, URL scheme `syncrew`, 권한: 마이크(expo-audio 문구)·카메라(QR) (`frontend/app.json`). Android 오디오 권한은 S3 모듈 매니페스트가 넣는다(`MODIFY_AUDIO_SETTINGS`, Android 11 이하 `BLUETOOTH`). `BLUETOOTH_CONNECT` 는 넣지 않았다 — Android 12+ `setCommunicationDevice` 에는 필요 없다고 보고 구현함, **실기기에서 확인**
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
cd frontend && npm run typecheck && npm run test:unit # 22개
cd frontend && npm run bundle:web && npm run e2e      # 데모 99개
cd frontend && npm run bundle:web:live && npm run e2e:live   # live 43개 (ENGINE=fake 서버 + DB 실행 중이어야 함)
cd frontend && E2E_MIXED=1 npm run e2e:live            # 한쪽만 스트리밍 통화 18개 (서버를 ENGINE=fake STREAM_MAX_SESSIONS=1 로)
# 실기기 시험용 통화 상대 (7절)
cd server && npx tsx scripts/call-peer.ts             # --answer / --utterance / --as manager / --listen
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
- 무엇: 휴대폰에서 "녹음하면서 동시에 PCM 조각 재생 + 에코 제거 + 블루투스 HFP" — 웹은 되지만 `expo-audio`(녹음 파일 단위)로는 스트리밍 불가
- 한 것 (2026-10-15): 라이브러리 후보(`react-native-audio-api` 등, `docs/s0-report.md` 2절)는 Android 블루투스 SCO 경로 지정이 안 돼 **자체 Expo 모듈** `frontend/modules/syncrew-duplex/` 로 구현. JS 는 `frontend/src/audio/duplex/native.ts` 어댑터로 `DuplexAudio` 인터페이스를 그대로 따른다. 문장 단위 폴백에서도 Android 는 `enterCallRoute()` 로 SCO 를 연다. 상세 `docs/streaming-plan.md` 5-3절
- 10-17: 코드 전체 재점검(결함 없음, 실기기에서 볼 점 4개 — 2절 "실기기 없이 마무리 (2)"), 혼합 통화 무음 버그 수정
- 남은 것: **실기기 시험** (7절 순서). 고칠 것이 나오면 모듈 안에서 고친다
- 완료 기준 (iOS·Android 각각): 휴대폰 스피커·마이크와 블루투스 헤드셋에서 캡처+재생 동시, 상대 통역이 내 마이크로 다시 번역되는 에코 루프 없음, 프레임 간격·끊김 측정값 기록. 웹 e2e·서버 시험 회귀 통과
- 주의: 앱 다른 코드는 `DuplexAudio` 에만 의존하므로 다른 파일은 바꾸지 않는 것이 원칙. 블루투스 확인이 안 되면 S6 로 넘겨도 된다(사용자 결정)

### T4. S4 휴대폰 2대 1:1 스트리밍 통화 ⬜ — 선행: T3
- 무엇: Android ↔ iPhone 통화로 스트리밍 전체 확인 (가짜 엔진으로 기능, 실제 OpenAI 로 지연)
- 완료 기준: 계획 완료 기준 1–5 (`docs/streaming-plan.md` 1절) 중 기능 항목 통과, 실제 OpenAI 몇 회 지연 측정 기록
- 주의: 실제 OpenAI 비용 약 $0.2–0.5 (실행 전 안내, 실행 상한)

### T5. S6 실기기 튜닝 ⬜ — 선행: T4
- 무엇: 20회 이상 지연 측정(P50·P90), 무음 판단 300–400ms(`STREAM_VAD_SILENCE_MS`)·추론 minimal(`TRANSLATION_REASONING`) 실험, 현장 소음, 블루투스, 배터리·발열
- 완료 기준: P50 ≤ 2.0초·P90 ≤ 3.0초 결과표, `docs/live-interpretation.md`·운영 문서 갱신
- 주의: 비용 약 $3–6 → 서버 한도(`OPENAI_BUDGET_USD`, 10-25 $20, 누적 $17.26) 상향 전 금액 안내·승인

### T6. 실기기 전용 확인 묶음 ⬜ — 선행: T1 (T2 와 함께)
- 비밀번호 재설정 메일 링크 → 앱 열림 → 새 비밀번호 저장 (요청한 같은 휴대폰에서 메일을 열어야 함 — PKCE)
- 사람 목소리로 받아쓰기 확인 ("비계", "거푸집", "B문", 숫자)
- 작업조·관리자 지정·대상 선택 화면의 네이티브 표시
- 완료 기준: `docs/device-test-log.md` 기록

### T7. 다른 팀원·나중 작업 (지금 진행 대상 아님)
- 실제 노이즈 필터: `server/src/plugins/streamAudioFilter.ts`(조각, 50ms 제한) / `audioPreprocessor.ts`(문장 전체, 3초 제한)에 등록 — `docs/operations.md` 5절
- ~~현장 용어 데이터 보강~~ → 2026-10-23 장태웅 담당으로 이동 (`docs/field-terms.md`)
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
- **OpenAI 비용**: 충전 잔액 $80 이지만 "막 쓰지 말 것". 서버 한도 `OPENAI_BUDGET_USD=20`(누적, 10-25 상향, 누적 $17.26). **실제 호출 전 예상 비용을 말하고 실행 상한을 건다.** 한도를 올릴 때는 금액을 먼저 알린다. 흐름 확인은 `ENGINE=fake`
- 번역 모델 **`gpt-realtime-2.1` 유지**, 번역 전용 `gpt-realtime-translate` 는 쓰지 않음 (현장 용어·숫자 오역 6/9, 지시문·용어집 불가, 우즈베크어 출력 불가 — `docs/s0-report.md` 4절)
- 받아쓰기 `gpt-4o-transcribe`, 현장 용어 힌트는 쓰지 않음 (오히려 나빠짐 — `docs/streaming-plan.md` 5-2절)
- 스트리밍은 **1:1 통화만**, 일괄 지시는 문장 단위 유지. 같은 언어 통화는 OpenAI 없이 음성 직접 전달. 실패한 문장은 기록 안 함. **스트림으로 들은 문장은 다시 재생하지 않음**
- OpenAI 세션 안 문맥은 응답마다 삭제, 직전 1–2문장을 텍스트로 지시문에 (DB 기록은 그대로)
- 음성 경로: 우리 서버 경유(Socket.IO + PCM). 발화 단위 방식은 폴백으로 유지
- 목표 지연 P50 ≤ 2.0초·P90 ≤ 3.0초 (1.5초는 S6 목표)
- **시험은 iOS·Android 모두**. 먼저 구현하고 실기기에서 고친다
- 노이즈 필터는 **서버**에서. 현장 용어 데이터는 어댑터로 교체 (코드에 용어를 넣지 않는다)
- 현장 용어: 언어별 데이터셋을 처음부터 만들지 않고 **은어 → 표준 한국어** 를 중심에 둔다. 언어별 번역은 검증 문장과 실측에서 틀린 단어만 (2026-10-23, `docs/field-terms.md` 0절)
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
- ~~`frontend/android/app/.cxx` 등 빌드 캐시에 예전 한글 경로~~ → 2026-10-17 삭제함. 다음 Android 빌드는 처음부터(시간이 더 걸림)
- **한쪽만 스트리밍하는 통화**(10-17 수정): 서버는 듣는 사람의 방식과 상관없이 `stream:out:*` 를 보낸다. 앱이 이걸 "들었음"으로 처리하면 문장 단위 쪽이 무음이 된다 → 스트리밍 관련 수정 후에는 `E2E_MIXED=1` e2e 도 돌린다. "받지 않아야 함" 류 시험은 반드시 대조군과 함께 (수정 전 코드로 실패하는지 확인)
- 디스크가 모자라면 에뮬레이터가 켜지지 않거나(`hasSufficientDiskSpace` FATAL) 켜다가 비정상 종료한다(10-17) — 에뮬레이터·빌드 전에 `df -h` 확인
- macOS 에는 `timeout` 명령이 없다 → 백그라운드 실행 후 `kill -INT <pid>` 로 끝낸다 (`call-peer.ts` 는 Ctrl+C=SIGINT 에 통화를 끊고 나감)
- live e2e 에서 통화 방식 문구는 연결 중에 "문장 단위"가 잠깐 보인다 → 스트리밍 문구를 먼저 기다린 뒤 판단
- **iOS voice processing + 블루투스 HFP 는 같이 쓰지 않는다** (10-17 밤): 같이 켜면 엔진이 설정 변경으로 끝없이 재시작된다. 스피커에서도 간헐적으로 반복된다 → 반복 보호가 에코 제거를 끈다. iOS 오디오 문제를 볼 때는 DEBUG 빌드의 `[duplex-diag]` 로그부터 본다 (`xcrun devicectl device process launch --console --device <ID> com.syncfield.syncrew…`)
- **iPhone 실기기 네트워크** (10-17 밤): Mac 이 iPhone 핫스팟으로 자동 전환되면 앱에 박힌 Mac 주소가 틀려 "No script URL". iPhone USB 핫스팟은 Mac 에 닿지 않는다. 같은 Wi-Fi 에 핫스팟을 동시에 켜 두면 Metro 가 매우 느리다 → **핫스팟 끄고 같은 Wi-Fi(5GHz)** 가 가장 잘 됐다 (집 Wi-Fi 기준. 10-14 의 다른 Wi-Fi 에서는 기기 간 통신이 막혔다 — 망마다 다름)
- **iOS 서명은 사람마다 다르다**: 10-14 빌드의 팀 ID `RVB3MMNVS6` 은 그 Apple 계정 것. 다른 사람은 자기 팀으로 서명하고, 번들 ID 가 이미 다른 팀에 등록돼 있으면 개인용 접미사를 붙인다 (현슈: `com.syncfield.syncrew.hyeonsyu`). `frontend/ios/` 는 git 제외라 각자 `npx expo prebuild --platform ios` 로 만든다. 번들 ID 를 바꾸면 `devicectl … launch` 의 이름도 바꾼다
- 이 문서를 쓰던 세션은 예전 경로에서 시작해 셸이 동작하지 않았다 → **새 세션은 반드시 `/Users/taewoongjang/PlayGround/SYNCREW` 에서 시작**

### 참고 문서
| 문서 | 내용 |
|---|---|
| `CLAUDE.md` | 작업 규칙·상태 표·결정 표·명령 |
| `docs/testguide.md` | **사용자가 직접 시험하는 안내서** (2026-10-17): 자동 시험 → 웹 흐름 → 실기기 → 실제 OpenAI 4단계, 결과 기록·정리·자주 겪는 문제 |
| `docs/streaming-plan.md` | Phase 7 계획·결정(0-1·0-2절)·S1(4-1)·S2(5-1)·실기기 없이 마무리(5-2)·**S3 구현·재점검·미검증(5-3)·iOS 실기기 결과(5-4)** |
| `docs/device-test-log.md` | 실기기 시험 기록 (T2 결과, **S3 iOS 결과(10-17 밤)**, 이후 여기에 이어서 적는다) |
| `docs/s0-report.md` | OpenAI 스트리밍 측정, 네이티브 오디오 후보 조사(2절), 번역 전용 모델 비교(4절) |
| `docs/implementation-plan.md` | Phase 별 완료 내용·검증·커밋 |
| `docs/operations.md` | 설치·실행·비용·플러그인(5절)·확인 도구(6절)·기기 실행(7절)·Supabase(8절) |
| `docs/realtime-protocol.md` | Socket.IO 이벤트 (10절 스트리밍) |
| `docs/api-specification.md` | REST API (11절 세션, 12절 작업조) |
| `docs/live-interpretation.md`, `docs/phase4-report.md`, `docs/phase6-report.md` | 문장 단위 통역 구조, 에뮬레이터 실행 명령, Phase 6 결과 |

---

## 7. 가장 먼저 할 다음 작업

### 선정 (2026-10-24 갱신): **① `main` PR·시드니 배포(조현수) → ② S4 = 시연 리허설 (Note 9 ↔ iPhone 17 Pro, 시드니 서버, 실제 OpenAI 약 $0.5)**. Android·iPhone 단독 시험은 10-23–24 에 끝남 (iPhone 스피커 에코 제거만 미해결 — 시연 지장 없음, `docs/streaming-plan.md` 5-7절)

> **10-24 갱신**: iPhone 17 Pro 실기기 확인 끝 (`docs/device-test-log.md` 10-24). 아래 "실행 순서 — iOS" 는 10-24 에 한 절차 그대로다 — 다시 할 때 참고. S4 는 시드니 서버를 쓰면 같은 Wi-Fi·Mac IP 설정이 필요 없다(앱 출시 빌드 또는 `EXPO_PUBLIC_API_BASE_URL=https://syncrew.hyunshu.com`). 걸려 온 전화는 받는 사람이 그 현장 화면 안에 있어야 뜬다

### (이전) 선정 (2026-10-23): **① iPhone 재확인 — 10-23 Android 수정 뒤 iPhone 이 그대로 되는지(F·문장 단위) + 통화 시작 때 에코 제거가 꺼지는 문제(PR #12 수정의 실기기 확인, `docs/testguide.md` 4-12절) → 실제 OpenAI 로 iOS G·H ② S4 휴대폰 2대(Note 9 + iPhone, 같은 Wi-Fi, 무선 adb)**. Android 단독 시험은 10-23 에 끝남

> **10-23 갱신**: Android(Note 9, Android 10)는 S3 전부 통과(2절, `docs/streaming-plan.md` 5-5절). 이 PC 의 iPhone 17 Pro 로 iOS 를 다시 본다 — `playback.ts`·`useHandsFree.ts` 변경은 Android 분기만이지만 iOS 회귀를 확인할 것. 무선 adb·같은 Wi-Fi 방법은 `docs/testguide.md` 4-3절. 시연 전에 정할 것: 걸려 온 전화는 받는 사람이 **그 현장 화면 안에 있을 때만** 뜬다(현장 목록에서는 안 뜨고 30초 뒤 부재중) — 바꿀지 결정

> **10-22 결정 (사용자)**: **10/30 시연에 Android·iPhone 모두 쓴다. 앞으로 모든 시험은 장태웅이 이 PC 에서** (Galaxy S22 + Buds2, iPhone 17 Pro + AirPods Pro) — Android S3 도 시연 전 필수. 이 PC 디스크 10-22 오후 12GB(15GB 필요).
>
> **10-22 보완**: 10-19–20 에 서버 쪽 메아리 차단(반이중 + `stream:playing`)·전사 전용 세션이 들어왔으므로, G 시험은 그 수정까지 함께 본다 (`echoDropped`, "나" 자막이 말하는 도중 뜨는지). **10/30 현장 시연이 시드니 서버에서 있으므로**, 시연 전에 실기기로 시드니 서버에 붙어 F·G 를 한 번은 통과시키는 것을 우선한다. `git pull` 로 `3d72cad` 이후 코드인지 확인하고, 경량화로 앱 의존성이 바뀌었으니(`frontend` `npm ci`) 개발 빌드를 새로 만든다

선정 이유: iPhone 에서 점검 화면·F(스트리밍 통화)는 통과했지만(10-17 밤, 2절), **실제 통화에서는 스피커로 시작해도 반복 보호가 걸려 에코 제거가 꺼진 채 통화했다**. 이대로 실제 OpenAI 로 G(스피커 에코 루프)를 하면 상대 통역이 내 마이크로 다시 번역될 가능성이 크다. 먼저 가짜 엔진(비용 0)으로 원인을 잡고, 그다음 돈이 드는 G·H 를 한 번에 하는 것이 싸다. Android 는 기기가 있는 사람이 7절 "Android S3" 를 한다 (iOS 작업과 독립).

### 시작 전에 (Mac)
1. **어느 작업 환경인지 확인** (1절 표): 이 PC(장태웅)인지 현슈 Mac 인지, 연결된 기기가 무엇인지 (`xcrun devicectl list devices`, `adb devices -l`). 기기 이름·ID 가 아래 명령과 다르면 바꿔 쓴다
2. **이 PC 라면 디스크 확인**: `df -h /System/Volumes/Data` — 10-18 기준 **8.1GB**, 15GB 이상 필요. 이미 정리한 것: Android 빌드 캐시, Xcode `ModuleCache.noindex`, npm 캐시. 큰 곳(10-17 측정): `~/Downloads` 8.9GB, `~/Library/Caches` 8.1GB, `~/Library/Developer/Xcode` 9.1GB(대부분 DerivedData), `~/Library/Developer/CoreSimulator` 7.0GB(iOS 시뮬레이터 — 실기기 시험에는 불필요), 에뮬레이터 `~/.android/avd/Pixel_9_Pro_XL.avd` 7.7GB. 어느 것을 지울지는 사용자가 정한다
3. Mac 화면에 마이크 권한 창·에뮬레이터 오류 창이 남아 있으면 처리. 오디오가 꼬였으면 Mac 재부팅
4. `git pull` 로 `4fd2d9d` 이후 코드인지 확인 (iOS 수정이 들어 있어야 함)

### 실행 순서 — iOS (iPhone + AirPods)
1. 서버 `ENGINE=fake` + DB, 네트워크·Metro·빌드는 아래 "실기기 실행 절차"대로 (**DEBUG 빌드** — `[duplex-diag]` 로그가 나와야 함)
2. **통화 시작 때 에코 제거가 꺼지는 문제** (비용 0) — **2026-10-23 현슈가 실기기 없이 고침(PR #12, `main` `71126d5`, `docs/streaming-plan.md` 5-6절). 확인 절차·볼 로그·통과 기준은 `docs/testguide.md` 4-12절** — 아래는 수정 전 메모:
   - 스피커(에어팟 끊고)로 `call-peer.ts` 통화를 3–5번 시작하며 `[duplex-diag]` 로그와 앱 `onError`(`voice_processing_loop`) 를 본다. 점검 화면(`/audio-check`)에서는 켜져 있었고 통화에서는 꺼졌으므로, **두 경우의 차이**(통화 화면이 먼저 다른 오디오 — expo-audio 재생·녹음 — 를 쓰고 있었는지, 세션 카테고리·샘플레이트가 바뀌는지, 시작 직후 경로 변경 알림이 오는지)를 로그로 비교한다
   - 고칠 후보 (원인을 보고 정한다): 엔진 시작 전 세션 설정을 끝내고 잠깐 기다리기, 설정 변경 알림 직후 재구성을 짧게 미뤄 묶기, 형식이 그대로면 재구성 대신 `engine.start()` 만 다시(코드에 `tapFormat` 이 준비돼 있으나 아직 안 씀), 통화 화면이 expo-audio 를 먼저 놓게 하기. 통화 도중 에어팟 → 스피커 전환에서도 에코 제거가 다시 켜지게
   - 완료 기준: 스피커로 시작한 통화 5번 모두 `voice_processing_loop` 없이 에코 제거가 켜진 상태(진단 로그 `vp=true`), 점검 화면의 시험음 중 마이크가 말소리보다 충분히 낮음
3. **실제 OpenAI 로 G·H** (비용 안내 후 — 예상 약 $0.5–1: 말한 1분당 약 $0.18 × 3–5분, 서버 한도 $3 누적 중 약 $0.34 사용. `OPENAI_BUDGET_USD` 를 누적+여유로 걸고 실행):
   - G: 에어팟 없이 스피커로 통화, 상대(`call-peer.ts`)가 말하게 두고 → 휴대폰이 상대 통역 음성을 다시 보내지 않는지(스크립트의 `◀ 휴대폰 말` 이 상대 발화 직후 생기지 않는지, 받은 wav)
   - H: 통화 중 에어팟 연결·해제, Wi-Fi 잠깐 끄기(문장 단위로 넘어가거나 다시 연결), 같은 언어 통화(직접 전달)
   - 같은 김에: 실제 통역 음성이 iPhone 스피커·에어팟으로 들리는지, 자막, 말 끝 → 첫 소리 체감 지연
4. 결과를 `docs/device-test-log.md` 에, 고친 것은 사용자 요청 시 커밋. 그다음 S4(2대 통화)

### 실행 순서 — Android S3 (Android 기기가 있는 사람, iOS 와 독립)
1. 새 네이티브 모듈이 들어갔으므로 **개발 빌드를 새로 설치** (`expo run:android --device <기기>`)
2. **점검 화면** (`syncrew:///audio-check` 또는 Metro 를 `EXPO_PUBLIC_DEV_START_ROUTE="/audio-check?auto=1"` 로): 스피커 — 경로 `speaker`, 조각 약 100ms, 말하면 음량 상승, 시험음, 시험음 중 마이크 최대(에코)가 말소리보다 낮은지, 3초 녹음 후 다시 듣기 / 블루투스 헤드셋 — 경로 `bluetooth (이름)`, `adb shell dumpsys audio | grep mScoAudioState` 가 ACTIVE, 헤드셋으로 시험음
3. **스트리밍 통화 F·G·H** (상대 `call-peer.ts` 또는 iPhone). iOS 에서 나온 voice processing 문제는 Android 와 무관(Android 는 AEC 효과기 방식)하지만, 경로 전환 때 소리 공백·에코는 같이 본다
4. **문장 단위 폴백에서 Android 헤드셋 재시험 (10-14 실패한 C)**: `frontend/.env` 에 `EXPO_PUBLIC_STREAMING=off` 로 Metro 재시작 → 헤드셋 마이크로 녹음되는지 + 통역 재생이 헤드셋으로 나오는지. 상대 스크립트는 `--utterance`
5. 2026-10-17 재점검에서 Android 실기기에서 눈여겨볼 점: SCO 가 켜지는 0.5–1초 동안 첫 소리가 휴대폰 마이크로 들어갈 수 있음, 재생 오류가 계속되면 `onError` 가 20ms 마다 반복, 오디오 포커스 미요청, `BLUETOOTH_CONNECT` 권한 없이 `setCommunicationDevice` 가 되는지

### 실기기 실행 절차 (2026-10-14–15 에 실제로 된 방법)
- 서버: `cd server && npm run db:start` / `cd server && ENGINE=fake npm run dev`
- **네트워크**: 일반 Wi-Fi 는 기기 간 통신이 막혔다. Galaxy 핫스팟에 Mac·iPhone 을 붙이면 iPhone 은 무선으로 됨. Galaxy 자신은 자기 핫스팟 손님(Mac)에 앱이 닿지 못함 → Galaxy 는 USB 터널:
  - Android: `adb reverse tcp:4000 tcp:4000; adb reverse tcp:8081 tcp:8081`, `frontend/.env` 의 `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000`
  - iPhone: `EXPO_PUBLIC_API_BASE_URL=http://<Mac IP>:4000` (`.env` 하나라 Android·iPhone 을 동시에 쓰려면 두 휴대폰 모두 무선으로 닿는 구성이 필요 — iPhone 핫스팟에 Mac·Galaxy 를 붙여 시험해 볼 것)
  - Metro: `cd frontend && REACT_NATIVE_PACKAGER_HOSTNAME=<Mac IP> npx expo start --dev-client --clear` (`.env` 를 바꾸면 Metro 재시작 + 앱 완전 종료 후 재실행)
- Android 빌드: `rm -rf frontend/android/app/.cxx frontend/android/app/build` → `JAVA_HOME=<JDK 21>` → `cd frontend && npx expo run:android --device SM_S901N` (기기 이름으로 지정)
- iOS 빌드 (아래 ID·팀은 10-14 iPhone 17 Pro·장태웅 계정 값 — **기기 ID 는 `xcrun devicectl list devices`, 팀은 본인 Apple 계정으로 바꾼다**. 현슈는 개인 팀 + 번들 ID `com.syncfield.syncrew.hyeonsyu`, 6절): `cd frontend/ios && xcodebuild -workspace SYNCREW.xcworkspace -scheme SYNCREW -configuration Debug -destination 'id=00008150-0014783A3630C01C' -allowProvisioningUpdates DEVELOPMENT_TEAM=RVB3MMNVS6 CODE_SIGN_STYLE=Automatic build` → `xcrun devicectl device install app --device 00008150-0014783A3630C01C ~/Library/Developer/Xcode/DerivedData/SYNCREW-*/Build/Products/Debug-iphoneos/SYNCREW.app` → `xcrun devicectl device process launch --device … --terminate-existing com.syncfield.syncrew`. **빌드 때 Mac 주소가 앱에 들어가므로(`ip.txt`) 네트워크가 바뀌면 다시 빌드**
- iPhone 앱 로그는 Metro 출력에 나온다. Android 는 `adb logcat | grep ReactNativeJS`
- **상대 역할 스크립트** `server/scripts/call-peer.ts` (2026-10-17 추가, 휴대폰에는 관리자 e2e 계정으로 로그인):
  - `cd server && npx tsx scripts/call-peer.ts` — 구성원 계정(베트남어)이 휴대폰에 전화 → 받으면 8초마다 말하기. `--answer` 휴대폰이 거는 전화 받기, `--as manager` 역할 바꾸기, `--listen` 말하지 않기, `--utterance` 문장 단위, `--every 5`, `--count 3`, `--text "문장"`, `--server http://<주소>:4000`. 끝내기 Ctrl+C
  - 휴대폰이 문장 단위(폴백)면 스크립트 화면에 `◀ 휴대폰 말 …` 대신 `◀ 기록 도착` 만 나온다
  - 출력: `◀ 휴대폰 말 끝 … 조각 N개 · 첫 조각 Nms · 음량 평균/최대 dB (⚠ 거의 무음)`, `휴대폰 오디오 경로: bluetooth (Galaxy Buds2)`. 받은 소리 `server/call-peer-output/*.wav` (git 제외)
  - **휴대폰 마이크 소리를 그대로 듣고 싶으면 같은 언어 통화**(직접 전달)로: 두 계정의 언어를 같게 하면 받은 wav 가 휴대폰 마이크 원음이다 — 헤드셋 마이크 무음·에코·끊김 확인용. 다른 언어면 받은 소리는 통역 음성(`ENGINE=fake` 면 가짜)
  - 비용: `ENGINE=fake` 서버면 0
- 오디오 경로 확인: Android `adb shell dumpsys media.audio_flinger | grep "Input device"`, `adb shell dumpsys audio | grep mScoAudioState`. 녹음 파일 크기·음량은 `server/storage/uploads/*.m4a` 를 `afconvert -f WAVE -d LEI16` 로 바꿔 측정

### 확인 방법 (S3 완료 판단)
- 5절 시나리오 F·G·H 를 Android·iPhone 각각 통과, 결과를 `docs/device-test-log.md` 에 기록 (10-18 현재: iPhone F ✅, iPhone G·H ⬜, Android 전부 ⬜)
- iPhone 스피커 통화에서 에코 제거가 꺼지지 않는다 (`voice_processing_loop` 없음)
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

(한 줄을 더한다: `작업 환경은 <이 PC / 현슈 Mac>, 연결한 기기: <iPhone 모델 / Android 모델 / 헤드셋 모델>.` 이 PC 에서 디스크를 비웠다면: `디스크 공간 확보했어.` 실제 OpenAI 시험까지 갈 생각이면: `OpenAI 비용 $<금액> 까지 승인.`)

---

## 새 세션 응답 규칙 ("이제 할 일이 뭐지?", "다음에 뭘 하면 돼?", "이어서 하자" 라고 하면)

1. **현재 진행 상황을 짧게 요약**한다 (완료된 단계, 지금 멈춘 지점: 7절).
2. **지금 당장 할 가장 우선순위 높은 작업 하나**를 명확히 말한다 — 7절의 선정 작업. 단, 문서 작성 이후 상태가 바뀌었을 수 있으니 `git log`·`docs/device-test-log.md`·사용자 답으로 먼저 확인하고, 이미 끝난 일은 다시 시키지 않는다.
3. 그 작업의 **단계별 절차**를 준다: 필요한 파일·명령·설정·확인 방법 포함 (7절 실행 순서, 5절 절차).
4. **작업 환경(이 PC / 현슈 Mac)과 연결된 기기를 먼저 확인하고, 이 PC 라면 디스크 여유를 확인한다** (`df -h /System/Volumes/Data`, 15GB 미만이면 네이티브 빌드 불가 — 사용자에게 알리고 공간 확보를 요청. 10-18 기준 8.1GB). Android 기기가 없으면 iOS 작업만 안내한다. **실기기 준비가 끝나지 않았으면 반드시 먼저 알리고**, 준비해야 할 것(5절 기기·준비물·휴대폰 설정)을 가장 먼저 안내한다. 실기기가 필요한 작업을 에뮬레이터·웹 결과로 완료 처리하지 않는다.
5. 실기기 검증이 남아 있으면 **어떤 기능을 어떤 방식으로** 검증할지 알려 준다 (5절 시나리오 A–H, 재확인 목록).
6. 작업이 끝나면 **무엇을 확인하고 무엇을 보고할지** 설명한다: 실행한 시험과 결과, 실기기 결과 기록(`docs/device-test-log.md`), 미검증 항목, 알려진 문제, 다음 단계. 그리고 멈춰서 승인받는다.
7. 선행 조건이나 정보가 부족하면 그 사실을 밝히고, **꼭 필요한 경우에만** 질문한다 (예: 기기 준비 여부, `.env` 값 변경 허락, 실제 OpenAI 비용 승인).
8. 여러 선택지를 나열하고 끝내지 말고, 읽은 직후 바로 행동할 수 있게 안내한다.
9. 비용 규칙(6절)과 사용자 결정(6절)을 지킨다. 실제 OpenAI 호출 전에는 예상 비용을 말한다.
