"""사이드카 처리 시간 측정 (docs/denoise-sidecar.md 5절).

동시 연결 N개가 각자 100ms 조각(3,200바이트)을 보내고 응답을 기다린다 (서버와 같은 방식: 앞 조각 응답 후 다음 조각).
조각별 왕복 시간 P50·P99, 응답 길이·개수를 확인하고, 첫 연결의 출력을 wav 로 저장할 수 있다.

  python bench.py                                  # ws://127.0.0.1:8765, 4연결, 30초 분량, 실시간 간격
  python bench.py --wav input.wav --out enh.wav    # 16kHz mono wav 를 보내고 결과 저장
  python bench.py --fast                           # 간격 없이 최대 속도로 (부하 시험)

목표: 동시 4연결에서 P99 < 30ms (규격 상한 50ms).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import wave

import numpy as np
from websockets.asyncio.client import connect

CHUNK_BYTES = 3200
CHUNK_SEC = 0.1


def load_pcm(path: str | None, seconds: float) -> bytes:
    if path:
        with wave.open(path, "rb") as w:
            if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
                sys.exit(f"{path}: 16kHz mono PCM16 wav 만 받는다 (지금 {w.getframerate()}Hz, {w.getnchannels()}ch, {w.getsampwidth() * 8}bit)")
            pcm = w.readframes(w.getnframes())
    else:
        # 음성 대신 쓰는 합성 신호: 흔들리는 톤 + 흰 잡음
        rng = np.random.default_rng(0)
        t = np.arange(int(16000 * seconds)) / 16000
        x = 0.2 * np.sin(2 * np.pi * (200 + 50 * np.sin(2 * np.pi * 3 * t)) * t) + 0.05 * rng.standard_normal(len(t))
        pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    pcm = pcm[: len(pcm) - len(pcm) % CHUNK_BYTES]
    if not pcm:
        sys.exit("입력이 100ms 보다 짧다")
    return pcm


async def run_conn(url: str, pcm: bytes, realtime: bool, delay: float) -> tuple[list[float], bytes, int]:
    await asyncio.sleep(delay)  # 연결마다 조각 시점을 조금씩 어긋나게 (실제 통화처럼)
    times: list[float] = []
    out = bytearray()
    bad = 0
    async with connect(url, compression=None, max_size=1 << 20) as ws:
        start = time.perf_counter()
        for i in range(0, len(pcm), CHUNK_BYTES):
            if realtime:
                wait = start + (i // CHUNK_BYTES) * CHUNK_SEC - time.perf_counter()
                if wait > 0:
                    await asyncio.sleep(wait)
            t0 = time.perf_counter()
            await ws.send(pcm[i : i + CHUNK_BYTES])
            reply = await ws.recv()
            times.append((time.perf_counter() - t0) * 1000)
            if not isinstance(reply, bytes) or len(reply) != CHUNK_BYTES:
                bad += 1
            out += reply if isinstance(reply, bytes) else b""
    return times, bytes(out), bad


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default="ws://127.0.0.1:8765")
    p.add_argument("--conns", type=int, default=4, help="동시 연결 수 (기본 4 = 서버 STREAM_MAX_SESSIONS)")
    p.add_argument("--seconds", type=float, default=30, help="--wav 가 없을 때 합성 신호 길이")
    p.add_argument("--wav", help="16kHz mono PCM16 wav")
    p.add_argument("--out", help="첫 연결의 출력을 저장할 wav (32ms 늦게 시작한다)")
    p.add_argument("--fast", action="store_true", help="실시간 간격 없이 최대 속도로 보낸다")
    args = p.parse_args()

    pcm = load_pcm(args.wav, args.seconds)
    n_chunks = len(pcm) // CHUNK_BYTES
    results = await asyncio.gather(
        *[run_conn(args.url, pcm, not args.fast, i * CHUNK_SEC / args.conns) for i in range(args.conns)]
    )

    all_t = np.concatenate([np.asarray(t) for t, _, _ in results])
    bad = sum(b for _, _, b in results)
    lost = sum(n_chunks - len(t) for t, _, _ in results)
    print(f"연결 {args.conns}개 × 조각 {n_chunks}개 ({n_chunks * CHUNK_SEC:.1f}초), {'최대 속도' if args.fast else '실시간 간격'}")
    print(f"왕복 ms  P50 {np.percentile(all_t, 50):.2f}  P90 {np.percentile(all_t, 90):.2f}  P99 {np.percentile(all_t, 99):.2f}  최대 {all_t.max():.2f}")
    print(f"50ms 초과 {int((all_t > 50).sum())}개, 길이 틀린 응답 {bad}개, 빠진 응답 {lost}개")
    if args.out:
        with wave.open(args.out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(results[0][1])
        print(f"출력 저장: {args.out}")
    ok = np.percentile(all_t, 99) < 30 and bad == 0 and lost == 0
    print("통과 (P99 < 30ms)" if ok else "미달")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
