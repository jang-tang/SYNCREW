# 노이즈 필터 사이드카 (GTCRN)

스트리밍 통화(1:1)의 100ms 조각을 서버 밖에서 정제하는 웹소켓 사이드카. 규격은 `docs/denoise-sidecar.md`, 배포는 `deploy/README.md` 7절.

```
서버(SafeStreamFilter) ──ws, 3,200바이트──> denoise:8765 ──> 같은 길이·같은 순서로 응답
```

## 모델

| 항목 | 값 |
|---|---|
| 모델 | [GTCRN](https://github.com/Xiaobin-Rong/gtcrn) 스트리밍 ONNX `models/gtcrn_simple.onnx` (DNS3 학습, 저장소 커밋 `502ebfa`, 535KB) |
| 라이선스 | MIT (`models/GTCRN_LICENSE`) |
| 크기·연산 | 약 4.8만 파라미터, 33 MMACs/s |
| 표본율 | 16kHz 그대로 (리샘플 없음) |
| STFT | 512 창 / 256 hop, sqrt-Hann (원본과 같음) |
| 추가 지연 | **32ms** (512표본: 분석 256 + 앞 채움 256). 룩어헤드 없음. 첫 32ms 는 0 |
| 실행 | onnxruntime CPU, 세션 1개를 모든 연결이 공유, 연결마다 캐시 텐서(모델 상태) 따로 |

100ms(1,600표본)는 hop 256 으로 나누어떨어지지 않아서, 출력 앞에 0 을 256개 채워 두고 매번 받은 길이만큼 꺼낸다 (`model.py` 의 `DenoiseStream`).

## 검증 (2026-10-19, Apple Silicon Mac)

- `python -m unittest -v test_denoise.py` — 7개 통과: 항등 모델이면 정확히 32ms 늦은 원본, 조각 길이가 달라도 출력 동일, 연결별 상태 분리, 무음, 원본 섞기, 웹소켓 2연결 동시 순서·길이, `/health`
- GTCRN 저장소의 `stream/test_wavs/mix.wav` 를 스트리밍으로 처리한 결과가 저장소의 오프라인 결과 `enh.wav` 와 일치 (32ms 맞춘 뒤 오차 RMS 0.0003, 신호 RMS 0.064 대비 약 -46dB)
- `bench.py` 왕복 시간 (실시간 간격, 웹소켓 포함):

| 조건 | P50 | P99 | 최대 | 50ms 초과 |
|---|---|---|---|---|
| 4연결, mix.wav 9.7초 | 5.9ms | 9.6ms | 20.3ms | 0 |
| 4연결, 최대 속도 60초 | 4.9ms | 7.8ms | 12.4ms | 0 |
| 8연결, 20초 | 4.4ms | 5.5ms | 12.0ms | 0 |

미검증: EC2 c7g 에서의 수치, 실제 공사 소음에서 받아쓰기 CER 개선 여부 (개발가이드 5절 평가).

## 실행

```bash
cd denoise
uv venv -p 3.12 .venv && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python -m unittest -v test_denoise.py
.venv/bin/python server.py                                    # ws://0.0.0.0:8765
.venv/bin/python bench.py --wav input16k.wav --out enh.wav    # 다른 창에서. 16kHz mono PCM16 wav
```

Docker (EC2 c7g 와 같은 arm64):

```bash
docker build --platform linux/arm64 -t syncrew-denoise .
docker run --rm -p 8765:8765 syncrew-denoise
```

## 설정 (환경 변수)

| 이름 | 기본 | 설명 |
|---|---|---|
| `DENOISE_PORT` | 8765 | |
| `DENOISE_MODEL` | `models/gtcrn_simple.onnx` | 다른 ONNX(파인튜닝 결과) 경로. `identity` 면 32ms 지연만 (연결 시험용) |
| `DENOISE_DRY_MIX` | 0 | 원본 섞는 비율 0~1. 출력 = (1-α)·정제 + α·원본. 과억제로 받아쓰기가 나빠지면 0.1~0.3 |
| `DENOISE_WORKERS` | CPU 수 | 추론 스레드 수 |

## 실패 처리

- 처리 중 예외가 나면 그 조각은 원본을 돌려준다 (1:1 응답 유지). 시간 초과·연속 실패 끄기는 서버의 `SafeStreamFilter` 가 맡는다
- 텍스트 프레임은 무시한다 (규격상 없음)
- 연결이 닫힐 때 로그: `연결 #N 닫힘: 조각 n개, 처리 ms P50 / P99 / 최대, 실패 k`

## 파인튜닝한 모델로 바꾸기

같은 입출력(`mix (1,257,1,2)`, 캐시 `conv_cache (2,1,16,16,33)`, `tra_cache (2,3,1,1,16)`, `inter_cache (2,1,33,16)`)으로
내보낸 ONNX 면 `DENOISE_MODEL` 만 바꾸면 된다. 내보내기는 GTCRN 저장소 `stream/gtcrn_stream.py` (`convert_to_stream` → `torch.onnx.export` → onnxsim).
학습 데이터·녹음은 저장소에 올리지 않는다.
