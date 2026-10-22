# SYNCREW 직접 시험 안내서 (testguide)

작성 2026-10-17. **팀장이 혼자서 앱을 켜고 시험·확인하는 방법**을 순서대로 정리한 문서다.
명령은 모두 이 PC(`/Users/taewoongjang/PlayGround/SYNCREW`)에서 실제로 쓰던 것이다. 더 깊은 배경은 `docs/HANDOFF.md`(5·7절), `docs/operations.md` 에 있다.

---

## 0. 한눈에 보기 — 시험은 4단계

| 단계 | 무엇을 하나 | 필요한 것 | 비용 | 걸리는 시간 | 이걸로 알 수 있는 것 |
|---|---|---|---|---|---|
| **1단계** 자동 시험 | 명령 몇 개로 서버·앱 코드 검사 | PC 만 | 0 | 약 5분 | 코드가 망가지지 않았는지 |
| **2단계** 웹 자동 흐름 시험 | 크롬이 자동으로 앱을 눌러 보며 확인 | PC 만 | 0 | 약 10–20분 | 화면 흐름·통화·지시가 끝까지 되는지 |
| **3단계** 휴대폰 실기기 시험 | 내 휴대폰에 앱을 설치하고 직접 말해 보기 | 휴대폰·USB 케이블·헤드셋, **디스크 15GB 이상** | 0 (가짜 통역) | 처음 1–2시간 | 실제 마이크·스피커·헤드셋·네트워크 |
| **4단계** 실제 OpenAI 시험 | 진짜 통역(진짜 목소리)으로 3단계 반복 | 3단계 + 비용 승인 | 말한 1분당 약 $0.18 | 원하는 만큼 | 번역 품질·목소리·실제 지연 |

- **처음엔 1 → 2 → 3 순서로**, 4단계는 3단계 흐름이 다 된 뒤에 한다.
- 3단계까지는 서버를 **가짜 통역 엔진(`ENGINE=fake`)** 으로 켜므로 OpenAI 비용이 0이다. 가짜 엔진은 번역 대신 `[vi] [음성 ko] 2.3s` 같은 글자와 **"삐—" 소리(또는 아주 짧은 무음)** 를 보낸다. 이건 정상이다 — 진짜 목소리는 4단계에서만 나온다.
- **데모 모드(`EXPO_PUBLIC_API_MODE=mock`)** 는 서버 없이 가짜 데이터로 화면만 보여 준다. 이때 통역 음성은 **휴대폰 기계음(기기 음성 합성)** 이라 부자연스럽다. 실제 서비스 목소리가 아니다.

---

## 1. 시작 전에 매번 확인

```bash
cd /Users/taewoongjang/PlayGround/SYNCREW
df -h /System/Volumes/Data      # Avail(남은 공간). 3단계(앱 빌드)는 15GB 이상 필요
git status                      # 내가 바꾼 파일이 있는지
git log --oneline | head -3     # 지금 어떤 버전인지 (시험 기록에 적는다)
```

- **비용 규칙**: 서버를 진짜 OpenAI 로 켜는 4단계 전에는 예상 비용을 정하고 상한을 건다 (5절). 서버에는 누적 $3 한도가 걸려 있다.
- 시험 결과는 `docs/device-test-log.md` 에 적는다 (6절).

---

## 2. 1단계 — 자동 시험 (PC 만, 비용 0)

터미널에서 순서대로:

```bash
cd /Users/taewoongjang/PlayGround/SYNCREW/server
npm run typecheck && npm test          # 서버 검사. 끝에 "Tests 200 passed" 가 나와야 함

cd /Users/taewoongjang/PlayGround/SYNCREW/frontend
npm run typecheck && npm run test:unit # 앱 검사. "pass 22", "fail 0" 이 나와야 함
```

- 서버 시험은 임시 데이터베이스를 스스로 켜고 끄므로 따로 서버를 켤 필요가 없다.
- 하나라도 실패(failed)가 나오면 그 출력 전체를 복사해서 Claude 에게 보여 준다.

