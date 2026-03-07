# 프로젝트 설계서: Task Board (React + Spring Boot + MySQL)

**배포 목표:** AWS ECS(EC2 launch type, awsvpc) + ALB(경로 기반 라우팅) + RDS(MySQL)
**핵심 원칙:** 기능은 단순(투두 보드) + 운영 요소(헬스체크/로그/환경분리/배포흐름/서비스 분리)를 명확히
**설계 토론:** Claude ↔ GPT 양측 검토를 거쳐 합의된 최종본

---

## 0) 확정 사항 전체 목록

### 기능/도메인

- 주제: **Task 보드 (TODO/DOING/DONE)**
- 로그인/인증/권한: **전부 제외**
- CRUD: Task 생성/조회/수정/삭제
- 삭제 방식: **Hard delete**
- 수정 방식: **PUT (전체 교체)**
- 필수 포함: 페이징, 필터(status/priority), 검색(q), 정렬(기본 `createdAt desc`)
- Task 필드: `title`, `description`, `dueDate`, `status`, `priority`, `createdAt`, `updatedAt`
- 초기 데이터(seed): 없음

### 프론트(React)

- Vite + React Router + Tailwind CSS + Headless UI(모달/드롭다운)
- 서빙: **nginx 정적 서빙 + SPA fallback**
- 통신: 모든 API는 상대경로 `/api/...`로 호출
- **AWS에서는 nginx가 정적 서빙만 담당** (API 프록시 없음, ALB가 경로 라우팅)
- **로컬에서는 nginx가 `/api` + `/actuator` → backend로 프록시** (동일 origin 유지)

### 백엔드(Spring Boot)

- Java 17 + Spring Boot 3.5.11 + Spring Data JPA
- Spring profiles(dev/prod) 분리
- 헬스체크: **Spring Actuator `/actuator/health`** (Actuator는 `/api` 하위가 아닌 독립 경로)
- Actuator 노출 제한: `management.endpoints.web.exposure.include=health` (공통 설정, dev/prod 모두 적용)
- 로깅: request logging filter(method, path, status, latency), SLF4J fluent API `addKeyValue()`로 구조화된 필드 출력
- 로그 포맷: **dev=텍스트(가독성)**, **prod=JSON(CloudWatch Logs Insights 호환)** — Spring Boot 3.4+ 내장 structured logging (`logstash` 포맷)
- Graceful Shutdown: `server.shutdown=graceful`, `timeout-per-shutdown-phase=30s` (Spring Boot 3.4+ 기본값이지만 명시)
- 헬스체크 상세: dev에서 `show-details=always` (DB 연결 상태 표시), prod에서 `show-details=never` (보안)
- DB 마이그레이션: **Flyway** (버전 SQL)
- JVM 메모리: **`-Xms256m -Xmx512m`** (t3.small 2GB 환경, 안정적 동작 목표)

### AWS(운영) — 안 A 확정

- ECS Launch type: **EC2**
- EC2: **t3.small 1대** (2 vCPU, 2GB RAM, Max ENI 3)
- 네트워크 모드: **awsvpc**
- VPC: **public subnet(ALB, NAT Gateway) + private subnet(EC2, RDS)**
- NAT Gateway: **1개 (단일 AZ, 비용 최적화)** — 모든 private subnet의 Route table이 이 NAT를 가리킴
- ECS Task Definition: **2개** (frontend 1개, backend 1개)
- ECS Service: **2개** (frontend Service, backend Service)
- ALB: **internet-facing**, HTTP만, **경로 기반 라우팅**
- Target Group: **2개** (frontend TG, backend TG), **Target type: IP** (awsvpc 필수)
- 헬스체크: **Frontend TG → `/`** / **Backend TG → `/actuator/health`** (ALB가 직접 체크)
- 로그: CloudWatch Logs(awslogs 드라이버)
- DB: **RDS MySQL** (db.t3.micro, Private subnet, Public access = No)
- 비밀값: **SSM Parameter Store** (Standard, 무료, 학습/PoC 목적)
- 빌드/배포: 수동 배포 먼저 → GitHub Actions 자동화 추가
- 배포 방식: **다운타임 허용 (학습 목적, 무중단 배포 아님)**
- 리소스 정리: **삭제 기반** (NAT/ALB는 Stop 불가, 체크리스트 참조)

### 비용 전략

- AWS 계정: **신규 생성** (2025.07.15 이후 구조)
- 크레딧: **$100(가입) + $100(온보딩) = 최대 $200**
- 예상 월 비용: **~$91** (t3.small $19 + ALB $20 + RDS $17 + NAT $33 + EBS $2)
- 크레딧 지속: **약 2.2개월** (24/7 가동 기준)
- **AWS Budgets $10 알림 필수 설정** (계정 생성 즉시)
- 위 비용은 추정치이며, **AWS Pricing Calculator로 최종 확인 권장**
- 특히 ALB는 시간+LCU 구조라 트래픽 증가 시 비용이 달라질 수 있음

