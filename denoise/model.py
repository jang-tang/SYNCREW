"""GTCRN 스트리밍 노이즈 제거 (16kHz, CPU, onnxruntime).

모델: GTCRN (https://github.com/Xiaobin-Rong/gtcrn, MIT) 의 스트리밍 ONNX `stream/onnx_models/gtcrn_simple.onnx`
(DNS3 학습 체크포인트에서 변환한 것). 한 번에 STFT 프레임 1개를 받아 같은 모양을 돌려주고, 모델 상태는 캐시 텐서 3개로 주고받는다.

STFT 는 원본과 같다: n_fft = win = 512 (32ms), hop = 256 (16ms), sqrt-Hann(주기형) 창.
분석 창 × 합성 창 = Hann 이라 50% 겹쳐 더하면 정확히 1 이 되어 별도 정규화가 없다.

지연: 100ms 조각(1,600표본)은 hop(256)으로 나누어떨어지지 않으므로 출력 앞에 0 을 256개 채워 두고
들어온 길이만큼 항상 꺼낼 수 있게 한다. 총 지연은 512표본 = 32ms (분석 지연 256 + 채움 256). 룩어헤드는 없다.
"""

from __future__ import annotations

import os
from typing import Protocol

import numpy as np
import onnxruntime as ort

SAMPLE_RATE = 16000
N_FFT = 512
HOP = 256
N_BINS = N_FFT // 2 + 1  # 257
# 출력 앞에 채우는 0 (어떤 조각 길이든 hop 나머지는 255 이하라 256 이면 항상 충분하다)
PREFILL = HOP
LATENCY_SAMPLES = HOP + PREFILL  # 512 = 32ms

DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "gtcrn_simple.onnx")

# 주기형 Hann 의 제곱근 (torch.hann_window(512).pow(0.5) 와 같다)
WINDOW = np.sqrt(0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)


class FrameModel(Protocol):
    """STFT 프레임 1개 → 정제된 프레임 1개. 상태는 호출자가 들고 다닌다."""

    def initial_state(self) -> object: ...

    def run(self, spec: np.ndarray, state: object) -> tuple[np.ndarray, object]:
        """spec: complex64 (257,) → (complex64 (257,), 새 상태)"""
        ...


class GtcrnOnnx:
    """세션 1개를 모든 연결이 같이 쓴다 (onnxruntime 의 run 은 스레드 안전). 연결별 상태는 캐시 텐서."""

    def __init__(self, model_path: str = DEFAULT_MODEL_PATH, intra_op_threads: int = 1):
        opts = ort.SessionOptions()
        # 연결 1개 = 코어 1개로 쓰고, 동시 연결은 스레드 풀이 나눠 가진다
        opts.intra_op_num_threads = intra_op_threads
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
        self._cache_shapes = {i.name: i.shape for i in self.session.get_inputs() if i.name != "mix"}

    def initial_state(self) -> dict[str, np.ndarray]:
        return {name: np.zeros(shape, dtype=np.float32) for name, shape in self._cache_shapes.items()}

    def run(self, spec: np.ndarray, state: dict[str, np.ndarray]) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        mix = np.empty((1, N_BINS, 1, 2), dtype=np.float32)
        mix[0, :, 0, 0] = spec.real
        mix[0, :, 0, 1] = spec.imag
        enh, conv, tra, inter = self.session.run(
            None,
            {"mix": mix, "conv_cache": state["conv_cache"], "tra_cache": state["tra_cache"], "inter_cache": state["inter_cache"]},
        )
        out = (enh[0, :, 0, 0] + 1j * enh[0, :, 0, 1]).astype(np.complex64)
        return out, {"conv_cache": conv, "tra_cache": tra, "inter_cache": inter}


class IdentityModel:
    """시험용: 스펙트럼을 그대로 돌려준다 (출력 = 입력을 32ms 늦춘 것)"""

    def initial_state(self) -> None:
        return None

    def run(self, spec: np.ndarray, state: None) -> tuple[np.ndarray, None]:
        return spec, state


class DenoiseStream:
    """통화 스트림 1개의 상태. process 는 받은 길이와 같은 길이를 돌려준다 (순서대로 한 번에 하나씩 호출할 것)."""

    def __init__(self, model: FrameModel, dry_mix: float = 0.0):
        if not 0.0 <= dry_mix <= 1.0:
            raise ValueError("dry_mix 는 0~1")
        self.model = model
        self.dry_mix = np.float32(dry_mix)
        self.state = model.initial_state()
        self.pending = np.zeros(0, dtype=np.float32)  # 아직 hop 을 못 채운 입력
        self.prev = np.zeros(HOP, dtype=np.float32)  # 직전 hop 입력 (분석 창 앞 절반)
        self.ola = np.zeros(HOP, dtype=np.float32)  # 겹쳐 더하기 뒤 절반
        self.out = np.zeros(PREFILL, dtype=np.float32)  # 내보낼 출력 (앞 채움 포함)

    def process(self, pcm: bytes) -> bytes:
        """PCM16 LE mono 바이트 → 같은 길이의 PCM16 LE mono 바이트"""
        if len(pcm) % 2:
            raise ValueError("PCM16 바이트 길이는 짝수여야 한다")
        x = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        y = self.process_float(x)
        return np.clip(np.rint(y * 32768.0), -32768, 32767).astype("<i2").tobytes()

    def process_float(self, x: np.ndarray) -> np.ndarray:
        n = len(x)
        buf = np.concatenate([self.pending, x]) if len(self.pending) else x
        hops = len(buf) // HOP
        produced = []
        for h in range(hops):
            cur = buf[h * HOP : (h + 1) * HOP]
            frame = np.concatenate([self.prev, cur]) * WINDOW
            enh, self.state = self.model.run(np.fft.rfft(frame).astype(np.complex64), self.state)
            t = np.fft.irfft(enh, n=N_FFT).astype(np.float32) * WINDOW
            wet = self.ola + t[:HOP]
            # 이번에 확정된 출력은 self.prev 구간이다 → 원본 섞기도 그 구간과 맞춘다
            produced.append(wet if self.dry_mix == 0 else (1 - self.dry_mix) * wet + self.dry_mix * self.prev)
            self.ola = t[HOP:]
            self.prev = cur.copy()
        self.pending = buf[hops * HOP :].copy()
        if produced:
            self.out = np.concatenate([self.out, *produced])
        result, self.out = self.out[:n], self.out[n:]
        return result


def load_model_from_env() -> FrameModel:
    path = os.environ.get("DENOISE_MODEL", DEFAULT_MODEL_PATH)
    if path == "identity":
        return IdentityModel()
    return GtcrnOnnx(path)