---

## 3. 2단계 — 웹 자동 흐름 시험 (PC 만, 비용 0)

크롬이 화면 없이(헤드리스) 앱 웹 버전을 열고, 로그인·대화·통화·일괄 지시를 자동으로 눌러 본다.

### 3-1. 데모 모드 흐름 (서버 필요 없음)
```bash
cd /Users/taewoongjang/PlayGround/SYNCREW/frontend
npm run bundle:web && npm run e2e      # 끝에 99개 모두 통과가 나와야 함
npm run e2e:screens                    # 주요 화면 캡처 → frontend/e2e/output/screens/ 에서 그림으로 확인
npm run e2e:mic                        # 실제 말소리를 넣었을 때 자동 전송 + 무음일 때 전송 안 함 (2개)
```

### 3-2. 실제 서버 + 두 사람 흐름 (live 모드)
터미널 3개를 쓴다.

```bash
# 터미널 1 — 데이터베이스 (켜 둔 채로 둔다)
cd /Users/taewoongjang/PlayGround/SYNCREW/server && npm run db:start

# 터미널 2 — 서버 (가짜 통역, 켜 둔 채로 둔다)
cd /Users/taewoongjang/PlayGround/SYNCREW/server && npm run db:deploy && ENGINE=fake npm run dev
#   → 브라우저에서 http://localhost:4000/health 가 열리면 준비 완료

# 터미널 3 — 시험
cd /Users/taewoongjang/PlayGround/SYNCREW/frontend
npm run bundle:web:live && npm run e2e:live   # 관리자·구성원 두 명이 실제 서버로 대화·통화 (43개)
```

- 한쪽만 스트리밍하는 통화 확인(18개)은 터미널 2의 서버를 `ENGINE=fake STREAM_MAX_SESSIONS=1 npm run dev` 로 다시 켠 뒤 `E2E_MIXED=1 npm run e2e:live`.
- 시험용 계정 2개(`syncrew-e2e-manager@example.com` 관리자, `syncrew-e2e-member@example.com` 구성원)를 쓴다. 비밀번호는 `server/.e2e-accounts.json` 에 있다 (git 에 올리지 않는 파일).
- 끝나면 7절대로 서버·DB 를 끈다.

> 2단계까지 통과해도 **휴대폰에서 된다는 뜻은 아니다**. 마이크·스피커·헤드셋·네트워크는 3단계에서만 확인된다.

---

## 4. 3단계 — 휴대폰 실기기 시험 (비용 0)

### 4-1. 준비물
- [ ] Android 휴대폰 (지금: Galaxy S22) + USB 케이블
- [ ] iPhone (지금: iPhone 17 Pro) + USB 케이블 + Apple 계정 (무료 계정이면 설치한 앱이 **7일마다 만료** → 다시 설치)
- [ ] **통화 가능한 블루투스 헤드셋** (지금: Galaxy Buds2, AirPods Pro)
- [ ] Mac 디스크 여유 **15GB 이상** (`df -h /System/Volumes/Data`)

### 4-2. 휴대폰 설정 (처음 한 번)
- **Android**: 설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드번호 7번 누르기 → 개발자 옵션 → **USB 디버깅 켜기** → Mac 에 연결 후 "USB 디버깅 허용"
- **iPhone**: Mac 연결 후 "이 컴퓨터를 신뢰" → 설정 → 개인정보 보호 및 보안 → **개발자 모드 켜기**(재시동) → 앱 처음 설치 후 설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 **신뢰**
- 앱을 처음 켜면 **마이크 권한 허용**

연결 확인:
```bash
~/Library/Android/sdk/platform-tools/adb devices -l   # Android 가 "device" 로 보여야 함 (unauthorized 면 휴대폰에서 허용)
xcrun devicectl list devices                          # iPhone 이 보여야 함
```

