# 기존 코드베이스 분석

> 대상: https://github.com/jecool0523/workplace-translation-mvp (커밋 `bf43241`, 2026-07-05)
> 방법: 읽기 전용 클론 후 정적 분석. 패키지 설치·빌드·실행은 하지 않았으므로 **실행 동작은 미검증**.

## 1. 디렉터리 구조

```
workplace-translation-mvp/
├─ README.md
├─ .github/workflows/deploy-translator-poc.yml   # tsc 타입 검사 + Expo 웹 빌드 → GitHub Pages
├─ translator-poc/                 # Expo SDK 52, RN 0.76.9, React 18.3.1, TS strict
│  ├─ App.tsx (1,403줄)            # UI, 상태, STT·TTS 호출이 한 파일
│  ├─ src/data/aiTranslator.ts     # OpenAI STT / 번역 / TTS 호출 (fetch)
│  ├─ src/data/translationMemory.ts# 타입, 하드코딩 데이터, 오프라인 translate()
│  ├─ docs/ai-translation-design.md
│  └─ verification/*.png
├─ data/workplace-translation-mvp/ # JSON 5개, CSV 7개 (vi-priority/ 포함)
├─ tools/*.mjs (6개)               # 데이터 생성 스크립트 (템플릿 조합)
└─ outputs/                        # xlsx, 미리보기 png
```

- 테스트 코드 없음. CI는 타입 검사와 웹 배포만 수행.
- 환경변수는 `EXPO_BASE_URL` 하나. OpenAI API 키는 사용자가 화면에서 입력하고 클라이언트가 직접 호출.

## 2. 통역 파이프라인 (코드 기준)

| 단계 | 구현 내용 | 상태 |
|---|---|---|
| 녹음 | `expo-av`, 4.2초 고정 녹음 | 코드 존재, 미검증. `expo-av`는 최신 Expo에서 지원 중단 |
| STT | `gpt-4o-mini-transcribe`, 언어 힌트 + 용어 프롬프트 | 코드 존재. 실패 시 임의 샘플 문장으로 대체(운영 부적합) |
| 용어 감지 | 원문에 용어·별칭 포함 여부 문자열 비교 | 대상은 하드코딩 용어 6개 |
| 번역 | Responses API `gpt-4.1-nano`, JSON 출력 `{t,p,r,c,g}` | 코드 존재, 미검증 |
| 오프라인 번역 | 메모리 정확 일치 → 용어 일치 안내 → 실패 안내 | 코드 존재 |
| TTS | 기기 TTS(`expo-speech`) 기본, OpenAI TTS는 웹 전용 | 네이티브는 기기 TTS만 |
| 지원 언어 | `"ko" \| "vi"` 타입 고정 | |
| 서버, 네트워크, 저장, 노이즈 필터 | 없음 | |

## 3. 데이터셋

| 파일 | 건수 | 주요 필드 | 번역 값 |
|---|---|---|---|
| `workplace_translation_seed.json` | 시나리오 100, 용어 300 | ko, plain_ko, aliases, domain, risk_level | 없음 |
| `manufacturing_translation_pack.json` | 55 | translations{vi,th,id,ne,km} | 5개 언어 |
| `site_slang_translation_pack.json` | 3 | canonical_ko, variants_ko, asr_corrections, translation_rule, translations | 5개 언어 |
| `extended_site_slang_translation_pack.json` | 용어 50, 시나리오 48 | 위와 동일 + normalized_ko | 5개 언어 |
| `vi-priority/vietnamese_priority_dataset.json` | 용어 628, 문장 420, 긴급 160, 은어 변형 140, 테스트 740 | ko, vi, variants_ko, asr_likely_misrecognitions | vi만 |

중요 사실:

1. **데이터셋은 통역 코드에 연결되어 있지 않다.** `translationMemory.ts`는 JSON을 import하지 않고 하드코딩 데이터(메모리 10, 긴급 4, 용어 6, 은어 힌트 3)만 사용한다.
2. 모든 항목 상태가 `seed_needs_native_field_review` (미검수).
3. 확정 지원 언어 중 zh, uz, ru 번역 값은 데이터셋에 없다. vi만 존재.
4. 테스트 발화 740개는 문장 데이터에서 파생되어 독립 평가셋으로 부적합.

→ 사용자 결정에 따라 데이터셋은 교체 예정이므로, 신규 구현은 **데이터 형식에 독립적인 로직 + 어댑터**로 만들고 기존 데이터는 샘플 어댑터로만 연결한다.

## 4. PDF와 저장소의 차이

| PDF 내용 | 저장소 | 처리 |
|---|---|---|
| 8쪽 앱 화면 (다크 테마, 소음 억제, 3초 듣기) | 해당 UI 코드 없음 | UI 신규 제작 (결정) |
| WebSocket 1:N / N:N | 서버 코드 없음 | 신규 구현 (결정) |
| 딥러닝 노이즈 필터링 | 코드 없음 | 플러그인 인터페이스만 제공 (결정) |
| GPT realtime 2.0 | `gpt-4.1-nano` 사용 | `gpt-realtime-2`로 교체 (결정) |

## 5. 재사용 판단

| 대상 | 판단 | 방식 |
|---|---|---|
| UI (`App.tsx`) | 재사용 안 함 | 사용자 결정으로 신규 제작 |
| STT 호출 (`requestAudioTranscription`) | 수정 후 재사용 | 서버로 이동, RN 의존(`Platform`, RN FormData) 제거, Node `FormData`/`Blob` 사용 |
| 번역 호출 (`requestAiTranslation`) | 교체 | `gpt-realtime-2` Realtime 세션 기반으로 새로 작성. 프롬프트의 도메인 규칙 문구는 재사용 |
| 프롬프트 컨텍스트 구성 (`buildPrompt`) | 수정 후 재사용 | 언어 일반화, 데이터셋 어댑터 기반으로 재구성 |
| 오프라인 `translate()` | 재사용 안 함 | MVP는 서버 통역만 사용. 실패 시 실패 상태로 처리 |
| TTS 호출 | 교체 | Realtime 음성 출력으로 대체, 기기 TTS는 재생 실패 시 대체 수단 |
| 타입 (`TranslationEntry`, `RiskLevel`) | 참고 | `server/src/shared`에서 재정의 (위험도는 사용하지 않음) |
| 데이터셋 JSON | 변경 없이 재사용 | 샘플 어댑터가 원본 형식 그대로 읽음 |
| `tools/` 생성 스크립트 | 보존 | 수정하지 않음 |
