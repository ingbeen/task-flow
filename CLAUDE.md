# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Task Board 애플리케이션 (TODO/DOING/DONE). React + Spring Boot + MySQL 구성.
로컬은 docker-compose, 운영은 AWS ECS + ALB + RDS 대상. 학습 목적 프로젝트.
인증/권한 없음. 설계 상세는 DESIGN.md, 구현 진행 상황은 TODO.md 참조.

**프로젝트 목표**: "앱 기능"보다 "배포/운영 흐름"을 보여주는 것 (컨테이너화 → ECR → ECS → ALB → RDS).

## Implementation Progress

- **Phase 1 (백엔드)**: 1-1 ~ 1-6 완료 (CRUD API 동작), 1-9 완료 (Actuator). 1-7 예외처리, 1-8 로깅 필터 미완료
- **Phase 2 (프론트엔드)**: 미시작
- **Phase 3 (Docker/통합)**: 미시작
- **Phase 4 (문서)**: 미시작

## Tech Stack

- **Backend**: Java 17 (Temurin via SDKMAN), Spring Boot 3.5.11, Gradle (Groovy DSL), Lombok
- **Frontend**: (예정) Vite + React + TypeScript + Tailwind CSS + Headless UI
- **DB**: MySQL 8.0, Flyway 마이그레이션, JPA Auditing
- **Infra**: Docker Engine on WSL2 (not Docker Desktop)

## Build & Run Commands

```bash
# Java 버전 확인 (.sdkmanrc → java=17.0.18-tem)
sdk env

# 컴파일
cd backend && ./gradlew compileJava

# 테스트 (MySQL 필요)
cd backend && SPRING_PROFILES_ACTIVE=dev ./gradlew test

# 로컬 실행 (MySQL 필요)
cd backend && SPRING_PROFILES_ACTIVE=dev ./gradlew bootRun

# 로컬 MySQL 컨테이너
docker run --name taskboard-db \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=taskboard \
  -e MYSQL_USER=taskboard \
  -e MYSQL_PASSWORD=taskboard \
  -p 3306:3306 -d mysql:8.0
```

## Architecture

### 로컬 (docker-compose, 목표)

```
브라우저 → nginx(:80)
            ├── /           → React 정적 파일 (SPA fallback)
            ├── /api/*      → proxy_pass → Spring Boot(:8080)
            └── /actuator/* → proxy_pass → Spring Boot(:8080)
                                              ↓
                                         MySQL(:3306)
```

### AWS (ECS, 목표)

```
인터넷 → ALB (public subnet)
          ├── /api/*      → Backend TG (IP target) → Spring Boot(:8080)
          ├── /actuator/* → Backend TG
          └── /* (기본)   → Frontend TG (IP target) → nginx(:80, 정적 서빙만)

EC2 t3.small (private subnet) — Frontend Task + Backend Task (ENI 3/3 한계)
NAT Gateway 1개 (public subnet, 단일 AZ)
RDS MySQL (private subnet, ecs-sg에서만 접근)
```

핵심 차이: 로컬에서는 nginx가 API 프록시, AWS에서는 ALB가 경로 라우팅. 프론트 코드는 항상 `/api/...` 상대경로.

### 백엔드 패키지 구조

```
backend/src/main/java/com/taskflow/
├── BackendApplication.java          # @SpringBootApplication
├── config/JpaConfig.java            # @EnableJpaAuditing (별도 분리 — 슬라이스 테스트 호환)
├── controller/TaskController.java   # REST endpoints: /api/tasks
├── service/TaskService.java         # 비즈니스 로직, @Transactional
├── repository/TaskRepository.java   # JpaRepository + @Query 필터/검색
├── entity/                          # Task.java, TaskStatus enum, TaskPriority enum
└── dto/                             # Request/Response DTOs, PageResponse<T>
```

## Key Design Decisions

| 결정                                       | 이유                                                          |
| ------------------------------------------ | ------------------------------------------------------------- |
| PUT 전체 교체 (PATCH 아님)                 | 모달 전체 필드 저장 구조에 부합                               |
| Hard delete                                | soft delete 불필요 (학습 목적)                                |
| Flyway + ddl-auto: validate                | Flyway가 스키마 관리, Hibernate는 검증만                      |
| @Enumerated(EnumType.STRING)               | DB에 VARCHAR(16)로 저장, ORDINAL 사용 금지                    |
| DB 컬럼 VARCHAR(16) (MySQL ENUM 대신)      | ALTER TABLE 없이 값 추가 가능                                 |
| open-in-view: false                        | OSIV 끔, Service 계층에서 데이터 로딩 강제                    |
| 정렬 필드 화이트리스트                     | 임의 필드 정렬 차단 (보안)                                    |
| @EnableJpaAuditing을 JpaConfig에 분리      | @DataJpaTest 슬라이스 테스트 Bean 충돌 방지                   |
| Profile 분리 (dev/prod)                    | dev: 환경변수 기본값 있음 / prod: 기본값 없음 (fail-fast)     |
| AWS: minimumHealthy=0, max=100             | t3.small ENI 3개 한계, 다운타임 허용 (학습 목적)              |
| AWS: NAT 1개 (단일 AZ)                     | 비용 최적화 (~$33/월), 학습 목적에서 가용성 트레이드오프 허용 |
| AWS: TG target type = IP                   | awsvpc 모드 필수 (Task가 자체 ENI/IP)                         |
| SSM Parameter Store (Secrets Manager 대신) | 무료, 학습/PoC 용도                                           |