### 4-3. 네트워크 구성 (중요 — 실제로 된 방법)
일반 Wi-Fi(집·학교)는 휴대폰 ↔ Mac 통신을 막는 경우가 많았다. 지금까지 된 방법:

1. **Galaxy 의 핫스팟을 켜고, Mac 과 iPhone 을 그 핫스팟에 연결**한다
2. Mac 주소 확인: `ipconfig getifaddr en0` (예: `10.x.x.x`) → 아래 `<Mac IP>` 자리에 쓴다
3. **iPhone** 은 무선으로 `http://<Mac IP>:4000` 에 접속
4. **Galaxy** 는 자기 핫스팟 손님(Mac)에 직접 못 닿으므로 USB 터널을 쓴다:
   ```bash
   adb reverse tcp:4000 tcp:4000
   adb reverse tcp:8081 tcp:8081
   ```
   (USB 를 뺐다 꽂으면 다시 해야 한다)
5. 확인: 휴대폰 브라우저에서 `http://<Mac IP>:4000/health`(iPhone) 또는 `http://localhost:4000/health`(Galaxy) 가 열려야 한다

**무선 adb (2026-10-23 Note 9 에서 된 방법 — USB 는 노트북 배터리를 많이 써 노트북이 꺼진 적이 있다, 충전기 연결 권장)**
- 조건: Mac 과 Android 가 **기기끼리 통신되는 같은 Wi-Fi** (확인: `adb shell ping -c 3 <Mac IP>`). 10-23 의 SK_E850 은 됐다
- USB 로 한 번: `adb tcpip 5555` → `adb connect <폰 IP>:5555` (폰 IP: `adb shell ip -f inet addr show wlan0`) → 케이블 뽑기. 폰을 재부팅하면 다시
- `unauthorized` 면: 휴대폰 개발자 옵션 → "USB 디버깅 권한 승인 취소" → 케이블 다시 꽂고 **"이 컴퓨터에서 항상 허용" 체크 후 허용**
- Metro: 개발 빌드는 `localhost:8081` 을 찾으므로 무선 adb 위로 `adb reverse tcp:8081 tcp:8081`. 서버 API 는 `.env` 를 `http://<Mac IP>:4000` 으로(직접 Wi-Fi)
- 이 구성이면 iPhone 도 같은 Wi-Fi 로 붙어 휴대폰 2대 통화(S4)를 할 수 있다

### 4-4. 앱 설정 파일 바꾸기 (`frontend/.env`)
평소 값은 데모 모드(`mock`)다. 실기기 시험 때만 바꾼다.

| 시험 대상 | `EXPO_PUBLIC_API_MODE` | `EXPO_PUBLIC_API_BASE_URL` |
|---|---|---|
| Galaxy (USB 터널) | `live` | `http://localhost:4000` |
| iPhone (핫스팟 무선) | `live` | `http://<Mac IP>:4000` |
| 원래 값 (시험 끝나면) | `mock` | `http://10.0.2.2:4000` |

- 설정 파일은 하나라서 **두 휴대폰을 동시에 쓰려면 둘 다 무선으로 닿는 구성**이 필요하다 (iPhone 핫스팟에 Mac·Galaxy 를 붙이는 방법 — 아직 시험 안 함).
- 문장 단위 방식만 시험하려면 `EXPO_PUBLIC_STREAMING=off` 를 한 줄 추가한다.
- **값을 바꾸면 Metro(4-5)를 다시 켜고, 휴대폰 앱도 완전히 껐다가 다시 연다.**

### 4-5. 서버·Metro 켜기
터미널 3개:
```bash
# 터미널 1 — 데이터베이스
cd /Users/taewoongjang/PlayGround/SYNCREW/server && npm run db:start
# 터미널 2 — 서버 (가짜 통역, 비용 0)
cd /Users/taewoongjang/PlayGround/SYNCREW/server && ENGINE=fake npm run dev
# 터미널 3 — Metro (앱 코드를 휴대폰에 보내 주는 프로그램)
cd /Users/taewoongjang/PlayGround/SYNCREW/frontend && REACT_NATIVE_PACKAGER_HOSTNAME=<Mac IP> npx expo start --dev-client --clear
```

