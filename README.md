# Task Board

TODO/DOING/DONE 태스크 보드 애플리케이션.
React + Spring Boot + MySQL 구성, Docker Compose로 로컬 실행.

> **프로젝트 목표**: "앱 기능"보다 "배포/운영 흐름"을 보여주는 것
> (컨테이너화 → ECR → ECS → ALB → RDS)

## 기술 스택

| 계층 | 기술 |
|------|------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, Headless UI |
| Backend | Java 17 (Temurin), Spring Boot 3.5, JPA, Flyway |
| Database | MySQL 8.0 |
| Infra | Docker, nginx, docker-compose |

## 로컬 실행

### 사전 조건

- Docker Engine (Docker Desktop 또는 WSL2 Docker)

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

## 아키텍처 (로컬)

```
브라우저 → http://localhost/
                ↓
         nginx (port 80)
         ├── /              → React 정적 파일 (SPA fallback)
         ├── /api/*         → proxy_pass → Spring Boot(:8080)
         └── /actuator/*    → proxy_pass → Spring Boot(:8080)
                                      ↓
                               MySQL(:3306)
```

## 아키텍처 (AWS, 목표)

```
인터넷
  ↓
ALB (internet-facing, public subnet)
  ├── /api/*       → Backend TG (IP) → Spring Boot (:8080)
  ├── /actuator/*  → Backend TG
  └── /* (기본)    → Frontend TG (IP) → nginx (:80)

EC2 t3.small (private subnet)
  ├── Frontend Task (ENI) — nginx: 정적 서빙만
  └── Backend Task (ENI) — Spring Boot → RDS MySQL (private subnet)

NAT Gateway 1개 (public subnet, 단일 AZ)
```

핵심 차이: 로컬에서는 nginx가 API 프록시, AWS에서는 ALB가 경로 라우팅.
프론트 코드는 항상 `/api/...` 상대경로로 호출하므로 변경 없음.

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/tasks | 목록 (params: status, priority, q, page, size, sort) |
| POST | /api/tasks | 생성 (title 필수) |
| PUT | /api/tasks/{id} | 수정 (전체 교체) |
| DELETE | /api/tasks/{id} | 삭제 |
| GET | /actuator/health | 헬스체크 |

## API 예시

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

# 헬스체크
curl http://localhost/actuator/health
```

## 설계 결정 (Decision Log)

| 결정 | 이유 |
|------|------|
| PUT 전체 교체 (PATCH 아님) | 모달 전체 필드 저장 구조에 부합 |
| Hard delete | 학습 목적, soft delete 불필요 |
| Flyway + ddl-auto: validate | Flyway가 스키마 관리, Hibernate는 검증만 |
| open-in-view: false | Service 계층에서 데이터 로딩 강제 |
| nginx 설정 2개 (로컬/AWS) | 로컬: API 프록시 포함, AWS: 정적 서빙만 |
| JVM -Xmx512m / 컨테이너 768MB | 힙 외 JVM 오버헤드 고려, OOM Kill 방지 |
| TG target type = IP | awsvpc에서 Task가 자체 ENI/IP를 받으므로 필수 |
| SSM Parameter Store | 무료, 학습/PoC 용도 |
| NAT 1개 (단일 AZ) | 비용 최적화, 학습 목적에서 가용성 트레이드오프 허용 |

상세 설계는 [DESIGN.md](./DESIGN.md) 참조.

## 트러블슈팅

### docker compose up 시 backend가 즉시 종료됨

MySQL이 아직 준비되지 않았을 수 있습니다. `db` 서비스의 healthcheck가 `service_healthy`가 될 때까지 backend는 대기합니다. `docker compose logs db`로 MySQL 초기화 로그를 확인하세요.

### http://localhost/ 접속 불가

- `docker compose ps`로 frontend 컨테이너 상태를 확인합니다.
- 포트 80이 다른 프로세스에 점유되어 있는지 확인합니다: `ss -tlnp | grep :80`

### API 호출 시 502 Bad Gateway

backend 컨테이너가 정상 실행 중인지 확인합니다: `docker compose logs backend`. Spring Boot 시작 완료까지 Flyway 마이그레이션 포함 약 10-20초가 소요됩니다.

### MySQL 포트 충돌 (WSL2)

WSL2와 Windows가 포트 공간을 공유합니다. docker-compose에서 `db` 포트를 호스트에 노출하지 않으므로 일반적으로 충돌하지 않습니다.

## 프로젝트 구조

```
task-flow/
├── docker-compose.yml              # 로컬 실행 (3 서비스)
├── backend/
│   ├── Dockerfile                   # Multi-stage (Gradle → JRE)
│   ├── build.gradle
│   └── src/main/
│       ├── java/com/taskflow/      # Spring Boot 애플리케이션
│       └── resources/
│           ├── application.yml
│           ├── application-dev.yml
│           ├── application-prod.yml
│           └── db/migration/       # Flyway SQL
├── frontend/
│   ├── Dockerfile                   # Multi-stage (Node → nginx)
│   ├── nginx-local.conf            # 로컬용 (API 프록시 포함)
│   ├── nginx-aws.conf              # AWS용 (정적 서빙만)
│   ├── package.json
│   └── src/                        # React 애플리케이션
├── CLAUDE.md                       # AI 코딩 가이드라인
├── DESIGN.md                       # 상세 설계서
├── TODO.md                         # 구현 체크리스트
└── README.md
```
