# 노이즈 필터 사이드카 (규격: docs/denoise-sidecar.md). EC2 c7g 용으로 linux/arm64 빌드:
#   docker build --platform linux/arm64 -t syncrew-denoise .
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY model.py server.py bench.py test_denoise.py ./
COPY models/ ./models/

RUN useradd --system --uid 10001 denoise
USER denoise

EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3).status == 200 else 1)"

CMD ["python", "server.py"]