### 4-6. 앱 빌드·설치 (앱 코드의 네이티브 부분이 바뀌었을 때만, 디스크 많이 씀)
**지금은 새 네이티브 오디오 모듈이 들어갔으므로 두 휴대폰 모두 한 번 새로 설치해야 한다.** 그 뒤로는 화면·로직만 바뀌면 Metro 만 다시 켜면 된다.

**Android (Galaxy)**
```bash
cd /Users/taewoongjang/PlayGround/SYNCREW
rm -rf frontend/android/app/.cxx frontend/android/app/build
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home   # 꼭 JDK 21
cd frontend && npx expo run:android --device SM_S901N
```

**iOS (iPhone)**
```bash
cd /Users/taewoongjang/PlayGround/SYNCREW/frontend/ios
xcodebuild -workspace SYNCREW.xcworkspace -scheme SYNCREW -configuration Debug \
  -destination 'id=00008150-0014783A3630C01C' -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=RVB3MMNVS6 CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device 00008150-0014783A3630C01C \
  ~/Library/Developer/Xcode/DerivedData/SYNCREW-*/Build/Products/Debug-iphoneos/SYNCREW.app
xcrun devicectl device process launch --device 00008150-0014783A3630C01C --terminate-existing com.syncfield.syncrew
```
- 위 기기 ID(`00008150-…`)와 팀 ID(`RVB3MMNVS6`)는 10-14 iPhone 17 Pro·팀장 Apple 계정 값이다. 다른 iPhone·다른 사람이면 `xcrun devicectl list devices` 로 ID 를 찾고 본인 팀으로 서명한다 (번들 ID 가 겹치면 개인용 접미사 — 현슈는 `com.syncfield.syncrew.hyeonsyu`, 그때는 마지막 줄의 앱 이름도 바꾼다).
- iPhone 앱에는 **빌드할 때의 Mac 주소가 들어간다** → 네트워크(핫스팟)가 바뀌어 Mac 주소가 바뀌면 다시 빌드한다. "No script URL" 화면이 나오면 이 경우다. 10-17 밤에는 **핫스팟을 끄고 Mac·iPhone 을 같은 Wi-Fi(5GHz)에** 두는 것이 가장 잘 됐다 (Mac 이 iPhone 핫스팟으로 자동 전환되면 주소가 바뀐다).

### 4-7. 로그인
- 휴대폰에는 **관리자 시험 계정**(`syncrew-e2e-manager@example.com`, 비밀번호는 `server/.e2e-accounts.json`)으로 로그인한다.
- 상대는 4-8의 **통화 상대 스크립트**가 구성원 계정(베트남어)으로 맡는다. 휴대폰이 2대면 다른 휴대폰에 구성원 계정으로 로그인해도 된다.
- 두 계정은 이미 같은 현장에 들어가 있다 (2단계 live 시험이 만든 현장, 로컬 DB 에 저장됨).

### 4-8. 통화 상대 스크립트 (휴대폰 1대로 통화 시험하기)
Mac 이 "통화 상대" 역할을 하며 몇 초마다 합성 음성으로 말하고, 휴대폰이 보낸 소리를 숫자로 보여 준다.

