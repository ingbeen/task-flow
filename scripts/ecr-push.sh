#!/usr/bin/env bash
#
# ECR 이미지 빌드 및 푸시 스크립트
# 프로젝트 루트에서 실행: ./scripts/ecr-push.sh <AWS_ACCOUNT_ID> [AWS_REGION]
#
set -euo pipefail

# ============================================================
# 1. 파라미터 검증
# ============================================================
AWS_ACCOUNT_ID="${1:?사용법: $0 <AWS_ACCOUNT_ID> [AWS_REGION]}"
AWS_REGION="${2:-ap-northeast-2}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')"

BACKEND_REPO="taskboard-backend"
FRONTEND_REPO="taskboard-frontend"

echo "============================================================"
echo "ECR Push: registry=${ECR_REGISTRY}"
echo "          tag=${IMAGE_TAG}"
echo "============================================================"

# ============================================================
# 2. ECR 로그인
# ============================================================
echo ""
echo "[1/5] ECR 로그인..."
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

# ============================================================
# 3. 백엔드 빌드 및 푸시
# ============================================================
echo ""
echo "[2/5] 백엔드 이미지 빌드..."
docker build -t "${BACKEND_REPO}:${IMAGE_TAG}" ./backend

echo ""
echo "[3/5] 백엔드 이미지 푸시..."
docker tag "${BACKEND_REPO}:${IMAGE_TAG}" \
  "${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}"
docker push "${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}"

# ============================================================
# 4. 프론트엔드 빌드 및 푸시 (AWS용 nginx 설정)
# ============================================================
echo ""
echo "[4/5] 프론트엔드 이미지 빌드 (NGINX_CONF=nginx-aws.conf)..."
docker build \
  --build-arg NGINX_CONF=nginx-aws.conf \
  -t "${FRONTEND_REPO}:${IMAGE_TAG}" \
  ./frontend

echo ""
echo "[5/5] 프론트엔드 이미지 푸시..."
docker tag "${FRONTEND_REPO}:${IMAGE_TAG}" \
  "${ECR_REGISTRY}/${FRONTEND_REPO}:${IMAGE_TAG}"
docker push "${ECR_REGISTRY}/${FRONTEND_REPO}:${IMAGE_TAG}"

# ============================================================
# 5. 완료
# ============================================================
echo ""
echo "============================================================"
echo "푸시 완료"
echo "  Backend:  ${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}"
echo "  Frontend: ${ECR_REGISTRY}/${FRONTEND_REPO}:${IMAGE_TAG}"
echo "============================================================"