---

## 1) 설계 의도 (프로젝트 목표)

- 이 프로젝트는 **"앱 기능"보다 "배포/운영 흐름"**을 보여주는 것이 목표
- 핵심 학습 포인트: 컨테이너화 → ECR → ECS(Service 분리) → ALB(경로 기반 라우팅) → RDS
- 면접 설명력: "ALB에서 경로 기반으로 프론트/백엔드를 분리하고, 각각 독립적으로 배포/헬스체크합니다"
- Kubernetes/Fargate는 사용하지 않음
- 인증/권한은 제외(범위 과대화 방지)

---

## 2) 로컬 기준 설계 (docker-compose)

### 2.1 아키텍처

```
브라우저 → http://localhost/
                ↓
         nginx (port 80)
         ├── /              → React 정적 파일 (SPA fallback)
         ├── /api/*         → proxy_pass http://backend:8080
         └── /actuator/*    → proxy_pass http://backend:8080
                                      ↓
                               Spring Boot (port 8080)
                                      ↓
                               MySQL (port 3306)
```

### 2.2 컨테이너 구성 (docker-compose)

- `frontend`: nginx (React build 정적 서빙 + `/api` & `/actuator` reverse proxy)
- `backend`: Spring Boot API (port 8080)
- `db`: MySQL (로컬 개발용)
- 네트워크: Compose 기본 네트워크(서비스명으로 통신)

### 2.3 nginx 설정 (로컬용)

구현 완료: `frontend/nginx-local.conf` 참조

- React 정적 파일 + SPA fallback (`try_files`)
- `/api/` → `proxy_pass http://backend:8080`
- `/actuator/` → `proxy_pass http://backend:8080`

### 2.4 실행 요구사항

- `docker compose up` 한 번으로 동작
- 프론트: `http://localhost/`
- API: `http://localhost/api/...` (nginx 프록시 경유)
- 헬스체크: `http://localhost/actuator/health` (nginx 프록시 경유)

### 2.5 로컬 환경변수

- `DB_HOST=db`, `DB_PORT=3306`, `DB_NAME=taskboard`
- `DB_USER=taskboard`, `DB_PASSWORD=taskboard`
- `SPRING_PROFILES_ACTIVE=dev`

### 2.6 CORS

- docker-compose: nginx 경유 = 같은 origin → **CORS 이슈 없음**
- Vite dev server 직접 사용 시: `frontend/vite.config.ts`에서 `/api`, `/actuator` 프록시 설정 (구현 완료)

### 2.7 Flyway 정책

- `dev` 프로필: 앱 시작 시 Flyway migrate 자동 실행
- DB 스키마는 항상 Flyway 버전 SQL이 "정답" (수동 DDL 금지)

---

## 3) AWS 기준 설계 — 안 A (정석 구조)

### 3.1 핵심 용어 (초보자용)

| 용어                | 설명                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| ALB                 | 외부 요청의 진입점. 경로(path)에 따라 트래픽을 분배                                   |
| Target Group (TG)   | ALB가 트래픽/헬스체크를 수행하는 "대상 묶음". Target type으로 IP 또는 Instance를 선택 |
| ECS Service         | Task를 유지/배포/교체하고, TG에 타겟 등록/해제를 자동화                               |
| Task Definition     | 컨테이너 실행 명세 (이미지, 포트, 메모리, 환경변수 등)                                |
| awsvpc              | Task가 VPC에서 자기 IP(ENI)를 받는 네트워크 모델 (AWS 표준/권장)                      |
| ENI                 | Elastic Network Interface. awsvpc에서 Task마다 1개 할당                               |
| NAT Gateway         | Private subnet → 인터넷 아웃바운드 전용 통로 (ECR pull, CloudWatch 등에 필요)         |
| Public subnet       | 인터넷과 직접 통신 가능한 서브넷 (Internet Gateway 연결)                              |
| Private subnet      | 인터넷과 직접 통신 불가, NAT Gateway를 통해서만 아웃바운드 가능                       |
| SSM Parameter Store | AWS 비밀값 저장소. Standard 파라미터는 무료                                           |

### 3.2 아키텍처 (AWS)

```
인터넷
  ↓
ALB (internet-facing, public subnet)
  ├── /api/*       → Backend TG (target type: IP) → Backend Service (Spring Boot, port 8080)
  ├── /actuator/*  → Backend TG (브라우저/운영 확인용, 헬스체크와는 무관)
  └── /* (기본)    → Frontend TG (target type: IP) → Frontend Service (nginx, port 80)

EC2 t3.small (private subnet, 1대)
  ├── Frontend Task (ENI 1개) — nginx: React 정적 서빙 + SPA fallback만
  └── Backend Task (ENI 1개)  — Spring Boot: API 서버
  (+ EC2 primary ENI 1개 = 총 ENI 3개 / 최대 3개)

NAT Gateway 1개 (public subnet, 단일 AZ)
  └── Private subnet → 인터넷 (ECR pull, CloudWatch Logs 전송 등)

RDS MySQL (private subnet)
  └── Backend Task에서만 접근 가능 (SG 제한)
```