```bash
cd /Users/taewoongjang/PlayGround/SYNCREW/server
npx tsx scripts/call-peer.ts                 # 스크립트가 휴대폰(관리자)에게 전화 → 휴대폰에서 받기 → 8초마다 말함
npx tsx scripts/call-peer.ts --answer        # 휴대폰에서 거는 전화를 스크립트가 받음
npx tsx scripts/call-peer.ts --utterance     # 문장 단위 방식으로 (스트리밍 안 씀)
npx tsx scripts/call-peer.ts --listen        # 말하지 않고 듣기만
# 그 밖에: --as manager(역할 바꾸기) --every 5(5초마다) --count 3(3번만) --text "문장" --server http://<주소>:4000
# 끝내기: Ctrl+C
```
화면에서 볼 것:
- `◀ 휴대폰 말 끝 … 조각 N개 · 음량 평균/최대 dB` — 휴대폰 마이크 소리가 왔다는 뜻. **`⚠ 거의 무음`** 이 붙으면 마이크가 안 되는 것
- `휴대폰 오디오 경로: bluetooth (Galaxy Buds2)` — 헤드셋이 쓰이는지
- 받은 소리 파일: `server/call-peer-output/*.wav` (`afplay 파일경로` 로 들어 볼 수 있음)
- **휴대폰 마이크 원음을 그대로 듣고 싶으면** 두 계정의 언어를 같게(같은 언어 통화 = 번역 없이 직접 전달) 한다

### 4-9. 오디오 점검 화면 (통화 전에 먼저)
앱에서 `syncrew:///audio-check` 를 열거나, Metro 를 `EXPO_PUBLIC_DEV_START_ROUTE="/audio-check?auto=1"` 을 붙여 켠다.

| 확인 | 휴대폰 스피커 | 블루투스 헤드셋 연결 후 |
|---|---|---|
| 경로 표시 | `speaker` | `bluetooth (헤드셋 이름)` |
| 조각 간격 | 약 100ms | 약 100ms |
| 말하면 음량이 오르나 | 올라야 함 | 헤드셋에 말하면 올라야 함 |
| 시험음 | 휴대폰에서 들림 | 헤드셋에서 들림 |
| 에코 | 시험음 중 마이크 최대가 말할 때보다 충분히 낮음 | — |
| 3초 녹음 → 다시 듣기 | 내 목소리가 들림 | 내 목소리가 들림 |

Android 헤드셋 마이크가 켜졌는지: `adb shell dumpsys audio | grep mScoAudioState` → `ACTIVE` 여야 함.

### 4-10. 시나리오 (iOS·Android 각각)

| ID | 하는 법 | 통과 기준 |
|---|---|---|
| **A** 문자 대화 | 현장 → 1:1 대화 또는 그룹 대화에서 글 보내기 (상대는 다른 휴대폰 또는 웹) | 상대 언어로 번역되어 바로 도착 |
| **B** 통화 (휴대폰 마이크) | 4-8 스크립트로 통화 → 휴대폰에 대고 말하기 | 스크립트 화면에 `◀ 휴대폰 말` 이 뜨고, 스크립트가 말한 것이 휴대폰에서 재생됨 |
| **C** 통화 (헤드셋) | 헤드셋을 연결하고 B 반복 | 헤드셋 마이크로 녹음(무음 아님), 헤드셋으로 들림, 화면에 헤드셋 이름 |
| **D** 일괄 지시 | 관리자 → 지시 → 작업조/대상 선택 → 음성·문자 지시 → 구성원이 확인 누르기 | 고른 사람만 받음, 확인 응답이 관리자 화면에 반영 |
| **E** 비밀번호 재설정 | 로그아웃 → 비밀번호 찾기 → 같은 휴대폰에서 메일 링크 열기 → 새 비밀번호 | 링크가 앱을 열고, 새 비밀번호로 로그인됨 (본인 이메일 계정 필요) |
| **F** 스트리밍 통화 | 통화 화면에 "실시간 통역 · 말하는 동안 전송" 이 뜨는지 확인 후 말하기 | 상대가 말을 끝내고 약 2초 안에 통역이 들림, 같은 문장이 두 번 재생되지 않음 |
| **G** 스피커 에코 | 헤드셋 없이 스피커로 F 반복 | 상대 통역 소리가 내 마이크로 다시 들어가 번역되지 않음 |
| **H** 끊김·전환 | 통화 중 헤드셋 연결/해제, Wi-Fi 잠깐 끄기, 같은 언어 통화 | 통화가 유지되거나 문장 단위로 자동 전환 |