## API Endpoints

| Method | Path             | Description                                               |
| ------ | ---------------- | --------------------------------------------------------- |
| GET    | /api/tasks       | 목록 (params: status, priority, q, page, size, sort)      |
| POST   | /api/tasks       | 생성 (title 필수, status 기본 TODO, priority 기본 MEDIUM) |
| PUT    | /api/tasks/{id}  | 수정 (전체 교체)                                          |
| DELETE | /api/tasks/{id}  | 삭제                                                      |
| GET    | /actuator/health | 헬스체크 (독립 경로, /api 하위 아님)                      |

## DB Migration

마이그레이션 파일: `backend/src/main/resources/db/migration/`

- V1\_\_init.sql: tasks 테이블 생성 (InnoDB, utf8mb4_unicode_ci)
- V2\_\_indexes.sql: 인덱스 4개 (status, priority, created_at, due_date)

수동 DDL 금지. 새 스키마 변경은 반드시 V{n}\_\_description.sql로 추가.

## Task Entity Fields

| 필드        | 타입         | 제약                        |
| ----------- | ------------ | --------------------------- |
| id          | BIGINT       | PK, AUTO_INCREMENT          |
| title       | VARCHAR(255) | NOT NULL                    |
| description | TEXT         | NULL                        |
| status      | VARCHAR(16)  | NOT NULL (TODO/DOING/DONE)  |
| priority    | VARCHAR(16)  | NOT NULL (LOW/MEDIUM/HIGH)  |
| due_date    | DATE         | NULL                        |
| created_at  | DATETIME     | NOT NULL, @CreatedDate      |
| updated_at  | DATETIME     | NOT NULL, @LastModifiedDate |

## Conventions

- 한국어 커뮤니케이션, 코드 주석도 한국어 가능
- DTO 변환: `static from()` 팩토리 메서드 패턴 (TaskResponse.from, PageResponse.from)
- 생성자 주입: `@RequiredArgsConstructor` + `private final` 필드
- Validation: Create → @NotBlank title만 필수 / Update → title, status, priority 모두 필수
- API 호출은 항상 상대경로 `/api/...` (환경 차이 없음)
- 예외 처리: 현재 RuntimeException (1-7에서 GlobalExceptionHandler로 교체 예정)

### 문서화

**Backend (Java)**:

- Javadoc 사용: 클래스, public 메서드에 Javadoc 작성
- 한글 작성 허용
- 복잡한 로직은 넘버링 주석 사용 (예: `// 1. 상태 검증`, `// 2. 엔티티 변환`)

**Frontend (TypeScript, 예정)**:

- JSDoc 사용: 컴포넌트, 유틸 함수, 커스텀 훅에 JSDoc 작성
- 한글 작성 허용
- 복잡한 로직은 넘버링 주석 사용

**공통 주석 원칙**:

- 현재 코드의 상태와 동작만 설명
- 과거 상태, 변경 이력, 계획 단계는 기록하지 않음
- 금지 패턴: "Phase 0", "Phase 3", "레드", "그린" 등 개발 단계 표현 사용 금지

### 네이밍

**Backend (Java)**:

- 메서드/변수: `camelCase`
- 클래스/인터페이스: `PascalCase`
- 상수: `UPPER_SNAKE_CASE`

**Frontend (TypeScript, 예정)**:

- 함수/변수: `camelCase`
- 컴포넌트/인터페이스/타입: `PascalCase`
- 상수: `UPPER_SNAKE_CASE`

### 타입 안정성

**Backend (Java)**:

- 모든 DTO 필드에 Validation 어노테이션 명시 (@NotBlank, @NotNull, @Size 등)
- Enum은 반드시 `@Enumerated(EnumType.STRING)` 사용
- null 가능 필드는 주석으로 명시 (예: `// null 허용 (필드 삭제 가능)`)

**Frontend (TypeScript, 예정)**:

- `any` 타입 사용 금지
- 모든 컴포넌트 props와 state에 타입/인터페이스 정의 필수
- API 응답 타입을 별도 파일에 정의하여 백엔드 DTO와 일치시킴

### 로깅 정책

레벨 사용 (SLF4J/Logback):

- DEBUG: 실행 흐름, 데이터 처리 상태, 쿼리 파라미터
- INFO: 애플리케이션 시작/종료, 주요 비즈니스 이벤트
- WARN: 잠재적 문제 상황, 폴백 동작
- ERROR: 예외 처리, 복구 불가 오류

금지 사항:

- 이모지 사용 금지
- 클래스명 중복 기재 금지 (SLF4J 로거에 자동 포함됨)
  - 금지: `log.info("[TaskService] 태스크 생성")`
  - 허용: `log.info("태스크 생성: id={}", task.getId())`

## Environment Notes

- WSL2 Ubuntu 24.04에서 개발
- WSL2와 Windows가 포트 공간을 공유함 (Windows MySQL과 포트 충돌 주의)
- Docker 그룹 미적용 시 `sg docker -c "..."` 사용 가능