### 3.3 왜 Public + Private 둘 다 필요한가?

**Public subnet이 필요한 이유:**

- ALB는 internet-facing이므로 public subnet에 있어야 인터넷에서 접근 가능
- NAT Gateway도 public subnet에 있어야 인터넷으로 나갈 수 있음

**Private subnet이 필요한 이유:**

- awsvpc 모드에서 Task ENI에는 public IP가 할당되지 않음 (AWS 공식 문서)
- EC2를 public subnet에 놓아도 Task는 인터넷에 직접 접근 불가 → 어차피 NAT가 필요
- NAT를 쓸 거면 EC2를 private subnet에 두는 게 보안 표준
- RDS도 public access=No이므로 private subnet이 자연스러움

**네트워크 흐름:**

```
[인바운드] 인터넷 → ALB (public) → EC2/Task (private)
[아웃바운드] EC2/Task (private) → NAT Gateway (public) → 인터넷 (ECR, CloudWatch 등)
[내부] Backend Task (private) → RDS (private)
```

### 3.4 네트워크/VPC 구성

- **VPC**: 1개
- **Public subnet** (2개 AZ): ALB, NAT Gateway
- **Private subnet** (2개 AZ): EC2(ECS), RDS
- **NAT Gateway**: **1개 (단일 AZ)** — 비용 최적화, 학습 목적
  - 모든 private subnet의 Route table에서 `0.0.0.0/0 → NAT Gateway`
  - 가용성은 떨어지지만 학습 프로젝트에서는 충분
  - (참고: 가용성 우선 시 AZ별 1개씩 = NAT 2개, 월 비용 2배)

> **NAT Gateway 개수와 비용:**
>
> - 1개: ~$33/월 (학습 권장)
> - 2개: ~$66/월 (가용성 우선, 프로덕션 표준)
> - 이 프로젝트에서는 **1개로 확정**

> **NAT 단일 AZ의 운영 영향:**
> NAT가 위치한 AZ에 장애가 발생하면 ECR 이미지 pull 실패, CloudWatch Logs 전송 실패, 외부 API 호출 실패가 발생할 수 있습니다. 이미 실행 중인 Task는 즉시 죽지 않지만, 재배포/재시작/스케일링 시 문제가 드러납니다. 학습 프로젝트에서는 허용 가능한 리스크입니다.

### 3.5 Security Group (SG)

| SG 이름  | 인바운드     | 소스                 |
| -------- | ------------ | -------------------- |
| `alb-sg` | TCP 80       | `0.0.0.0/0` (인터넷) |
| `ecs-sg` | TCP 80, 8080 | `alb-sg` (ALB에서만) |
| `rds-sg` | TCP 3306     | `ecs-sg` (ECS에서만) |

### 3.6 ECS 구성 (2 Service 분리)

| 항목               | Frontend                       | Backend                       |
| ------------------ | ------------------------------ | ----------------------------- |
| Task Definition    | `taskflow/frontend`            | `taskflow/backend`            |
| 컨테이너           | nginx (React 정적 서빙)        | Spring Boot API               |
| 포트               | 80                             | 8080                          |
| 메모리             | 128MB                          | 768MB (`-Xms256m -Xmx512m`)   |
| Service            | `frontend-service` (desired=1) | `backend-service` (desired=1) |
| Target Group       | `frontend-tg` (port 80)        | `backend-tg` (port 8080)      |
| **TG Target type** | **IP**                         | **IP**                        |
| 헬스체크           | `/` (nginx 200)                | `/actuator/health` (ALB 직접) |

> **Target type = IP는 awsvpc 모드에서 필수입니다.**
> awsvpc에서 Task는 자체 ENI/IP를 받으므로, TG가 IP 타겟으로 등록해야 합니다.
> 콘솔에서 TG 생성 시 기본값이 `Instance`이므로 반드시 `IP`로 변경하세요. 잘못 선택하면 Task가 TG에 등록되지 않습니다.
> 참고: [AWS 공식 문서 - ECS Load Balancer](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)

### 3.7 ALB + 경로 기반 라우팅

- ALB: internet-facing, HTTP :80
- Listener rules (우선순위 순):
  1. **`/api/*` → Backend TG**
  2. **`/actuator/*` → Backend TG**
  3. **`/*` (기본) → Frontend TG**

