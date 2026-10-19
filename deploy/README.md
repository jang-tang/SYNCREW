# 운영 배포 — AWS 시드니 (2026-10-20–31, 10/30 현장 시연)

SYNCREW 서버를 AWS 시드니(ap-southeast-2) EC2 한 대에 Docker Compose 로 올린다. 주소는 **https://syncrew.hyunshu.com**.
운영 기간은 10/20–10/31이고 **10/31에 모두 삭제**한다 (8절). 로컬 PC 실행 방법은 `docs/operations.md` 를 따른다.

| 구성 | 내용 |
|---|---|
| EC2 | c7g.xlarge (ARM64), Amazon Linux 2023. 접속은 SSM (SSH 안 씀) |
| 컨테이너 | `caddy`(80·443, Let's Encrypt 자동 발급) → `server`(4000, 외부에 열지 않음). `denoise` 는 자리만 (`docs/denoise-sidecar.md`) |
| DB | RDS PostgreSQL 18.3 `syncrew-db` (비공개, EC2 보안 그룹에서만 5432). 사용자 `syncrew_admin`, DB `syncrew` |
| 비밀 값 | SSM Parameter Store `/syncrew/*` (사용자가 직접 입력) → `render-env.sh` 가 `deploy/.env`(권한 600, git 제외)로 만든다 |
| 음성 파일 | compose 볼륨 `syncrew_server_data` → 컨테이너 `/data` (`STORAGE_DIR=/data`) |
| DNS | Cloudflare `syncrew.hyunshu.com` A → EC2 탄력적 IP, **DNS only(회색 구름)** — 프록시를 켜면 Caddy 인증서 발급·웹소켓 설정이 달라진다 |
| 배포 방식 | 레지스트리 없음. EC2 에서 `git clone` → `docker compose up -d --build`. 업데이트는 SSM 원격 명령 |

파일: `docker-compose.yml`, `Caddyfile`, `render-env.sh`, 서버 이미지 `server/Dockerfile`(+ `server/.dockerignore`).

## 1. 전제 (인프라 담당이 준비)

- EC2 user-data 로 **docker, docker compose 플러그인, git** 설치 완료. AWS CLI v2·python3 은 AL2023 기본 포함
- 인스턴스 역할 권한: `AmazonSSMManagedInstanceCore`(SSM 접속·원격 명령), `ssm:GetParameter`(`arn:aws:ssm:ap-southeast-2:<계정>:parameter/syncrew/*`), `rds:DescribeDBInstances`. SecureString 을 기본 키(`aws/ssm`)가 아닌 KMS 키로 암호화했다면 `kms:Decrypt` 도
- 보안 그룹: EC2 는 80·443 만 인바운드 (4000·22 안 염). RDS 는 EC2 보안 그룹에서 오는 5432 만
- SSM 파라미터 (사용자가 입력, **Claude·문서·채팅에 값을 적지 않는다**)

  | 이름 | 형식 | 비고 |
  |---|---|---|
  | `/syncrew/OPENAI_API_KEY` | SecureString | `ENGINE=openai` 일 때만 읽는다 |
  | `/syncrew/SUPABASE_SECRET_KEY` | SecureString | |
  | `/syncrew/DB_PASSWORD` | SecureString | RDS 마스터 비밀번호. 특수문자는 스크립트가 URL 인코딩 |
  | `/syncrew/AUDIO_URL_SECRET` | SecureString | 음성 URL 서명 키 (예: `openssl rand -hex 32`). 고정해 두면 서버를 재시작해도 앱의 음성 URL 이 유지된다 |
  | `/syncrew/SUPABASE_URL` | String | `https://<project-ref>.supabase.co` |
  | `/syncrew/SUPABASE_JWKS_URL` | String | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |

  값에 작은따옴표(`'`)나 줄바꿈이 있으면 `render-env.sh` 가 거부한다.
- DNS A 레코드가 탄력적 IP 를 가리키고 있어야 Caddy 가 인증서를 받는다 (`dig +short syncrew.hyunshu.com`)

## 2. 최초 배포

EC2 에 SSM 으로 접속해서 **root 로** 실행한다 (원격 명령 `AWS-RunShellScript` 도 root 로 돈다).

```bash
aws ssm start-session --region ap-southeast-2 --target <인스턴스 ID>   # 내 PC 에서
sudo -i                                                                 # EC2 에서
```

```bash
git clone https://github.com/jang-tang/SYNCREW.git /opt/syncrew
cd /opt/syncrew/deploy
./render-env.sh fake                              # .env 생성 (처음엔 가짜 엔진, 비용 0)
docker compose build server                       # 서버 이미지 (c7g 에서 수 분)
docker compose run --rm server npm run db:deploy  # 마이그레이션 (컨테이너 안 prisma migrate deploy → RDS)
docker compose up -d                              # caddy + server
docker compose ps                                 # server 가 (healthy) 인지
curl -fsS https://syncrew.hyunshu.com/health      # {"status":"ok","db":"ok",...}
```

- 첫 `up` 때 Caddy 가 Let's Encrypt 인증서를 받는다 (수십 초). 실패하면 `docker compose logs caddy` — 대부분 DNS 가 아직 EIP 를 안 가리키거나 80 이 막힌 경우. **실패를 반복하면 Let's Encrypt 발급 제한(같은 주소 시간당 실패 5회)에 걸리므로** 원인을 고친 뒤 다시 시도한다
- `caddy_data` 볼륨에 인증서가 저장된다. 볼륨을 지우지 않는 한 재시작해도 재발급하지 않는다
- 앱(live 모드)은 `EXPO_PUBLIC_API_MODE=live`, `EXPO_PUBLIC_API_BASE_URL=https://syncrew.hyunshu.com` 으로 빌드한다. 실시간 연결은 같은 주소의 `/socket.io/`(네임스페이스 `/rt`), 웹소켓은 Caddy 가 그대로 넘긴다
- DB 연결 주소는 `?uselibpqcompat=true&sslmode=require` 를 붙인다. RDS 는 TLS 를 강제하는데, Node `pg` 는 `sslmode=require` 만 주면 CA 검증까지 하려다 RDS CA 를 몰라 실패한다(로컬 자체 서명 Postgres 로 재현·확인). libpq 와 같은 의미(암호화, CA 검증 없음)로 쓰고, Prisma 마이그레이션도 같은 주소로 동작한다. RDS 는 VPC 안 비공개라 시연 기간에는 이 수준으로 둔다

## 3. 업데이트 (SSM 원격 명령)

`main` 에 합쳐진 코드를 EC2 에 반영한다. 직전 이미지를 `syncrew-server:prev` 로 남겨 두어 6절 롤백에 쓴다.

```bash
# 내 PC 에서
aws ssm send-command --region ap-southeast-2 \
  --instance-ids <인스턴스 ID> \
  --document-name AWS-RunShellScript \
  --comment "syncrew update" \
  --parameters 'commands=["set -e","cd /opt/syncrew","docker image inspect syncrew-server:latest >/dev/null 2>&1 && docker tag syncrew-server:latest syncrew-server:prev","git fetch origin","git checkout -q main","git pull --ff-only","cd deploy","docker compose build server","docker compose run --rm server npm run db:deploy","docker compose up -d","sleep 20","docker compose ps"]' \
  --query Command.CommandId --output text

aws ssm get-command-invocation --region ap-southeast-2 \
  --command-id <위 출력> --instance-id <인스턴스 ID> \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
```

- 서버를 바꾸는 동안 통화·업로드가 끊긴다 (서버는 진행 중 통역을 최대 5초 기다린 뒤 종료, 앱은 다시 연결한다). 시연 중에는 업데이트하지 않는다
- `Caddyfile` 만 바꿨다면: `docker compose restart caddy` (또는 `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`)

## 4. 로그·상태 보기

```bash
cd /opt/syncrew/deploy
docker compose ps                          # 상태·healthcheck
docker compose logs -f --tail=200 server   # 서버 (pino JSON)
docker compose logs -f --tail=100 caddy    # 접속·인증서
docker stats --no-stream                   # CPU·메모리
df -h / && docker system df                # 디스크
```

- 로그는 컨테이너마다 10MB × 5개까지만 남긴다 (`docker-compose.yml` 의 `logging`)
- 사용량(OpenAI 누적 비용): `docker compose exec server npx tsx -e 'import {createPrismaClient} from "./src/lib/prisma";const p=createPrismaClient(process.env.DATABASE_URL!);p.openAiUsage.aggregate({_sum:{costUsd:true}}).then(r=>{console.log(r._sum);return p.$disconnect()})'`

## 5. ENGINE 전환 (fake ↔ openai)

```bash
cd /opt/syncrew/deploy
./render-env.sh openai && docker compose up -d server   # 실제 OpenAI (비용 발생)
./render-env.sh fake   && docker compose up -d server   # 가짜 엔진으로 되돌리기 (비용 0)
```

- `.env` 가 바뀌면 `docker compose up -d` 가 server 컨테이너만 다시 만든다
- **openai 로 바꾸기 전에 예상 비용을 팀에 알리고 승인받는다** (루트 `CLAUDE.md` 규칙). 이 배포의 서버 한도는 `OPENAI_BUDGET_USD=20`, `OPENAI_BUDGET_PERIOD=total` — RDS 가 새 DB 라 이 배포에서 쓴 누적액 기준이다. 한도를 넘는 호출은 서버가 `BUDGET_EXCEEDED`(402)로 거절한다
  - 참고 단가: 스트리밍 통화 말한 1분당 약 $0.18, 음성 메시지 1건 약 $0.01 (`docs/operations.md` 4절)
  - 한도를 바꾸려면 `OPENAI_BUDGET_USD=30 ./render-env.sh openai` (금액은 먼저 팀에 알린다)
- fake 일 때는 `.env` 에 OpenAI 키를 넣지 않는다 (`/health` 의 `openai` 가 `not_configured` 로 보이는 것이 정상)

## 6. 롤백

```bash
cd /opt/syncrew/deploy
# A. 직전 이미지로 (3절 업데이트가 남긴 prev)
docker tag syncrew-server:prev syncrew-server:latest
docker compose up -d --no-build server

# B. 특정 커밋으로 다시 빌드
cd /opt/syncrew && git checkout -q <커밋> && cd deploy
docker compose up -d --build server
# 고친 뒤 main 으로 복귀: git checkout -q main && git pull --ff-only
```

- 마이그레이션은 되돌리지 않는다 (Prisma 는 앞으로만). 새 마이그레이션이 들어간 업데이트를 롤백하면 옛 코드가 새 스키마 위에서 돈다 — 컬럼 추가 정도면 대개 동작하지만, 그런 업데이트는 시연 직전에 하지 않는다
- 설정만 잘못됐다면 `./render-env.sh <fake|openai> [passthrough|sidecar]` 를 다시 실행하고 `docker compose up -d server`

## 7. 노이즈 필터 사이드카

`docker-compose.yml` 의 `denoise` 는 `profiles: ["denoise"]` 라 평소에는 뜨지 않는다. 구현은 `denoise/` (GTCRN, `denoise/README.md`), EC2 에서 arm64 로 바로 빌드한다.
서버는 `.env` 의 `STREAM_AUDIO_FILTER=sidecar` 일 때만 사이드카(`DENOISE_URL`, 기본 `ws://denoise:8765`)를 쓴다. 규격·동작: `docs/denoise-sidecar.md` (4절이 서버 연결).

켜기 (fake 엔진으로 먼저 확인, 비용 0):

```bash
cd /opt/syncrew/deploy
./render-env.sh fake sidecar                    # .env: STREAM_AUDIO_FILTER=sidecar, DENOISE_URL='ws://denoise:8765'
docker compose --profile denoise up -d --build  # denoise 와 server 를 함께 (server 는 .env 가 바뀌어 다시 만들어진다)
```

- 실제 엔진: `./render-env.sh openai sidecar && docker compose --profile denoise up -d` (`STREAM_AUDIO_FILTER=sidecar ./render-env.sh openai` 도 같다)
- 확인: 통화를 하나 끝낸 뒤 `docker compose logs server | grep "스트리밍 노이즈 필터"`
  - `스트리밍 노이즈 필터 결과` 의 `filtered` 가 조각 수와 같고 `failed` 0 이면 정상
  - `스트리밍 노이즈 필터 실패, 원본 조각 사용` / `끔 (연속 실패)` 가 보이면 사이드카 연결·처리 시간을 본다 (`docker compose logs denoise`). 통역은 원본으로 계속된다
  - 사이드카 쪽: `docker compose logs -f denoise` — 연결마다 닫힐 때 `처리 ms P50 / P99` 가 찍힌다
- EC2 안에서 사이드카 처리 시간 측정: `docker compose exec denoise python bench.py` (동시 4연결, P99 < 30ms 이면 통과)
- 원본 섞기: `DENOISE_DRY_MIX=0.2 docker compose --profile denoise up -d denoise` (`.env` 는 `render-env.sh` 가 다시 만들므로 셸 변수로 준다)
- 끄기: `./render-env.sh <fake|openai>` (기본 passthrough) → `docker compose up -d server`. 사이드카는 `docker compose stop denoise`
- `--profile denoise` 없이 `up -d` 하면 denoise 가 뜨지 않는다 → `sidecar` 로 켜 두었다면 통화마다 연결 실패 5번 뒤 필터 없이 계속된다 (통역은 된다)

## 8. 10/31 정리 (백업 → 삭제)

### 8-1. 백업 (보관할 경우만)

음성 파일·대화 기록에는 현장 작업자의 목소리·개인 정보가 들어 있다. **무엇을 얼마나 남길지 팀이 먼저 정하고**, 남기지 않기로 하면 8-2로 바로 간다.

```bash
sudo -i
cd /opt/syncrew/deploy
mkdir -p /opt/syncrew-backup
docker compose stop server                       # 쓰기 멈춤

# DB (pg_dump 18 — RDS 18.3 과 같은 주 버전). libpq 는 uselibpqcompat 를 모르므로 떼고 sslmode=require 만
set -a; . ./.env; set +a
docker run --rm -e PGURL="${DATABASE_URL%%\?*}?sslmode=require" -v /opt/syncrew-backup:/backup postgres:18 \
  sh -c 'pg_dump "$PGURL" -Fc -f /backup/syncrew-$(date +%Y%m%d).dump'

# 음성 파일 (/data)
docker run --rm -v syncrew_server_data:/data:ro -v /opt/syncrew-backup:/backup syncrew-server:latest \
  tar czf /backup/data-$(date +%Y%m%d).tgz -C /data .

ls -lh /opt/syncrew-backup
```

- EC2 밖으로 옮기는 방법은 인프라 담당과 정한다 (예: 임시 S3 버킷에 `aws s3 cp` → 내 PC 로 받기 → 버킷 삭제. 역할에 `s3:PutObject` 필요). 인스턴스를 지우면 `/opt/syncrew-backup` 도 사라진다
- 복원 확인(선택): 로컬에서 `pg_restore --list syncrew-YYYYMMDD.dump | head`

### 8-2. 리소스 삭제 목록 (인프라 담당, 순서대로)

| # | 리소스 | 비고 |
|---|---|---|
| 1 | EC2 인스턴스 | 루트 EBS 가 "종료 시 삭제"인지 확인, 아니면 볼륨 따로 삭제 |
| 2 | 탄력적 IP | 인스턴스 삭제 뒤 **반드시 릴리스** (연결 안 된 EIP 도 과금) |
| 3 | RDS `syncrew-db` | 최종 스냅샷 여부는 8-1 결정에 따름. 자동 백업·수동 스냅샷도 삭제 |
| 4 | DB 서브넷 그룹·파라미터 그룹 | 만들었다면 |
| 5 | 보안 그룹 (EC2용·RDS용) | 인스턴스·RDS 삭제 후 |
| 6 | IAM 역할·인스턴스 프로파일·인라인/고객 관리형 정책 | |
| 7 | SSM 파라미터 `/syncrew/*` 6개 | |
| 8 | 백업용 S3 버킷, CloudWatch 로그 그룹, 키 페어 | 만들었다면 |
| 9 | Cloudflare `syncrew.hyunshu.com` A 레코드 | 지우지 않으면 남의 IP 를 가리키게 된다 |
| 10 | (권장) 키 교체 | 서버에 있던 OpenAI 키·Supabase secret key 를 새로 발급하고 옛 키 폐기 |

- 다음 날 Billing → 비용 탐색기에서 시드니 리전 비용이 0 으로 떨어졌는지 확인한다
