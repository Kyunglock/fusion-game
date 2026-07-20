# syntax=docker/dockerfile:1

# ── builder: 의존성 설치 + SCSS 빌드 ─────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

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

# 프로덕션 의존성만 설치
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 빌드 산출물(client/css 포함) + 앱 소스만 복사
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/src ./src
COPY --from=builder /app/views ./views
COPY --from=builder /app/client ./client

# 비루트 유저로 실행 (컨테이너 탈취 시 권한 최소화)
USER node

EXPOSE 4000
CMD ["node", "server.js"]
