#!/usr/bin/env bash
# SSM Parameter Store 에서 비밀 값을 읽어 deploy/.env 를 만든다 (EC2 에서 실행, 인스턴스 역할 사용).
#
#   사용법: deploy/render-env.sh [fake|openai] [passthrough|sidecar]
#     1번째: 엔진 (기본 fake — OpenAI 호출 없음, 비용 0)
#     2번째: 스트리밍 노이즈 필터 STREAM_AUDIO_FILTER (기본 passthrough = 필터 없음,
#            sidecar = denoise 컨테이너 사용 → `docker compose --profile denoise up -d` 로 함께 띄울 것. docs/denoise-sidecar.md)
#            변수로 줘도 된다: STREAM_AUDIO_FILTER=sidecar ./render-env.sh openai (인자가 우선)
#
#   - 값은 화면에 출력하지 않는다. 결과 파일은 권한 600, git 제외(루트 .gitignore 의 .env).
#   - 변수 목록은 server/src/config/env.ts · server/.env.example 기준 (전부 적는다).
#   - fake 면 OPENAI_API_KEY 를 비워 둔다 (실수로 실제 호출이 나가지 않게).
#   - 인스턴스 역할 권한: ssm:GetParameter(/syncrew/*), rds:DescribeDBInstances,
#     (SecureString 을 고객 관리형 KMS 키로 암호화했다면) kms:Decrypt.
#
# 덮어쓸 수 있는 환경 변수: AWS_REGION, SSM_PREFIX, DB_INSTANCE_ID, DB_USER, DB_NAME,
#   DB_HOST·DB_PORT(지정하면 RDS 조회 생략), OPENAI_BUDGET_USD,
#   STREAM_AUDIO_FILTER(passthrough|sidecar, 기본 passthrough — 2번째 인자가 우선), DENOISE_URL(기본 ws://denoise:8765)
set -euo pipefail
umask 077

ENGINE="${1:-fake}"
FILTER="${2:-${STREAM_AUDIO_FILTER:-passthrough}}"
case "$ENGINE" in
  fake | openai) ;;
  *)
    echo "사용법: $0 [fake|openai] [passthrough|sidecar]" >&2
    exit 2
    ;;
esac
case "$FILTER" in
  passthrough | sidecar) ;;
  *)
    echo "사용법: $0 [fake|openai] [passthrough|sidecar] (받은 필터: $FILTER)" >&2
    exit 2
    ;;
esac
DENOISE_URL="${DENOISE_URL:-ws://denoise:8765}"

REGION="${AWS_REGION:-ap-southeast-2}"
PREFIX="${SSM_PREFIX:-/syncrew}"
DB_INSTANCE_ID="${DB_INSTANCE_ID:-syncrew-db}"
DB_USER="${DB_USER:-syncrew_admin}"
DB_NAME="${DB_NAME:-syncrew}"
BUDGET="${OPENAI_BUDGET_USD:-20}"

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/.env"

# SSM 값 하나 읽기 (SecureString 은 복호화). 값은 변수로만 받고 출력하지 않는다.
param() {
  aws ssm get-parameter --region "$REGION" --name "$PREFIX/$1" --with-decryption \
    --query Parameter.Value --output text
}

# compose env_file 은 작은따옴표 값을 그대로 쓴다 ($ 치환 없음). 작은따옴표·줄바꿈이 든 값은 거부.
check_value() {
  case "$2" in
    *"'"* | *$'\n'*)
      echo "오류: $1 값에 작은따옴표나 줄바꿈이 있어 .env 에 안전하게 쓸 수 없습니다." >&2
      exit 1
      ;;
  esac
}

echo "SSM($PREFIX, $REGION)에서 설정을 읽는 중..."
SUPABASE_URL="$(param SUPABASE_URL)"
SUPABASE_JWKS_URL="$(param SUPABASE_JWKS_URL)"
SUPABASE_SECRET_KEY="$(param SUPABASE_SECRET_KEY)"
DB_PASSWORD="$(param DB_PASSWORD)"
AUDIO_URL_SECRET="$(param AUDIO_URL_SECRET)"
OPENAI_API_KEY=""
if [ "$ENGINE" = "openai" ]; then
  OPENAI_API_KEY="$(param OPENAI_API_KEY)"
fi

if [ -z "${DB_HOST:-}" ]; then
  echo "RDS($DB_INSTANCE_ID) 엔드포인트 조회 중..."
  read -r DB_HOST DB_PORT < <(aws rds describe-db-instances --region "$REGION" \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --query 'DBInstances[0].Endpoint.[Address,Port]' --output text) || true
