# SYNCREW 서버 이미지 (AWS 시드니 EC2 c7g = linux/arm64, docs: deploy/README.md)
# npm start 가 tsx 로 TypeScript 를 바로 실행하므로 dev 의존성까지 설치한다 (빌드 단계 없음).
FROM node:22-bookworm-slim

# Prisma 마이그레이션 엔진이 OpenSSL 을 찾고, RDS TLS 연결에 CA 목록이 필요하다
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# 컨테이너 로그에 npm 업데이트 안내가 섞이지 않게
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# 의존성 먼저 (소스만 바뀌면 이 층은 캐시 재사용).
# postinstall(prisma generate)이 스키마·설정을 읽으므로 같이 복사한다.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --include=dev && npm cache clean --force

COPY . .
# Prisma 클라이언트 생성 (src/generated 는 .dockerignore 로 제외되므로 이미지 안에서 만든다)
RUN npx prisma generate

# 업로드·번역 음성 저장 위치 (compose 에서 볼륨으로 붙이고 STORAGE_DIR=/data).
# 앱 파일은 root 소유·읽기 전용으로 두고, 쓰는 곳은 /data 뿐이다.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4000
CMD ["npm", "start"]