> **`/actuator/*` Listener rule은 헬스체크와 무관합니다.**
> TG 헬스체크는 Listener rule을 거치지 않고, TG가 타겟 IP:Port로 직접 요청합니다.
> 이 룰은 브라우저에서 `http://ALB_DNS/actuator/health`로 운영 상태를 확인하기 위한 경로 라우팅입니다.

> **Actuator 경로(`/actuator/*`)는 `/api` 하위가 아닙니다.**
> Spring Boot Actuator의 기본 경로는 `/actuator/health`이며, 비즈니스 API(`/api/tasks`)와 분리됩니다.

> **nginx의 `/api` 프록시는 AWS에서 불필요합니다.**
> ALB가 경로를 직접 라우팅하므로, AWS의 nginx는 **정적 서빙 + SPA fallback만** 담당합니다.

### 3.8 nginx 설정 (AWS용)

구현 완료: `frontend/nginx-aws.conf` 참조

- React 정적 파일 + SPA fallback만 (API 프록시 없음)
- 로컬용(`nginx-local.conf`)과 AWS용(`nginx-aws.conf`) 파일 2개로 분리 관리

### 3.9 헬스체크 (최종 확정)

| 대상     | TG          | Path               | 체크 주체 | 설명                           |
| -------- | ----------- | ------------------ | --------- | ------------------------------ |
| Frontend | frontend-tg | `/`                | ALB 직접  | nginx가 200 응답하면 healthy   |
| Backend  | backend-tg  | `/actuator/health` | ALB 직접  | Spring Boot Actuator 응답 확인 |

**헬스체크 파라미터 (양쪽 동일)**:

- Interval: 30s
- Timeout: 5s
- Healthy threshold: 2
- Unhealthy threshold: 2
- Success codes: 200-399

> **헬스체크는 TG 설정으로 직접 수행됩니다.**
> ALB Listener rule과는 무관하게, TG가 등록된 타겟의 IP:Port로 직접 health check path를 요청합니다.

### 3.10 Actuator 외부 노출 정책

학습 목적으로 `/actuator/health`는 ALB를 통해 외부에서 접근 가능합니다.
노출 범위를 `health`로 최소화하여 민감한 정보가 노출되지 않도록 제한합니다.
(실무에서는 내부 전용 ALB, WAF, 별도 포트 분리 등으로 Actuator 접근을 더 엄격히 제한합니다.)

### 3.11 배포 제약 사항 (⚠️ 중요)

**t3.small + awsvpc + 2 Service의 ENI 한계:**

| ENI 용도          | 수량           |
| ----------------- | -------------- |
| EC2 primary ENI   | 1              |
| Frontend Task ENI | 1              |
| Backend Task ENI  | 1              |
| **합계**          | **3 / 최대 3** |

- **여유 ENI가 0개**입니다.
- 기본 Rolling update(maximumPercent=200)는 새 Task를 먼저 올리려 해서 ENI 부족으로 PENDING 발생.
- **T3 계열은 awsvpcTrunking 미지원** → ENI 한도를 늘릴 수 없음.

**해결: 배포 파라미터 고정**

```
# frontend-service, backend-service 모두 동일하게 설정
minimumHealthyPercent = 0
maximumPercent = 100
```

| 파라미터              | 값  | 의미                                                                                     |
| --------------------- | --- | ---------------------------------------------------------------------------------------- |
| maximumPercent        | 100 | 배포 중 RUNNING+PENDING 태스크 수의 상한. 새 Task를 "추가로" 올리지 않음 (ENI 초과 방지) |
| minimumHealthyPercent | 0   | 배포 중 RUNNING 태스크 수의 하한. 기존 Task를 먼저 내리고 새 Task를 올림 허용            |