fi
DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-5432}"
if [ -z "$DB_HOST" ] || [ "$DB_HOST" = "None" ]; then
  echo "오류: RDS 엔드포인트를 찾지 못했습니다 (인스턴스가 아직 생성 중일 수 있음)." >&2
  exit 1
fi

# 비밀번호는 URL 인코딩 (명령줄 인자로 넘기지 않고 표준 입력으로)
DB_PASSWORD_ENC="$(printf '%s' "$DB_PASSWORD" | python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')"
# RDS PostgreSQL 은 TLS 를 강제한다(rds.force_ssl). Node pg 에서 sslmode=require 만 쓰면 CA 검증까지 하려다
# RDS CA 를 몰라 실패하므로, libpq 와 같은 의미(암호화, CA 검증 없음)로 쓴다. Prisma migrate 도 같은 주소로 동작.
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD_ENC}@${DB_HOST}:${DB_PORT}/${DB_NAME}?uselibpqcompat=true&sslmode=require"

for name in SUPABASE_URL SUPABASE_JWKS_URL SUPABASE_SECRET_KEY AUDIO_URL_SECRET OPENAI_API_KEY DATABASE_URL DENOISE_URL; do
  check_value "$name" "${!name}"
done
for name in SUPABASE_URL SUPABASE_JWKS_URL SUPABASE_SECRET_KEY DB_PASSWORD AUDIO_URL_SECRET; do
  if [ -z "${!name}" ]; then
    echo "오류: SSM $PREFIX/$name 값이 비어 있습니다." >&2
    exit 1
  fi
done
if [ "$ENGINE" = "openai" ] && [ -z "$OPENAI_API_KEY" ]; then
  echo "오류: ENGINE=openai 인데 SSM $PREFIX/OPENAI_API_KEY 값이 비어 있습니다." >&2
  exit 1
fi

TMP="$(mktemp "$DIR/.env.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

cat >"$TMP" <<EOF
# deploy/render-env.sh 가 $(date -u +%Y-%m-%dT%H:%M:%SZ) 에 만든 파일 — 직접 고치지 말고 스크립트를 다시 실행할 것
# ENGINE=$ENGINE STREAM_AUDIO_FILTER=$FILTER

# ─── 서버 ───
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
LOG_LEVEL=info

# ─── 데이터베이스 (RDS $DB_INSTANCE_ID) ───
DATABASE_URL='$DATABASE_URL'

# ─── OpenAI ───
OPENAI_API_KEY='$OPENAI_API_KEY'
OPENAI_BUDGET_USD=$BUDGET
OPENAI_BUDGET_PERIOD=total
OPENAI_PRICING_JSON=
STT_MODEL=gpt-4o-transcribe
STREAM_STT_MODEL=gpt-live-transcribe
TRANSLATION_MODEL=gpt-realtime-2.1
ENGINE=$ENGINE
TRANSLATION_AUDIO=on
TRANSLATION_CONCURRENCY=4
TRANSLATION_REASONING=low
TRANSLATION_VOICE=marin
STREAMING=on
STREAM_MAX_SESSIONS=8
STREAM_VAD_SILENCE_MS=350
STREAM_LIVE_TRANSCRIPTION=on
STREAM_DEBUG=0
STREAM_AUDIO_FILTER=$FILTER
DENOISE_URL='$DENOISE_URL'

# ─── 저장소 (compose 볼륨 server_data) ───
STORAGE_DIR=/data
AUDIO_URL_SECRET='$AUDIO_URL_SECRET'

# ─── 플러그인 ───
AUDIO_PREPROCESSOR=passthrough
DATASET_ADAPTER=legacy-workplace
DATASET_PATH=./data/legacy-workplace
RETENTION_POLICY=noop
RETENTION_RUN_AT=03:00

# ─── Supabase (인증 전용) ───
SUPABASE_URL='$SUPABASE_URL'
SUPABASE_JWKS_URL='$SUPABASE_JWKS_URL'
SUPABASE_SECRET_KEY='$SUPABASE_SECRET_KEY'
EOF

chmod 600 "$TMP"
mv -f "$TMP" "$OUT"
trap - EXIT
echo "작성 완료: $OUT (권한 600, ENGINE=$ENGINE, STREAM_AUDIO_FILTER=$FILTER, OPENAI_BUDGET_USD=$BUDGET). 값은 출력하지 않았습니다."
if [ "$FILTER" = "sidecar" ]; then
  echo "적용: cd $DIR && docker compose --profile denoise up -d   (denoise 사이드카와 함께)"
else
  echo "적용: cd $DIR && docker compose up -d server"
fi
