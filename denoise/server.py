"""노이즈 필터 사이드카 (규격: docs/denoise-sidecar.md).

ws://0.0.0.0:8765 — 통화 스트림 1개 = 웹소켓 1개. 바이너리 프레임(PCM16 LE mono 16kHz, 100ms = 3,200바이트)을 받으면
같은 길이로 정제해 받은 순서대로 1개씩 돌려준다. 연결마다 모델 상태(DenoiseStream)를 따로 둔다.
GET /health 는 200 "ok" (compose healthcheck 용).

환경 변수:
  DENOISE_HOST (0.0.0.0), DENOISE_PORT (8765)
  DENOISE_MODEL       ONNX 경로 (기본 models/gtcrn_simple.onnx). "identity" 면 32ms 지연만 (시험용)
  DENOISE_DRY_MIX     0~1, 원본 섞는 비율 (기본 0). 받아쓰기 정확도(CER)를 보며 과억제를 줄일 때 올린다
  DENOISE_WORKERS     추론 스레드 수 (기본 CPU 수)
  DENOISE_LOG_LEVEL   INFO
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from itertools import count

import numpy as np
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from model import LATENCY_SAMPLES, SAMPLE_RATE, DenoiseStream, FrameModel, load_model_from_env

log = logging.getLogger("denoise")
_ids = count(1)


def process_request(connection: ServerConnection, request: Request) -> Response | None:
    if request.path == "/health":
        return connection.respond(HTTPStatus.OK, "ok\n")
    return None


def make_handler(model: FrameModel, executor: ThreadPoolExecutor, dry_mix: float):
    async def handler(ws: ServerConnection) -> None:
        conn_id = next(_ids)
        stream = DenoiseStream(model, dry_mix=dry_mix)
        loop = asyncio.get_running_loop()
        times: list[float] = []
        errors = 0
        log.info("연결 #%d 열림 (%s)", conn_id, ws.remote_address)
        try:
            async for message in ws:
                if isinstance(message, str):
                    # 규격상 텍스트 프레임(제어 메시지)은 없다. 응답 순서를 흐트러뜨리지 않게 무시한다
                    log.warning("연결 #%d 텍스트 프레임 무시", conn_id)
                    continue
                start = time.perf_counter()
                try:
                    out = await loop.run_in_executor(executor, stream.process, message)
                except Exception:
                    # 처리 실패 시에도 1:1 응답을 지킨다 — 원본을 돌려주면 서버는 그대로 쓴다
                    errors += 1
                    log.exception("연결 #%d 처리 실패 (%d바이트) → 원본 반환", conn_id, len(message))
                    out = message
                times.append((time.perf_counter() - start) * 1000)
                await ws.send(out)
        except ConnectionClosed:
            pass
        finally:
            if times:
                t = np.asarray(times)
                log.info(
                    "연결 #%d 닫힘: 조각 %d개 (%.1f초), 처리 ms P50 %.2f / P99 %.2f / 최대 %.2f, 실패 %d",
                    conn_id, len(t), len(t) * 0.1, np.percentile(t, 50), np.percentile(t, 99), t.max(), errors,
                )
            else:
                log.info("연결 #%d 닫힘: 조각 없음", conn_id)

    return handler


async def main() -> None:
    logging.basicConfig(level=os.environ.get("DENOISE_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # 30초마다 오는 /health 요청이 로그를 채우지 않게
    logging.getLogger("websockets").setLevel(logging.WARNING)
    host = os.environ.get("DENOISE_HOST", "0.0.0.0")
    port = int(os.environ.get("DENOISE_PORT", "8765"))
    dry_mix = float(os.environ.get("DENOISE_DRY_MIX", "0"))
    workers = int(os.environ.get("DENOISE_WORKERS", str(os.cpu_count() or 4)))

    model = load_model_from_env()
    # 첫 추론의 준비 시간이 통화 첫 조각에 걸리지 않도록 미리 한 번 돌린다
    DenoiseStream(model).process(bytes(3200))
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="denoise")
    log.info(
        "모델 %s, 지연 %dms, 원본 섞기 %.2f, 추론 스레드 %d",
        type(model).__name__, LATENCY_SAMPLES * 1000 // SAMPLE_RATE, dry_mix, workers,
    )

    stop = asyncio.get_running_loop().create_future()
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, stop.set_result, None)

    # compression=None: PCM 은 압축 이득이 거의 없고 지연만 는다
    async with serve(make_handler(model, executor, dry_mix), host, port, process_request=process_request, compression=None, max_size=1 << 20):
        log.info("ws://%s:%d 대기 중", host, port)
        await stop
    executor.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    asyncio.run(main())
