# syntax=docker/dockerfile:1

# ── builder: 의존성 설치 + SCSS 빌드 ─────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# better-sqlite3 는 네이티브 모듈이라 alpine(musl)에서는 소스 빌드가 필요하다.
RUN apk add --no-cache python3 make g++

# 락파일 기준 재현 가능한 설치 (devDependencies 포함: sass 로 CSS 빌드해야 함)
COPY package.json package-lock.json ./
RUN npm ci

# 소스 복사 후 SCSS → CSS 빌드 (.dockerignore 로 client/css 는 제외됨 → 여기서 생성)
COPY . .
RUN npm run build:css

# ── runtime: 프로덕션 의존성만 담은 슬림 이미지 ──────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# 프로덕션 의존성만 설치 (빌드 도구는 설치 후 지워 이미지를 가볍게 유지)
COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm ci --omit=dev \
 && npm cache clean --force \
 && apk del .build-deps

# 빌드 산출물(client/css 포함) + 앱 소스만 복사
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/src ./src
COPY --from=builder /app/views ./views
COPY --from=builder /app/client ./client

# SQLite 파일이 놓일 곳. compose 에서 호스트 디렉터리를 여기에 마운트한다.
# (마운트하지 않으면 컨테이너를 지울 때 계정·전적도 함께 사라진다)
ENV DB_PATH=/app/data/app.db
RUN mkdir -p /app/data && chown -R node:node /app/data

# 비루트 유저로 실행 (컨테이너 탈취 시 권한 최소화)
USER node

EXPOSE 4000
CMD ["node", "server.js"]
