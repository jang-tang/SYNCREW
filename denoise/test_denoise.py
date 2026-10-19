"""사이드카 시험 (표준 라이브러리 unittest — 추가 설치 없음).

  python -m unittest -v test_denoise.py
"""

from __future__ import annotations

import asyncio
import os
import unittest
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from model import DEFAULT_MODEL_PATH, LATENCY_SAMPLES, DenoiseStream, GtcrnOnnx, IdentityModel
from server import make_handler, process_request

CHUNK = 1600


def speechlike(seconds: float, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(int(16000 * seconds)) / 16000
    return (0.3 * np.sin(2 * np.pi * 220 * t) * (np.sin(2 * np.pi * 2 * t) > 0) + 0.05 * rng.standard_normal(len(t))).astype(np.float32)


def to_pcm(x: np.ndarray) -> bytes:
    return (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()


class StreamTest(unittest.TestCase):
    def test_identity_is_delayed_copy(self):
        x = speechlike(2)
        st = DenoiseStream(IdentityModel())
        y = np.concatenate([st.process_float(x[i : i + CHUNK]) for i in range(0, len(x), CHUNK)])
        self.assertEqual(len(y), len(x))
        np.testing.assert_allclose(y[:LATENCY_SAMPLES], 0, atol=1e-6)
        np.testing.assert_allclose(y[LATENCY_SAMPLES:], x[:-LATENCY_SAMPLES], atol=1e-5)

    def test_any_chunk_length_keeps_length(self):
        st = DenoiseStream(IdentityModel())
        for n in [1600, 1, 255, 256, 257, 1000, 3333, 0, 1600]:
            self.assertEqual(len(st.process_float(np.zeros(n, dtype=np.float32))), n)

    def test_chunking_does_not_change_output(self):
        model = GtcrnOnnx(DEFAULT_MODEL_PATH)
        x = speechlike(3, seed=1)
        a = DenoiseStream(model)
        ya = np.concatenate([a.process_float(x[i : i + CHUNK]) for i in range(0, len(x), CHUNK)])
        b = DenoiseStream(model)
        yb = np.concatenate([b.process_float(x[i : i + 700]) for i in range(0, len(x), 700)])
        np.testing.assert_allclose(ya, yb, atol=1e-5)

    def test_connections_have_separate_state(self):
        model = GtcrnOnnx(DEFAULT_MODEL_PATH)
        x = speechlike(2, seed=2)
        a, b = DenoiseStream(model), DenoiseStream(model)
        ya, yb = [], []
        for i in range(0, len(x), CHUNK):
            ya.append(a.process_float(x[i : i + CHUNK]))
            b.process_float(np.zeros(CHUNK, dtype=np.float32))  # 다른 연결이 끼어들어도
        solo = DenoiseStream(model)
        ys = np.concatenate([solo.process_float(x[i : i + CHUNK]) for i in range(0, len(x), CHUNK)])
        np.testing.assert_allclose(np.concatenate(ya), ys, atol=1e-6)

    def test_pcm_bytes_and_silence(self):
        st = DenoiseStream(GtcrnOnnx(DEFAULT_MODEL_PATH))
        for _ in range(5):
            out = st.process(bytes(3200))
            self.assertEqual(len(out), 3200)
            self.assertLess(np.abs(np.frombuffer(out, "<i2")).max(), 50)
        with self.assertRaises(ValueError):
            st.process(b"\x00" * 3)

    def test_dry_mix_one_is_delayed_original(self):
        x = speechlike(1, seed=3)
        st = DenoiseStream(GtcrnOnnx(DEFAULT_MODEL_PATH), dry_mix=1.0)
        y = np.concatenate([st.process_float(x[i : i + CHUNK]) for i in range(0, len(x), CHUNK)])
        np.testing.assert_allclose(y[LATENCY_SAMPLES:], x[:-LATENCY_SAMPLES], atol=1e-6)


class ServerTest(unittest.TestCase):
    def test_two_connections_in_order(self):
        asyncio.run(self._run())

    async def _run(self):
        executor = ThreadPoolExecutor(max_workers=2)
        handler = make_handler(IdentityModel(), executor, 0.0)
        async with serve(handler, "127.0.0.1", 0, process_request=process_request, compression=None) as server:
            port = server.sockets[0].getsockname()[1]
            url = f"ws://127.0.0.1:{port}"

            async def call(seed: int) -> None:
                x = to_pcm(speechlike(1, seed))
                out = bytearray()
                async with connect(url, compression=None) as ws:
                    await ws.send("무시되는 텍스트")
                    for i in range(0, len(x), 3200):
                        await ws.send(x[i : i + 3200])
                        reply = await ws.recv()
                        self.assertIsInstance(reply, bytes)
                        self.assertEqual(len(reply), 3200)
                        out += reply
                a = np.frombuffer(bytes(out), "<i2").astype(np.int32)
                b = np.frombuffer(x, "<i2").astype(np.int32)
                # 항등 모델 → 32ms 늦은 원본 (반올림 1 이내)
                self.assertLessEqual(np.abs(a[LATENCY_SAMPLES:] - b[:-LATENCY_SAMPLES]).max(), 1)

            await asyncio.gather(call(10), call(11))

            # /health
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
            status = await reader.readline()
            writer.close()
            self.assertIn(b"200", status)
        executor.shutdown()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    unittest.main()