- **Android 헤드셋(C)은 10-14 에 무음으로 실패했던 항목**이라 꼭 다시 본다: `EXPO_PUBLIC_STREAMING=off` 로 문장 단위에서 한 번, 스트리밍(F)에서 한 번.
- 휴대폰 2대 동시 통화(다음 단계 S4)는 4-3의 "둘 다 무선" 구성이 먼저 필요하다.

### 4-11. 로그 보기 (문제가 생겼을 때)
- iPhone 앱 로그: 터미널 3(Metro) 출력
- Android 앱 로그: `adb logcat | grep ReactNativeJS`
- 서버 로그: 터미널 2 출력
- Android 오디오 경로: `adb shell dumpsys media.audio_flinger | grep "Input device"` (헤드셋이면 `BLUETOOTH_SCO`)

---

## 5. 4단계 — 실제 OpenAI 로 시험 (비용 발생)

3단계 흐름이 다 된 뒤, **진짜 번역·진짜 목소리**를 확인할 때만 한다.

1. 지금까지 쓴 금액 확인: 서버를 켠 상태에서 `http://localhost:4000/health` → `budget.spentUsd` (10-17 기준 약 $0.34, 한도 $3)
2. 쓸 금액을 정한다. 기준:
   - 스트리밍 통화: **말한 1분당 약 $0.18**, 문장 하나(턴)에 약 $0.01
   - 5개 언어 왕복 점검 `npx tsx scripts/openai-check.ts`: 약 $0.05
3. 상한을 걸고 서버를 켠다 (터미널 2를 이것으로 바꿈). `ENGINE=fake` 를 빼면 실제 OpenAI 다:
   ```bash
   cd /Users/taewoongjang/PlayGround/SYNCREW/server && OPENAI_BUDGET_USD=1 npm run dev   # 누적 $1 이 되면 서버가 더 부르지 않음
   ```
   (`OPENAI_BUDGET_USD` 는 **누적 금액**이다. 지금까지 쓴 금액 + 이번에 쓸 금액으로 정한다.)
4. 4-10 시나리오 중 보고 싶은 것을 한다. 들어 볼 것: 번역이 맞는지, 목소리가 자연스러운지(목소리 `marin`), 말 끝 → 통역까지 몇 초인지.
5. 끝나면 `/health` 의 `budget.spentUsd` 를 다시 보고 시험 기록에 전후 금액을 적는다.
6. 끝나면 서버를 끄고, 다음 시험은 다시 `ENGINE=fake` 로 켠다.

> 서버 한도($3)를 넘겨야 하면 Claude 에게 금액을 먼저 말하고 정한다 (충전 잔액 $80, 막 쓰지 않기).

---

## 6. 결과 기록하기

`docs/device-test-log.md` 의 표에 한 줄씩 추가한다:

| 날짜 | 기기 | 헤드셋 | 앱 빌드(커밋) | 서버 모드 | 시나리오 | 결과 | 증상·측정값 | 원인 | 해결(커밋) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-20 | Galaxy S22 | Galaxy Buds2 | `26746ff` | fake | C | 실패 | 스크립트에 `⚠ 거의 무음` | (모르면 비움) | |

- 앱 빌드 = `git log --oneline | head -1` 의 앞 7자리
- 실패하면 **어떻게 하면 다시 나는지**(순서), 화면 캡처, 로그(4-11)를 함께 남긴다 → Claude 에게 그대로 넘기면 고칠 수 있다
- 4단계면 비용 전후(`budget.spentUsd`)도 적는다

---

## 7. 끝난 뒤 정리 (꼭)

