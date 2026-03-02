# TODO — Task Board 구현 체크리스트

> **범위:** 로컬 환경(docker-compose) 기준 구현
> **원칙:** AWS 확장(ECS + ALB + RDS)을 감안한 구조로 작성
> **구현 순서:** 백엔드 → 프론트엔드 → Docker/통합 → 문서

---

## Phase 1: 백엔드 (Spring Boot)

### 1-1. 프로젝트 초기화

- [x] Spring Boot 3.x 프로젝트 생성 (Java 17, Gradle)
- [x] 의존성 추가: Spring Web, Spring Data JPA, Flyway, MySQL Driver, Actuator, Validation
- [x] 패키지 구조 설정 (`controller`, `service`, `repository`, `entity`, `dto`, `config`)
- [x] `.gitignore` 설정

### 1-2. Profile 및 설정 분리

- [x] `application.yml` — 공통 설정
- [x] `application-dev.yml` — 로컬 MySQL, Flyway 자동 실행, 디버그 로그
- [x] `application-prod.yml` — RDS 연결용 환경변수 참조, Actuator 노출 최소화 (`health`만)
  - _AWS 확장 대비: prod 프로필은 `${DB_HOST}` 등 환경변수로 주입받는 구조_

### 1-3. Flyway 마이그레이션

- [x] `V1__init.sql` — tasks 테이블 생성 (id, title, description, status, priority, due_date, created_at, updated_at)
- [x] `V2__indexes.sql` — 인덱스 추가 (status, priority, created_at, due_date)

### 1-4. 엔티티 / 리포지토리

- [x] `Task` 엔티티 (JPA 매핑, `@CreatedDate`/`@LastModifiedDate` 또는 수동 관리)
- [x] `TaskStatus` enum (TODO, DOING, DONE)
- [x] `TaskPriority` enum (LOW, MEDIUM, HIGH)
- [x] `TaskRepository` (JpaRepository + 검색/필터용 쿼리)

### 1-5. DTO / Validation

- [x] `TaskCreateRequest` — title 필수, description/dueDate/status/priority 선택
- [x] `TaskUpdateRequest` — PUT 전체 교체용
- [x] `TaskResponse` — API 응답용
- [x] `PageResponse<T>` — 페이징 응답 래퍼 (page, size, totalElements, totalPages, content)

### 1-6. Service / Controller

- [x] `TaskService` — CRUD + 페이징/필터/검색/정렬 로직
- [x] `TaskController` — REST API 엔드포인트:
  - `GET /api/tasks` — 목록 조회 (page, size, status, priority, q, sort)
  - `POST /api/tasks` — 생성
  - `PUT /api/tasks/{id}` — 수정 (전체 교체)
  - `DELETE /api/tasks/{id}` — 삭제 (hard delete)

### 1-7. 예외 처리

- [x] `GlobalExceptionHandler` (`@RestControllerAdvice`)
- [x] 404 Not Found, 400 Bad Request 등 표준 에러 응답 포맷

### 1-8. Request Logging Filter

- [x] 요청 로깅 필터 구현 (method, path, status, latency)
  - _AWS 확장 대비: CloudWatch Logs에서 추적 가능한 구조화된 로그_

### 1-9. Actuator 설정

- [x] `/actuator/health` 활성화 (독립 경로, `/api` 하위 아님)
- [x] dev 프로필: 기본 노출
- [x] prod 프로필: `management.endpoints.web.exposure.include=health`

---

## Phase 2: 프론트엔드 (React)

### 2-1. 프로젝트 초기화

- [ ] Vite + React + TypeScript 프로젝트 생성
- [ ] Tailwind CSS 설정
- [ ] Headless UI 설치
- [ ] `vite.config.ts` — 개발 서버 프록시 설정 (`/api` → `http://localhost:8080`, `/actuator` → `http://localhost:8080`)
- [ ] `.gitignore` 설정

### 2-2. 라우팅

- [ ] React Router 설정
- [ ] `/` → `/tasks` 리다이렉트
- [ ] `/tasks` — 메인 페이지

### 2-3. API 클라이언트

- [ ] API 호출 모듈 (`/api/...` 상대경로 사용)
  - _AWS 확장 대비: 환경별 URL 차이 없음, 항상 상대경로_
- [ ] 에러 처리 공통 로직

### 2-4. 컴포넌트 구현

