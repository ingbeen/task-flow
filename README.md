# Task Board

![CI](https://github.com/ingbeen/task-flow/actions/workflows/deploy.yml/badge.svg)
![Java](https://img.shields.io/badge/Java-17-orange)
![React](https://img.shields.io/badge/React-19-blue)

TODO/DOING/DONE 태스크 보드 애플리케이션.
React + Spring Boot + MySQL 구성, Docker Compose로 로컬 실행.

> **프로젝트 목표**: "앱 기능"보다 "배포/운영 흐름"을 보여주는 것
> (컨테이너화 → ECR → ECS → ALB → RDS)

## 주요 기능

- 태스크 CRUD (생성, 조회, 수정, 삭제)
- 상태별 칸반 보드 (TODO / DOING / DONE)
- 우선순위, 마감일, 검색/필터/정렬/페이징
- Docker Compose 원클릭 실행 (운영 시뮬레이션 + 개발 모드)
- GitHub Actions CI/CD (master push → ECR → ECS 자동 배포)

## 기술 스택

| 계층 | 기술 |
|------|------|
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Headless UI 2 |
| Backend | Java 17, Spring Boot 3.5.11, JPA, Flyway, Lombok |
| Database | MySQL 8.0 |
| Infra | Docker, nginx 1.27, docker-compose |
| CI/CD | GitHub Actions (master push → ECR → ECS) |
| AWS | ECS (EC2, awsvpc), ALB, RDS, NAT Gateway, SSM Parameter Store |

## 로컬 실행

### 사전 조건

- Docker Engine (WSL2 Docker 또는 Docker Desktop)

### 시작

```bash
# 전체 빌드 + 실행 (첫 실행 시 이미지 빌드 포함)
docker compose up --build

# 백그라운드 실행
docker compose up --build -d
```

### 접속

| URL | 설명 |
|-----|------|
| http://localhost/ | React UI |
| http://localhost/api/tasks | API 엔드포인트 |
| http://localhost/actuator/health | 헬스체크 |

### 종료

```bash
docker compose down        # 컨테이너 종료 (DB 데이터 유지)
docker compose down -v     # 컨테이너 + DB 볼륨 삭제
```

## 개발 모드 (핫 리로드)

소스 코드 변경이 즉시 반영되는 개발용 환경입니다.

```bash
docker compose -f docker-compose.dev.yml up --build
```

| URL | 설명 |
|-----|------|
| http://localhost:5173/ | React UI (Vite HMR) |
| http://localhost:8080/api/tasks | Backend API (직접 접근) |

| 서비스 | 핫 리로드 방식 | 반영 속도 |
|--------|---------------|-----------|
| Frontend | Vite dev server + HMR (bind mount) | 즉시 |
| Backend | inotifywait로 .java 변경 감지 → bootRun 자동 재시작 | ~10초 |

## 아키텍처

### 로컬 (docker-compose)

```
브라우저 → nginx(:80)
            ├── /           → React 정적 파일 (SPA fallback)
            ├── /api/*      → proxy_pass → Spring Boot(:8080)
            └── /actuator/* → proxy_pass → Spring Boot(:8080)
                                              ↓
                                         MySQL(:3306)
```

### AWS (ECS)

```
인터넷 → ALB (public subnet)
          ├── /api/*      → Backend TG → Spring Boot(:8080)
          ├── /actuator/* → Backend TG
          └── /* (기본)   → Frontend TG → nginx(:80)

EC2 t3.small (private subnet)
  ├── Frontend Task — nginx: 정적 서빙만
  └── Backend Task — Spring Boot → RDS MySQL (private subnet)
```

핵심 차이: 로컬에서는 nginx가 API 프록시, AWS에서는 ALB가 경로 라우팅.
프론트 코드는 항상 `/api/...` 상대경로로 호출하므로 변경 없음.

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/tasks | 목록 (params: status, priority, q, page, size, sort) |
| POST | /api/tasks | 생성 (title 필수) |
| PUT | /api/tasks/{id} | 수정 (전체 교체) |
| DELETE | /api/tasks/{id} | 삭제 |
| GET | /actuator/health | 헬스체크 |

<details>
<summary>API 호출 예시 (curl)</summary>

```bash
# 목록 조회
curl http://localhost/api/tasks

# 생성
curl -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"새 태스크","priority":"HIGH"}'

# 수정 (전체 교체)
curl -X PUT http://localhost/api/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"title":"수정된 태스크","status":"DOING","priority":"MEDIUM"}'

# 삭제
curl -X DELETE http://localhost/api/tasks/1

# 필터/검색/정렬/페이징
curl "http://localhost/api/tasks?status=TODO&priority=HIGH&q=검색어&page=0&size=10&sort=createdAt,desc"
```

</details>

## 환경 변수

### Backend (Spring Boot)

| 변수 | 설명 | dev 기본값 | prod |
|------|------|-----------|------|
| `DB_HOST` | MySQL 호스트 | `localhost` | 필수 |
| `DB_PORT` | MySQL 포트 | `3306` | 필수 |
| `DB_NAME` | 데이터베이스명 | `taskboard` | 필수 |
| `DB_USER` | DB 사용자 | `taskboard` | 필수 |
| `DB_PASSWORD` | DB 비밀번호 | `taskboard` | 필수 |

- `dev` 프로파일: 환경 변수 미설정 시 기본값 사용
- `prod` 프로파일: 기본값 없음 (미설정 시 시작 실패, fail-fast)
- AWS 환경에서는 SSM Parameter Store로 주입

## AWS 배포

### ECR 푸시 (수동)

```bash
# 프로젝트 루트에서 실행 (Account ID 자동 감지)
./scripts/ecr-push.sh [AWS_REGION]
```

사전 조건: AWS CLI v2 + `aws configure` 완료 + ECR 리포지토리 생성

### CI/CD (GitHub Actions)

`master` push 시 자동 실행: Docker 빌드 → ECR 푸시 → ECS 배포

| 필요한 GitHub Secrets | 설명 |
|----------------------|------|
| `AWS_ACCESS_KEY_ID` | IAM 액세스 키 |
| `AWS_SECRET_ACCESS_KEY` | IAM 시크릿 키 |
| `AWS_ACCOUNT_ID` | AWS 계정 ID |

수동 트리거: GitHub Actions 탭 → "Deploy to AWS ECS" → "Run workflow"

## 주요 설계 결정

| 결정 | 이유 |
|------|------|
| PUT 전체 교체 (PATCH 아님) | 모달 전체 필드 저장 구조에 부합 |
| Flyway + ddl-auto: validate | Flyway가 스키마 관리, Hibernate는 검증만 |
| nginx 설정 2개 (로컬/AWS) | 로컬: API 프록시 포함, AWS: 정적 서빙만 |
| Graceful Shutdown + exec | ECS 배포 시 진행 중 요청 완료 보장 |
| prod JSON 로그 (내장 structured) | CloudWatch Logs Insights 쿼리 가능 |
| NAT 1개 (단일 AZ) | 비용 최적화, 학습 목적에서 가용성 트레이드오프 허용 |

전체 설계 결정 및 상세 설계는 [DESIGN.md](./docs/DESIGN.md) 참조.

## 트러블슈팅

| 증상 | 원인 및 해결 |
|------|-------------|
| `docker compose up` 시 backend 즉시 종료 | MySQL 미준비. `docker compose logs db`로 초기화 상태 확인 |
| `localhost/` 접속 불가 | `docker compose ps`로 frontend 상태 확인. 포트 80 점유 여부: `ss -tlnp \| grep :80` |
| API 502 Bad Gateway | backend 시작 대기 (Flyway 포함 ~10-20초). `docker compose logs backend` 확인 |
| ECS Task 시작 후 바로 중지 | 헬스체크 유예 기간 확인. Spring Boot 시작 ~46초이므로 120초로 설정 |
| ECS Task가 PENDING에서 멈춤 | t3.small ENI 한계(3개). 기존 Task 중지 후 재시도 |

## 프로젝트 구조

```
task-flow/
├── backend/                    # Spring Boot (Java 17)
├── frontend/                   # React + Vite (TypeScript)
├── scripts/                    # ECR 푸시 스크립트
├── .github/workflows/          # CI/CD (GitHub Actions)
├── docker-compose.yml          # 운영 시뮬레이션
├── docker-compose.dev.yml      # 개발 모드 (핫 리로드)
└── docs/
    ├── AWS_GUIDE.md            # AWS 배포 학습 가이드
    ├── DESIGN.md               # 상세 설계서
    ├── LEARNING.md             # 학습 가이드
    └── TESTING.md              # 수동 테스트 가이드
```

## Contributing

1. Fork 후 feature 브랜치 생성 (`git checkout -b feature/my-feature`)
2. 변경 사항 커밋
3. 브랜치 Push (`git push origin feature/my-feature`)
4. Pull Request 생성

