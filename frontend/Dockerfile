# ========================================
# Stage 1: Node build
# ========================================
FROM node:22-alpine AS builder

WORKDIR /app

# 1. 의존성 캐시 레이어
COPY package.json package-lock.json ./
RUN npm ci

# 2. 소스 코드 복사 + 빌드
COPY . .
RUN npm run build

# ========================================
# Stage 2: nginx static serving
# ========================================
FROM nginx:1.27-alpine

# 빌드 결과물 복사
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx 설정 복사 (기본: 로컬용, AWS 배포 시 nginx-aws.conf로 교체)
ARG NGINX_CONF=nginx-local.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