- [ ] `TaskPage` — 메인 레이아웃 (Toolbar + List + Pagination)
- [ ] `TaskToolbar` — 검색(q), status 필터, priority 필터, 정렬 선택, "New Task" 버튼
- [ ] `TaskList` — Task 카드 목록
- [ ] `TaskCard` — 개별 Task 표시 (title, status, priority, dueDate 등)
- [ ] `TaskModal` — Headless UI Dialog, 생성/수정 공용
- [ ] `Pagination` — page/size 기반 페이지 네비게이션

### 2-5. 상태 관리 및 연동

- [ ] Task 목록 조회 (필터/검색/정렬/페이징 파라미터 연동)
- [ ] Task 생성 → 목록 갱신
- [ ] Task 수정 → 목록 갱신
- [ ] Task 삭제 → 목록 갱신

### 2-6. 스타일링

- [ ] Tailwind CSS 기반 반응형 레이아웃
- [ ] 상태별 색상 구분 (TODO/DOING/DONE)
- [ ] 우선순위별 시각적 표시 (LOW/MEDIUM/HIGH)

---

## Phase 3: Docker & 통합

### 3-1. 백엔드 Dockerfile

- [ ] Multi-stage build (Gradle build → JRE 실행)
- [ ] JVM 옵션: `-Xms256m -Xmx512m`
  - _AWS 확장 대비: ECS Task Definition memory 768MB에 맞춘 설정_

### 3-2. 프론트엔드 Dockerfile

- [ ] Multi-stage build (Node build → nginx 정적 서빙)
- [ ] nginx.conf 포함

### 3-3. nginx 설정

- [ ] 로컬용 `nginx.conf` — 정적 서빙 + SPA fallback + `/api` & `/actuator` 프록시
- [ ] AWS용 `nginx.conf` — 정적 서빙 + SPA fallback만 (프록시 없음)
  - _AWS 확장 대비: 환경별 nginx 설정 파일 분리_

### 3-4. docker-compose.yml

- [ ] `frontend` 서비스 (nginx, port 80)
- [ ] `backend` 서비스 (Spring Boot, port 8080)
- [ ] `db` 서비스 (MySQL)
- [ ] 환경변수 설정 (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, SPRING_PROFILES_ACTIVE=dev)
- [ ] 서비스 간 의존성 설정 (backend → db, frontend → backend)
- [ ] `docker compose up` 한 번으로 전체 동작 확인

### 3-5. 통합 테스트 (수동)

- [ ] `http://localhost/` — React UI 정상 로딩
- [ ] `http://localhost/api/tasks` — API 응답 확인
- [ ] `http://localhost/actuator/health` — `{"status":"UP"}` 확인
- [ ] CRUD 전체 흐름 테스트 (생성 → 조회 → 수정 → 삭제)
- [ ] 필터/검색/정렬/페이징 동작 확인

---

## Phase 4: 문서

### 4-1. README.md

- [ ] 로컬 실행 방법 (`docker compose up`, 접속 URL, health 확인)
- [ ] API 예시 (curl 등)
- [ ] 아키텍처 다이어그램 (로컬 기준)
- [ ] AWS 아키텍처 다이어그램 (DESIGN.md 참조)
- [ ] 설계 결정 기록 (Decision Log)
- [ ] 트러블슈팅 가이드

---

## AWS 확장 시 추가 작업 (참고용, 현재 범위 밖)

> 로컬 구현 완료 후 순차 진행. DESIGN.md 섹션 3~10 참조.

- [ ] AWS 계정 생성 + Budgets 알림 설정
- [ ] ECR 리포지토리 생성 (frontend, backend)
- [ ] VPC 구성 (public/private subnet, NAT Gateway)
- [ ] Security Group 생성 (alb-sg, ecs-sg, rds-sg)
- [ ] RDS MySQL 생성 (db.t3.micro, private subnet)
- [ ] SSM Parameter Store에 DB 접속 정보 등록
- [ ] ECS Cluster 생성 (EC2 launch type, t3.small)
- [ ] Task Definition 2개 생성 (frontend, backend)
- [ ] ALB + Target Group 2개 + 경로 기반 Listener rules
- [ ] ECS Service 2개 생성 (minimumHealthyPercent=0, maximumPercent=100)
- [ ] CloudWatch Logs 설정
- [ ] 동작 확인 (ALB DNS 접속, API, Actuator, 로그)
- [ ] GitHub Actions CI/CD 파이프라인
- [ ] 리소스 정리 체크리스트 검증