```bash
pkill -f "src/index.ts"            # 서버 끄기
pkill -INT -f scripts/db.ts        # 데이터베이스 끄기
lsof -nP -iTCP:4000 -sTCP:LISTEN   # 아무것도 안 나와야 함
lsof -nP -iTCP:5433 -sTCP:LISTEN   # 아무것도 안 나와야 함
# 5433 이 남아 있으면:
cd /Users/taewoongjang/PlayGround/SYNCREW/server && node_modules/@embedded-postgres/darwin-arm64/native/bin/pg_ctl -D .pgdata stop -m fast

cd /Users/taewoongjang/PlayGround/SYNCREW
git checkout -- frontend/tsconfig.json   # Metro(expo start)가 자동으로 고쳐 쓰는 파일 되돌리기
```
- Metro 는 터미널 3에서 Ctrl+C
- `frontend/.env` 를 원래 값(`mock`, `http://10.0.2.2:4000`)으로 되돌린다 (계속 실기기 시험할 거면 그대로 둬도 된다 — 단 커밋하지 않는다)
- 통화 상대 스크립트는 Ctrl+C

---

## 8. 자주 겪는 문제

| 증상 | 원인·해결 |
|---|---|
| 앱이 시작 화면에서 멈춤 / "네트워크 연결을 확인해 주세요" | 휴대폰이 서버에 못 닿음 → 4-3 (핫스팟 구성, Galaxy 는 `adb reverse`), 휴대폰 브라우저로 `/health` 확인 |
| iPhone 에 "No script URL" | Mac 주소가 바뀜 → iPhone 앱 다시 빌드 (4-6) |
| `.env` 를 바꿨는데 그대로 | Metro 를 `--clear` 로 다시 켜고 앱을 완전히 종료 후 재실행 |
| 통역 소리가 "삐—" | 정상 — 가짜 엔진(`ENGINE=fake`). 진짜 목소리는 5절 |
| 통역 소리가 로봇 같은 기계음 | 데모 모드(`mock`)이거나 서버 음성 파일 재생 실패 → `.env` 가 `live` 인지 확인 |
| Android 빌드가 CMake 단계에서 실패 | JDK 21 이 아님 → 4-6 의 `export JAVA_HOME=…` |
| 빌드 중 공간 부족 | 디스크 15GB 이상 확보 (`docs/HANDOFF.md` 7절에 큰 폴더 목록) |
| 스크립트가 "함께 속한 현장이 없습니다" | 2단계 `npm run e2e:live` 를 한 번 돌리면 현장이 만들어진다 |
| 서버가 "포트 사용 중"으로 안 켜짐 | 이전 서버가 남아 있음 → 7절의 `pkill` 후 다시 |
| Mac 화면에 마이크 권한 창 | 눌러서 처리. 오디오가 꼬이면 Mac 재부팅. **에뮬레이터에 Mac 마이크를 연결하지 말 것** |

---

## 9. 빠른 참조

| 하고 싶은 것 | 명령 (프로젝트 폴더 기준) |
|---|---|
| 코드 검사 | `cd server && npm test` / `cd frontend && npm run test:unit` |
| 데모 자동 시험 | `cd frontend && npm run bundle:web && npm run e2e` |
| DB 켜기 | `cd server && npm run db:start` |
| 서버 켜기 (비용 0) | `cd server && ENGINE=fake npm run dev` |
| 서버 켜기 (실제 OpenAI, 상한) | `cd server && OPENAI_BUDGET_USD=<누적+여유> npm run dev` |
| Metro 켜기 | `cd frontend && REACT_NATIVE_PACKAGER_HOSTNAME=<Mac IP> npx expo start --dev-client --clear` |
| Galaxy USB 터널 | `adb reverse tcp:4000 tcp:4000; adb reverse tcp:8081 tcp:8081` |
| 통화 상대 | `cd server && npx tsx scripts/call-peer.ts` |
| 쓴 비용 보기 | 브라우저 `http://localhost:4000/health` → `budget.spentUsd` |
| 모두 끄기 | 7절 |