> **동작 원리:** `maximumPercent=100`이 새 Task 추가 기동을 제한하고, `minimumHealthyPercent=0`이 기존 Task를 먼저 내릴 수 있게 하여, 단일 인스턴스/ENI 제약 환경에서도 배포를 가능하게 합니다.
> 참고: [AWS 공식 문서 - ECS Deployment Configuration](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html#sd-deploymentconfiguration)

**⚠️ 무중단 배포가 아닙니다.** 배포 시 수초간 다운타임이 발생합니다.
학습 프로젝트에서는 OK이며, 면접에서는 "ENI 제약과 배포 전략이 연결된다"는 점을 설명할 수 있는 학습 포인트입니다.

### 3.12 RDS (MySQL)

- 인스턴스: **db.t3.micro** (크레딧 활용)
- Public access: **No**
- Subnet: Private subnet
- SG: 3306 inbound = `ecs-sg` only
- 백엔드 `prod` 프로필에서 RDS 연결

### 3.13 로그 (CloudWatch Logs)

- ECS Task Definition에서 awslogs 드라이버 설정
- 로그 그룹:
  - `/ecs/taskflow/frontend` (nginx)
  - `/ecs/taskflow/backend` (Spring Boot)
- **prod 프로필에서 JSON 구조화 로그 출력** (`logging.structured.format.console=logstash`)
  - Spring Boot 3.4+ 내장 기능, 추가 라이브러리 불필요
  - CloudWatch Logs Insights에서 JSON 필드별 쿼리/필터링 가능
  - 예: `fields @timestamp, http_method, uri, status, latency_ms | filter status >= 400`
- RequestLoggingFilter에서 `addKeyValue()`로 http_method, uri, status, latency_ms를 개별 JSON 필드로 출력

### 3.14 비밀값 관리 (SSM Parameter Store)

- DB 접속 정보 등을 SSM Parameter Store(Standard)에 저장
- ECS Task Definition에서 `valueFrom`으로 참조
- Standard 파라미터는 **무료** (Always Free)
- 학습/PoC 목적 기준으로 선택 (실무에서는 Secrets Manager도 고려)

---

## 4) 구현 상세 (코딩 지시용)

### 4.1 프론트 요구사항

**라우팅:**

- `/tasks`: 메인 페이지
- `/`: `/tasks`로 redirect
- `*`: 404 Not Found 페이지 (catch-all 라우트)

**UI/컴포넌트:**

- `TaskPage`
  - `TaskToolbar`: 검색(q), status filter, priority filter, sort select, "New Task" 버튼
  - `TaskList` → `TaskCard`
  - `TaskModal` (Headless UI Dialog): 생성/수정 공용
  - `Pagination` (page/size 기반)

**API 호출 규칙:**

- 모든 API 요청은 상대경로 `/api/...`로 호출
- 환경에 따라 라우팅 방식만 달라짐 (로컬: nginx 프록시 / AWS: ALB 경로 라우팅)
- 프론트 코드는 환경 차이를 인식하지 않음

### 4.2 백엔드 요구사항

**엔티티/테이블 (tasks):**

| 컬럼        | 타입         | 제약                       |
| ----------- | ------------ | -------------------------- |
| id          | BIGINT       | PK, AUTO_INCREMENT         |
| title       | VARCHAR(255) | NOT NULL                   |
| description | TEXT         | NULL                       |
| status      | VARCHAR(16)  | NOT NULL (TODO/DOING/DONE) |
| priority    | VARCHAR(16)  | NOT NULL (LOW/MEDIUM/HIGH) |
| due_date    | DATE         | NULL                       |
| created_at  | DATETIME     | NOT NULL                   |
| updated_at  | DATETIME     | NOT NULL                   |

**API 스펙:**

| Method | Path              | 설명                                              |
| ------ | ----------------- | ------------------------------------------------- |
| GET    | `/api/tasks`      | 목록 조회 (page, size, status, priority, q, sort) |
| POST   | `/api/tasks`      | 생성 (title 필수)                                 |
| PUT    | `/api/tasks/{id}` | 수정 (전체 교체)                                  |
| DELETE | `/api/tasks/{id}` | 삭제 (hard delete)                                |

**Actuator:**

- `/actuator/health` 활성화 (ALB 헬스체크 대상)
- Actuator 경로는 `/api` 하위가 아닌 독립 경로 (Spring Boot 기본값 유지)

**Actuator 노출 제한 (공통 설정):**

구현 완료: `backend/src/main/resources/application.yml` 참조 (공통 설정으로 dev/prod 모두 적용)

**Profiles:**

- `dev`: 로컬 MySQL, Flyway 자동, 디버그 로그
- `prod`: RDS 연결 (SSM에서 환경변수 주입), 운영 설정, Actuator 노출 최소화

**JVM 메모리:**

- Dockerfile에서 `-Xms256m -Xmx512m` 설정
- ECS backend 컨테이너 memory: 768MB
- JVM은 힙 외에도 메타스페이스, 스레드 스택, GC 등으로 힙의 약 1.5배를 사용하므로, -Xmx(512m)보다 컨테이너 memory(768MB)를 넉넉히 잡아 OOM Kill 방지
- t3.small(2GB) 환경에서 안정적 동작 목표

---

## 5) Flyway 마이그레이션 설계

### 원칙

- 마이그레이션 파일은 버전 SQL로 누적
- `V1__init.sql`: tasks 테이블 생성
- `V2__indexes.sql`: 인덱스 추가 (status, priority, created_at, due_date)
- Flyway가 schema history 테이블로 적용 여부 추적

---

## 6) Docker / 이미지 요구사항

### frontend Dockerfile (multi-stage)

1. Node로 Vite build
2. nginx 이미지에 정적 파일 복사
3. nginx.conf 포함 (환경별로 다름: 로컬은 /api 프록시 포함, AWS는 정적 서빙만)

### backend Dockerfile (multi-stage)

1. Gradle build
2. JRE 이미지로 실행
3. JVM 옵션: `-Xms256m -Xmx512m`
4. ENTRYPOINT에 `exec` 사용 — java가 PID 1이 되어 Docker SIGTERM을 직접 수신 (graceful shutdown 보장)

### docker-compose.yml (로컬)

- services: frontend(nginx:80), backend(8080), db(MySQL)
- nginx proxy_pass: `http://backend:8080` (서비스명)
- backend `stop_grace_period: 35s` — Spring graceful shutdown(30s) + 여유 5s

### AWS ECS Task Definitions

- **taskflow/frontend**: nginx 컨테이너 (port 80, memory 128MB, 정적 서빙만)
- **taskflow/backend**: Spring Boot 컨테이너 (port 8080, memory 768MB, JVM `-Xms256m -Xmx512m`)
- 각각 독립적인 Task Definition, 독립적인 Service

> **핵심 차이: 로컬 vs AWS**
>
> - 로컬: nginx가 `/api` + `/actuator` 프록시 담당 (1 진입점)
> - AWS: ALB가 `/api` + `/actuator` 라우팅 담당, nginx는 정적 서빙만 (역할 분리)
> - 프론트 코드는 변경 없음 (항상 `/api/...` 호출)

> **컨테이너 memory와 JVM 힙의 관계:**
> JVM은 -Xmx로 설정한 힙 외에도 메타스페이스, 스레드 스택, GC 등으로 추가 메모리를 사용합니다.
> 컨테이너 memory(768MB) > -Xmx(512MB)로 설정하여 OOM Kill을 방지합니다.
> ECS는 컨테이너가 memory limit을 초과하면 강제 종료(OOM Kill)하므로, 여유분 확보가 필수입니다.

---

## 7) 빌드/배포 전략

### 로컬

- `docker compose build` → `docker compose up`

### AWS 1단계: 수동 배포

1. `docker build` → `docker tag` → `docker push` (ECR, 이미지 2개)
   - 자동화 스크립트: `scripts/ecr-push.sh <AWS_ACCOUNT_ID> [AWS_REGION]`
   - git short hash를 이미지 태그로 사용 (커밋 추적)
   - frontend 빌드 시 `NGINX_CONF=nginx-aws.conf` 자동 적용
2. AWS 콘솔에서 ECS Service 업데이트 (새 Task Definition 반영)

### AWS 2단계: GitHub Actions 자동화

- `git push` → GitHub Actions → 자동 빌드 → ECR push → ECS 배포
- public 레포: **GitHub Actions 완전 무료**
- 수동 배포를 먼저 성공시킨 후 추가

---

## 8) AWS 배포 체크리스트

1. **AWS 계정 생성** (신규, $100 크레딧 수령)
2. **AWS Budgets $10 알림 설정** (필수, 첫날에)
3. **온보딩 활동** 수행하여 추가 $100 크레딧 확보
4. VPC 구성
   - Public subnet 2개 (ALB, NAT Gateway)
   - Private subnet 2개 (EC2/ECS, RDS)
   - **NAT Gateway 1개** (public subnet, 단일 AZ) + Elastic IP 할당
   - 모든 Private subnet Route table: `0.0.0.0/0 → NAT Gateway`
5. Security Group 생성 (alb-sg, ecs-sg, rds-sg)
6. ECR repo 생성 (frontend, backend)
7. 이미지 빌드 & 푸시
8. ECS Cluster(EC2) 생성 + EC2 t3.small 1대 등록 (private subnet)
9. SSM Parameter Store에 DB 접속 정보 등록
10. Task Definition 2개 생성
    - frontend: nginx, port 80, memory 128MB, awslogs
    - backend: spring-boot, port 8080, memory 768MB, awslogs, JVM `-Xms256m -Xmx512m`
11. ALB 생성 (internet-facing, public subnet) + **TG 2개 (Target type: IP)**
    - frontend-tg: port 80, health check `/`
    - backend-tg: port 8080, health check `/actuator/health`
    - Listener rules: `/api/*` → backend-tg / `/actuator/*` → backend-tg / 기본 → frontend-tg
12. ECS Service 2개 생성
    - 각각 TG 연결, desired=1
    - **배포 설정: minimumHealthyPercent=0, maximumPercent=100**
13. RDS 생성 (db.t3.micro, private subnet, public access No)
    - SG: 3306 from ecs-sg only
14. 동작 확인
    - `http://ALB_DNS/` 접속 → React UI
    - `http://ALB_DNS/api/tasks` → API 응답
    - `http://ALB_DNS/actuator/health` → `{"status":"UP"}`
    - CloudWatch Logs 확인
15. (선택) GitHub Actions CI/CD 추가

---

## 9) 비용 상세 (서울 리전, 24/7 가동 기준)

| 리소스               | 월 비용 (추정) | 비고                             |
| -------------------- | -------------- | -------------------------------- |
| EC2 t3.small         | ~$19           | 시간당 $0.026                    |
| ALB                  | ~$20           | 고정 ~$18.4 + LCU ~$1~2          |
| RDS db.t3.micro      | ~$17           | 시간당 ~$0.023                   |
| NAT Gateway (1개)    | ~$33           | 시간당 $0.045 + 데이터 $0.045/GB |
| EBS 20GB (gp3)       | ~$2            |                                  |
| **합계**             | **~$91/월**    |                                  |
| **크레딧 $200 지속** | **~2.2개월**   |                                  |

> ⚠️ 위 비용은 추정치입니다. **AWS Pricing Calculator**로 최종 확인을 권장합니다.
> 특히 ALB는 시간+LCU 구조라 트래픽 증가 시 비용이 달라질 수 있습니다.

> **비용 폭탄 주의:**
> NAT Gateway와 ALB는 "Stop" 개념이 없습니다. 존재하는 동안 시간당 과금됩니다.
> 학습 종료 시 반드시 **삭제**해야 과금이 멈춥니다. (아래 체크리스트 참조)

---

## 10) 리소스 정리 체크리스트 (학습 종료 시)

> ⚠️ NAT Gateway, ALB는 Stop이 불가합니다. 과금을 멈추려면 삭제가 유일한 방법입니다.

| 순서 | 리소스            | 조치                      | 주의사항                                       |
| ---- | ----------------- | ------------------------- | ---------------------------------------------- |
| 1    | ECS Service (2개) | desired=0 또는 삭제       | Task가 먼저 내려가야 함                        |
| 2    | ALB               | **삭제**                  | Stop 없음. TG도 함께 삭제                      |
| 3    | NAT Gateway       | **삭제**                  | Stop 없음. 삭제해도 EIP는 남아있음             |
| 4    | Elastic IP        | **반납 (Release)**        | NAT 삭제 후 반드시 별도 반납                   |
| 5    | Route Table       | NAT 경로 확인/삭제        | 자동 삭제 안 될 수 있음                        |
| 6    | RDS               | Stop (최대 7일) 또는 삭제 | 7일 후 자동 재시작됨. 장기 미사용 시 삭제 권장 |
| 7    | EC2 인스턴스      | Stop 또는 Terminate       | Stop 시 EBS 비용은 유지됨                      |
| 8    | ECR 이미지        | 불필요한 이미지 삭제      | 500MB 초과 시 과금                             |
| 9    | CloudWatch Logs   | 로그 그룹 삭제 (선택)     | 소량이면 비용 미미                             |

**삭제 순서가 중요합니다.** ECS Service → ALB → NAT → EIP → RDS → EC2 순으로 정리하세요.

---

## 11) README 요구사항

### A) 로컬 실행 방법

- 요구 env, `docker compose up`, 접속 URL, health 확인(`/actuator/health`), API 예시

### B) AWS 아키텍처 다이어그램

```
[Internet]
    ↓
[ALB] (public subnet, internet-facing)
    ├── /api/*       → [Backend TG] (IP target) → [Backend Service] → Spring Boot (:8080)
    ├── /actuator/*  → [Backend TG] (운영 확인용, 헬스체크와 무관)
    └── /* (기본)    → [Frontend TG] (IP target) → [Frontend Service] → nginx (:80)

[NAT Gateway] (public subnet, 1개, 단일 AZ)
    ↓
[EC2 t3.small] (private subnet)
    ├── Frontend Task (ENI) — nginx
    └── Backend Task (ENI) — Spring Boot → [RDS MySQL] (private subnet)
```

- SG 흐름: Internet → ALB(80) → ECS(80/8080) → RDS(3306)
- Subnet 구분: public(ALB, NAT) / private(EC2, RDS)

### C) 설계 결정 기록 (Decision Log)

| 결정                          | 이유                                           | 대안                                   |
| ----------------------------- | ---------------------------------------------- | -------------------------------------- |
| t3.small (t3.micro 대신)      | ENI 3개로 2 Service 분리 가능                  | t3.micro: ENI 2개, sidecar만 가능      |
| awsvpc + NAT                  | 실무 표준, Fargate 전환 대비                   | bridge: $0이지만 레거시, 학습가치 낮음 |
| NAT 1개 (단일 AZ)             | 비용 최적화, 학습 목적                         | NAT 2개: 가용성 우선, 월 +$33          |
| TG target type = IP           | awsvpc에서 Task가 자체 ENI/IP를 받으므로 필수  | Instance: awsvpc와 호환 불가           |
| 2 Service 분리                | ALB 경로 라우팅, 독립 배포/헬스체크            | sidecar: TG 1개, 경로 라우팅 불가      |
| PUT (PATCH 대신)              | 모달 전체 필드 저장 구조에 부합                | PATCH: null 처리 복잡도 증가           |
| SSM (Secrets Manager 대신)    | 무료, 학습/PoC 용도 충분                       | Secrets Manager: 유료                  |
| minimumHealthy=0, max=100     | ENI 여유 0, 다운타임 허용(학습 목적)           | 기본값(100/200): ENI 부족 에러         |
| Actuator 독립 경로            | `/api`와 분리가 운영 표준                      | `/api/actuator`: 비표준, 경로 혼란     |
| Actuator health 외부 공개     | 학습 목적, 노출 범위 health로 최소화           | 실무: 내부 ALB/WAF/별도 포트로 제한    |
| JVM -Xmx512m / 컨테이너 768MB | 힙 외 JVM 오버헤드(~1.5배) 고려, OOM Kill 방지 | -Xmx256m/512MB: 빠듯, GC 압박          |
| Graceful Shutdown 명시          | ECS 배포 시 진행 중 요청 완료 보장               | immediate: 배포 시 502 에러 발생        |
| ENTRYPOINT exec                 | java가 PID 1 → Docker SIGTERM 직접 수신          | sh -c: SIGTERM 미전달, 강제 종료        |
| prod JSON 로그 (내장 structured)| CloudWatch Logs Insights 쿼리 가능, 추가 라이브러리 불필요 | 텍스트: 파싱 어려움                     |
| dev health show-details=always  | DB 연결 상태 즉시 확인, 디버깅 용이              | never: 상세 정보 숨김                   |
| ECR 푸시 스크립트               | 수동 배포 자동화, git hash 태그로 커밋 추적      | 수동 명령어: 실수 가능, 반복 비효율     |

### D) 트러블슈팅

- ALB target unhealthy: 헬스체크 path/port/SG 확인, **TG target type이 IP인지 확인**
- Task PENDING: ENI 부족 → 기존 Task 수동 중지 후 재시도
- RDS 연결 실패: SG/서브넷/SSM 환경변수 확인
- CloudWatch Logs 미수집: awslogs 설정/IAM 권한/로그그룹 확인
- 502 Bad Gateway: Backend Task 미실행 → ECS Service 이벤트/로그 확인
- ECR pull 실패: NAT Gateway 상태/Route table 확인
- Backend OOM Kill: JVM -Xmx가 컨테이너 memory보다 낮은지 확인

---

## 12) 환경별 차이 요약

| 항목            | 로컬 (docker-compose)            | AWS (ECS)                                 |
| --------------- | -------------------------------- | ----------------------------------------- |
| 진입점          | `http://localhost/`              | `http://ALB_DNS/`                         |
| API 라우팅      | nginx `/api` → backend:8080      | ALB `/api/*` → Backend TG (IP target)     |
| Actuator 라우팅 | nginx `/actuator` → backend:8080 | ALB `/actuator/*` → Backend TG            |
| nginx 역할      | 정적 서빙 + API/Actuator 프록시  | **정적 서빙만**                           |
| 프론트 코드     | `/api/...` 호출                  | `/api/...` 호출 (동일)                    |
| 헬스체크        | `localhost/actuator/health`      | ALB → `/actuator/health` (TG가 직접 체크) |
| 로그 포맷       | 텍스트 (가독성)                  | **JSON** (CloudWatch Logs Insights 호환)  |
| Shutdown        | `stop_grace_period: 35s`         | ECS `stopTimeout: 35` (SIGTERM → graceful)|
| DB              | 로컬 MySQL 컨테이너              | RDS MySQL (private subnet)                |
| 비밀값          | docker-compose env               | SSM Parameter Store                       |
| 네트워크        | Compose 기본 네트워크            | awsvpc (Task별 ENI)                       |
| 서브넷          | 해당 없음                        | public(ALB, NAT) + private(EC2, RDS)      |

---

## 13) 참고 링크

| 주제                                         | URL                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AWS 신규 계정 $200 크레딧                    | https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/ |
| ECS Deployment Configuration (배포 파라미터) | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html#sd-deploymentconfiguration      |
| ECS Load Balancing (TG target type)          | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html                                        |
| NAT Gateway 과금 (시간당+GB당)               | https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html                                                      |
| ALB 과금 (시간당+LCU)                        | https://aws.amazon.com/elasticloadbalancing/pricing/                                                                           |
| RDS 중지 7일 제한                            | https://repost.aws/ko/knowledge-center/rds-stop-seven-days                                                                     |
| NAT 삭제 시 EIP 반납 주의                    | https://repost.aws/knowledge-center/vpc-delete-nat-gateway                                                                     |
| EC2 T3 인스턴스 스펙 (ENI 등)                | https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html                                                                   |
| awsvpcTrunking 지원 인스턴스                 | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/eni-trunking-supported-instance-types.html                         |
