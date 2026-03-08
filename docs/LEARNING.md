# 학습 가이드

> 이 프로젝트의 설정 파일, 요청 흐름, 파일 간 관계를 이해하기 위한 문서입니다.

---

## 목차

- [1. Backend](#1-backend)
  - [1.1 설정 파일 체계](#11-설정-파일-체계)
  - [1.2 요청 처리 흐름](#12-요청-처리-흐름)
  - [1.3 파일 관계도](#13-파일-관계도)
  - [1.4 핵심 개념](#14-핵심-개념)
- [2. Frontend](#2-frontend)
  - [2.1 설정 파일 체계](#21-설정-파일-체계)
  - [2.2 요청 처리 흐름](#22-요청-처리-흐름)
  - [2.3 파일 관계도](#23-파일-관계도)
  - [2.4 핵심 개념](#24-핵심-개념)
- [3. Docker](#3-docker)
  - [3.1 설정 파일 체계](#31-설정-파일-체계)
  - [3.2 요청 처리 흐름](#32-요청-처리-흐름)
  - [3.3 파일 관계도](#33-파일-관계도)
  - [3.4 핵심 개념](#34-핵심-개념)

---

# 1. Backend

## 1.1 설정 파일 체계

### build.gradle — 프로젝트 빌드 설정

**역할**: 의존성 관리, 빌드 방식, Java 버전을 정의하는 파일. 모든 Java 코드가 이 파일에 선언된 라이브러리를 사용한다.

**주요 설정과 영향**:

| 설정 | 값 | 영향 범위 |
|------|-----|----------|
| `java toolchain 17` | Java 17 | 모든 소스코드의 컴파일 대상 버전 |
| `spring-boot-starter-web` | Spring MVC | Controller가 HTTP 요청을 처리할 수 있음 |
| `spring-boot-starter-data-jpa` | JPA/Hibernate | Entity, Repository가 DB와 매핑됨 |
| `spring-boot-starter-validation` | Bean Validation | DTO의 `@NotBlank`, `@Size` 등이 동작함 |
| `spring-boot-starter-actuator` | Actuator | `/actuator/health` 엔드포인트가 활성화됨 |
| `flyway-core` + `flyway-mysql` | Flyway | `db/migration/` 아래 SQL 파일이 자동 실행됨 |
| `lombok` | Lombok | `@Getter`, `@Setter`, `@RequiredArgsConstructor` 등 사용 가능 |
| `mysql-connector-j` | MySQL 드라이버 | Spring이 MySQL에 연결 가능 |

> **의존성 하나를 빼면 어떻게 되나?**
> - `starter-validation` 제거 → `@NotBlank`가 무시됨, 빈 title로 태스크 생성 가능
> - `flyway-core` 제거 → 앱 시작 시 마이그레이션이 실행되지 않음, DB 테이블 없음
> - `starter-actuator` 제거 → `/actuator/health` 엔드포인트가 사라짐, ALB 헬스체크 실패

---

### application.yml — 공통 설정 (모든 환경)

**역할**: 어떤 프로필(dev/prod)이 활성화되든 항상 적용되는 기본 설정.

```yaml
spring:
  profiles:
    active: dev                          # ① 기본 프로필
  lifecycle:
    timeout-per-shutdown-phase: 30s      # ② 종료 대기 시간
  jpa:
    open-in-view: false                  # ③ OSIV 비활성화
    hibernate:
      ddl-auto: validate                 # ④ 스키마 검증만
  flyway:
    enabled: true                        # ⑤ Flyway 활성화
    locations: classpath:db/migration    # ⑥ 마이그레이션 파일 경로

server:
  port: 8080                             # ⑦ 서버 포트
  shutdown: graceful                     # ⑧ Graceful Shutdown

management:
  endpoints:
    web:
      exposure:
        include: health                  # ⑨ Actuator 노출 범위
```

**각 설정의 영향**:

| # | 설정 | 영향 |
|---|------|------|
| ① | `active: dev` | 환경변수 `SPRING_PROFILES_ACTIVE`가 없으면 dev 프로필 사용 |
| ② | `timeout-per-shutdown-phase: 30s` | SIGTERM 수신 후 진행 중 요청을 완료할 때까지 최대 30초 대기 |
| ③ | `open-in-view: false` | Controller에서 Lazy Loading 불가 → Service에서 모든 데이터를 미리 로딩해야 함 |
| ④ | `ddl-auto: validate` | Hibernate가 스키마를 변경하지 않고, Entity와 DB 테이블이 불일치하면 앱 시작 실패 |
| ⑤ | `flyway.enabled: true` | 앱 시작 시 `db/migration/` SQL 파일을 순서대로 실행 |
| ⑥ | `locations` | V1, V2... SQL 파일을 찾는 디렉토리 경로 |
| ⑦ | `port: 8080` | Spring Boot가 8080 포트에서 HTTP 요청을 수신 |
| ⑧ | `shutdown: graceful` | 새 요청 거부 + 진행 중 요청 완료 후 종료 (Spring Boot 3.4+ 기본값이지만 명시) |
| ⑨ | `include: health` | `/actuator/health`만 외부 노출. env, beans 등은 노출 안 됨 |

> **⑧ graceful shutdown이란?**
> SIGTERM을 받으면 즉시 종료하지 않고, 진행 중인 요청을 완료한 후 종료한다.
> ECS 배포 시 Task 교체 과정에서 502 에러를 줄여준다.
> Docker의 `stop_grace_period`(35s)가 Spring의 shutdown timeout(30s)보다 길어야 한다.
> Dockerfile ENTRYPOINT에 `exec`를 사용하여 java가 PID 1이 되어야 SIGTERM이 전달된다.

> **② open-in-view: false가 없으면?**
> 기본값은 `true`. Controller에서 Entity의 Lazy 필드에 접근할 수 있지만,
> 의도치 않은 DB 쿼리가 Controller에서 발생할 수 있다 (N+1 문제의 원인).
> `false`로 설정하면 "어디서 데이터를 로딩하는지"가 명확해진다.

> **③ validate와 update의 차이는?**
> - `validate`: Entity와 DB가 불일치하면 **앱이 죽는다** (안전)
> - `update`: Hibernate가 자동으로 ALTER TABLE 실행 (위험 — 의도치 않은 스키마 변경 가능)
> - 이 프로젝트에서는 Flyway가 스키마를 관리하므로, Hibernate는 검증만 한다.

---

### application-dev.yml — 개발 환경 설정

**역할**: 로컬 개발 시 사용되는 설정. 환경변수가 없어도 기본값으로 동작한다.

```yaml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/${DB_NAME:taskboard}
    username: ${DB_USER:taskboard}
    password: ${DB_PASSWORD:taskboard}

logging:
  level:
    "[com.taskflow]": DEBUG              # 우리 코드 로그 레벨
    "[org.springframework.web]": DEBUG   # Spring 내부 로그
    "[org.hibernate.SQL]": DEBUG         # 실행되는 SQL 쿼리
    "[org.hibernate.orm.jdbc.bind]": TRACE  # SQL 바인딩 파라미터

management:
  endpoint:
    health:
      show-details: always               # 헬스체크 상세 정보 표시
```

> **show-details: always의 효과**:
> `/actuator/health` 응답에 DB 연결 상태 등 상세 정보가 포함된다:
> ```json
> {"status":"UP","components":{"db":{"status":"UP","details":{"database":"MySQL"}}}}
> ```
> prod에서는 기본값 `never`로 `{"status":"UP"}`만 노출된다 (보안).
> DB가 다운되면 어느 환경에서든 503을 반환하여 ALB 헬스체크가 실패한다.

**핵심 차이 (dev vs prod)**:

| 항목 | dev | prod |
|------|-----|------|
| DB 기본값 | `localhost:3306/taskboard` | **없음** (환경변수 필수, DB_PORT만 3306 기본값) |
| SSL | `useSSL=false` | `useSSL=true` |
| 로깅 | DEBUG/TRACE (상세, 텍스트) | INFO/WARN (최소, **JSON**) |
| 로그 포맷 | 텍스트 (기본) | `logstash` JSON (CloudWatch 호환) |
| 헬스체크 상세 | `show-details: always` | `show-details: never` (기본) |
| 실패 전략 | fail-safe (기본값으로 동작) | fail-fast (설정 누락 시 시작 실패) |

> **왜 prod에는 기본값이 없는가?**
> 운영 환경에서 실수로 로컬 DB에 연결되는 것을 방지한다.
> DB_HOST, DB_NAME, DB_USER, DB_PASSWORD는 기본값이 없어 누락 시 앱이 시작되지 않는다 (fail-fast).
> DB_PORT만 3306 기본값이 있는데, MySQL 표준 포트라 변경 가능성이 낮기 때문이다.

---

### db/migration/ — Flyway 마이그레이션 파일

**역할**: DB 스키마의 버전 관리. 앱이 시작될 때 자동으로 실행된다.

| 파일 | 실행 순서 | 내용 |
|------|----------|------|
| `V1__init.sql` | 1번째 | tasks 테이블 생성 (InnoDB, utf8mb4) |
| `V2__indexes.sql` | 2번째 | 인덱스 4개 추가 (status, priority, created_at, due_date) |

**실행 흐름**:
```
앱 시작
  → Flyway가 flyway_schema_history 테이블 확인
  → 미적용 버전만 순서대로 실행
  → 각 실행 결과를 flyway_schema_history에 기록
  → Hibernate가 Entity와 DB 스키마 비교 (validate)
  → 불일치하면 앱 시작 실패
```

**파일명 규칙**: `V{버전}__{설명}.sql`
- `V` 접두사 필수
- 버전은 순차적 (V1, V2, V3...)
- `__` (언더스코어 2개) 구분자
- 이미 적용된 파일은 **절대 수정 금지** (체크섬 불일치로 앱 실패)

---

## 1.2 요청 처리 흐름

### 정상 요청: `GET /api/tasks?status=TODO&page=0&size=10`

```
① 클라이언트 → HTTP 요청 도착

② RequestLoggingFilter (OncePerRequestFilter)
   - /actuator로 시작? → shouldNotFilter() = true → 로깅 건너뜀
   - /api로 시작? → 타이머 시작, filterChain.doFilter() 호출
   - 요청 완료 후:
     log.atInfo()
       .addKeyValue("http_method", "GET")
       .addKeyValue("uri", "/api/tasks")
       .addKeyValue("status", 200)
       .addKeyValue("latency_ms", 15)
       .log("HTTP GET /api/tasks 200 15ms")
   - dev: 텍스트 출력 "HTTP GET /api/tasks 200 15ms"
   - prod: JSON 출력 {"http_method":"GET","uri":"/api/tasks","status":200,"latency_ms":15,...}

③ DispatcherServlet (Spring 내부)
   - URL 패턴과 @RequestMapping 매칭
   - /api/tasks → TaskController.getTasks() 결정

④ TaskController.getTasks()
   - @RequestParam으로 쿼리 파라미터 추출
   - status="TODO" → TaskStatus.TODO (enum 변환)
   - page=0, size=10, sort="createdAt,desc" (기본값)
   - TaskService.getTasks() 호출

⑤ TaskService.getTasks()
   - parseSortParameter("createdAt,desc")
     → isAllowedSortProperty("createdAt") = true
     → Sort.by(DESC, "createdAt") 생성
   - PageRequest.of(0, 10, sort) → Pageable 생성
   - TaskRepository.findByFilters(TODO, null, null, pageable) 호출

⑥ TaskRepository (@Query JPQL)
   - Hibernate가 JPQL → SQL 변환:
     SELECT t.* FROM tasks t
     WHERE t.status = 'TODO'
     ORDER BY t.created_at DESC
     LIMIT 10 OFFSET 0
   - DB에서 Page<Task> 반환

⑦ TaskService (결과 변환)
   - taskPage.map(TaskResponse::from) → Page<TaskResponse>
   - PageResponse.from(responsePage) → PageResponse<TaskResponse>

⑧ TaskController → ResponseEntity.ok(result)
   - Spring이 PageResponse → JSON 직렬화 (Jackson)
   - HTTP 200 + JSON 응답 반환

⑨ RequestLoggingFilter
   - 소요 시간 계산, 로그 기록
```

### 예외 요청: `POST /api/tasks` + `{"title": ""}`

```
①~③ 동일 (요청 도착 → 라우팅)

④ TaskController.createTask(@Valid TaskCreateRequest request)
   - Jackson이 JSON → TaskCreateRequest 변환
   - @Valid 트리거 → Bean Validation 실행
   - title="" → @NotBlank 위반!
   - MethodArgumentNotValidException 발생

⑤ GlobalExceptionHandler.handleValidation()
   - @ExceptionHandler(MethodArgumentNotValidException.class) 매칭
   - ex.getBindingResult().getFieldErrors()에서 필드별 에러 추출
   - ErrorResponse 생성:
     {
       "status": 400,
       "code": "VALIDATION_FAILED",
       "message": "요청 데이터가 유효하지 않습니다",
       "fieldErrors": [{"field": "title", "message": "Title is required"}],
       "timestamp": "2026-03-02T10:00:00"
     }
   - HTTP 400 응답 반환
```

### 예외 우선순위

예외가 발생하면 Spring은 **가장 구체적인 타입**부터 매칭한다:

```
TaskNotFoundException              → 404 NOT_FOUND
MethodArgumentNotValidException    → 400 VALIDATION_FAILED
HttpMessageNotReadableException    → 400 INVALID_REQUEST_BODY
MethodArgumentTypeMismatchException → 400 TYPE_MISMATCH
NoResourceFoundException           → 404 NOT_FOUND
Exception (모든 예외의 부모)        → 500 INTERNAL_ERROR ← 최종 안전망
```

---

## 1.3 파일 관계도

### 설정 파일 → 코드 영향

```
build.gradle
  ├── spring-boot-starter-web ──────→ TaskController가 HTTP를 처리할 수 있음
  ├── spring-boot-starter-data-jpa ─→ TaskRepository가 DB에 접근할 수 있음
  ├── spring-boot-starter-validation→ DTO의 @NotBlank 등이 동작함
  ├── spring-boot-starter-actuator ─→ /actuator/health 엔드포인트 존재
  ├── flyway-core ──────────────────→ db/migration/ SQL 자동 실행
  └── lombok ───────────────────────→ @Getter, @RequiredArgsConstructor 등 사용

application.yml
  ├── ddl-auto: validate ───────────→ Task.java ↔ V1__init.sql 일치 검증
  ├── flyway.enabled: true ─────────→ V1, V2 SQL 파일 자동 실행
  ├── open-in-view: false ──────────→ Service에서 모든 데이터 로딩 강제
  ├── shutdown: graceful ───────────→ SIGTERM 시 진행 중 요청 완료 후 종료
  ├── timeout-per-shutdown-phase ───→ 종료 대기 최대 30초
  └── management.exposure ──────────→ /actuator/health만 외부 노출

application-dev.yml
  ├── datasource.url ───────────────→ MySQL 연결 정보 (기본값: localhost)
  ├── logging.level ────────────────→ DEBUG 로그 출력 범위
  └── show-details: always ─────────→ 헬스체크에 DB 연결 상태 포함

application-prod.yml
  ├── datasource.url ───────────────→ RDS 연결 (환경변수 필수, 기본값 없음)
  ├── logging.level ────────────────→ INFO/WARN 최소 로깅
  └── structured.format.console ────→ logstash JSON 포맷 (CloudWatch 호환)
```

### 코드 간 호출 관계

```
BackendApplication.java (@SpringBootApplication)
  │
  ├── JpaConfig.java (@EnableJpaAuditing)
  │     └── Task.java의 @CreatedDate, @LastModifiedDate 자동 설정
  │
  ├── RequestLoggingFilter.java (@Component, 자동 등록)
  │     └── 모든 HTTP 요청 로깅 (/actuator 제외)
  │
  ├── TaskController.java (@RestController)
  │     ├── GET  /api/tasks    → TaskService.getTasks()
  │     ├── POST /api/tasks    → TaskService.createTask()
  │     ├── PUT  /api/tasks/{id} → TaskService.updateTask()
  │     └── DELETE /api/tasks/{id} → TaskService.deleteTask()
  │
  ├── TaskService.java (@Service)
  │     ├── TaskRepository.findByFilters() ← 목록 조회
  │     ├── TaskRepository.save()          ← 생성/수정
  │     ├── TaskRepository.existsById()    ← 삭제 전 존재 확인
  │     ├── TaskRepository.deleteById()    ← 삭제
  │     ├── TaskResponse.from()            ← Entity → DTO 변환
  │     ├── PageResponse.from()            ← Page → PageResponse 변환
  │     └── TaskNotFoundException          ← 존재하지 않는 ID
  │
  ├── TaskRepository.java (JpaRepository)
  │     └── @Query findByFilters() → JPQL → SQL → MySQL
  │
  └── GlobalExceptionHandler.java (@RestControllerAdvice)
        └── 모든 컨트롤러 예외 → ErrorResponse JSON 변환
```

### Entity ↔ DB 매핑

```
Task.java (Entity)                    V1__init.sql (Flyway)
─────────────────                     ─────────────────────
@Id Long id                    ←→    id BIGINT AUTO_INCREMENT
String title                   ←→    title VARCHAR(255) NOT NULL
String description             ←→    description TEXT NULL
TaskStatus status              ←→    status VARCHAR(16) NOT NULL
TaskPriority priority          ←→    priority VARCHAR(16) NOT NULL
LocalDate dueDate              ←→    due_date DATE NULL
LocalDateTime createdAt        ←→    created_at DATETIME NOT NULL
LocalDateTime updatedAt        ←→    updated_at DATETIME NOT NULL

※ ddl-auto: validate → 이 매핑이 불일치하면 앱 시작 실패
```

---

## 1.4 핵심 개념

### 계층 구조와 책임

```
Controller (HTTP 처리)     "무엇을 받고 무엇을 반환하는가"
    ↓
Service (비즈니스 로직)     "어떤 규칙으로 처리하는가"
    ↓
Repository (데이터 접근)    "어떻게 DB에서 가져오는가"
    ↓
Entity (도메인 모델)        "데이터의 형태는 무엇인가"
```

> 각 계층이 자기 위 계층만 참조한다.
> Controller가 Repository를 직접 호출하지 않고, 반드시 Service를 거친다.

### DTO와 Entity를 분리하는 이유

```
클라이언트 ←→ DTO ←→ Service ←→ Entity ←→ DB

DTO (TaskResponse):          Entity (Task):
- 클라이언트에 보여줄 것만    - DB와 직접 매핑
- 민감 정보 제외 가능         - @CreatedDate 등 JPA 기능
- API 스펙 변경에 유연        - 내부 구조 변경에 유연
```

> Entity를 직접 반환하면? API 응답 구조가 DB 구조에 종속된다.
> DB 컬럼을 추가하면 API 응답도 자동으로 바뀌어 클라이언트가 깨질 수 있다.

### @Transactional의 역할

```java
@Service
@Transactional(readOnly = true)    // 클래스 기본: 읽기 전용
public class TaskService {

    public PageResponse getTasks() { ... }      // readOnly=true 적용

    @Transactional                              // 쓰기 가능으로 오버라이드
    public TaskResponse createTask() { ... }    // readOnly=false

    @Transactional
    public void deleteTask() { ... }            // readOnly=false
}
```

> - `readOnly=true`: DB 쓰기 작업 불가, 성능 최적화 힌트
> - `@Transactional`: 메서드 실행 중 예외 발생 시 자동 롤백

### Spring Bean 등록 방식

```
@SpringBootApplication (자동 컴포넌트 스캔)
  └── com.taskflow 패키지 아래의 모든 어노테이션 자동 등록

@Component        → RequestLoggingFilter
@Service          → TaskService
@Repository       → TaskRepository (JpaRepository 상속 시 자동)
@RestController   → TaskController
@RestControllerAdvice → GlobalExceptionHandler
@Configuration    → JpaConfig
```

> Spring이 앱 시작 시 이 어노테이션이 붙은 클래스를 찾아 Bean으로 등록한다.
> `@RequiredArgsConstructor`의 생성자 주입도 이 Bean들을 자동으로 연결한다.

---

# 2. Frontend

## 2.1 설정 파일 체계

### package.json — 프로젝트 의존성과 스크립트

**역할**: npm으로 관리되는 의존성 목록과 실행 스크립트. Frontend의 `build.gradle`에 해당한다.

**주요 의존성과 영향**:

| 의존성 | 영향 범위 |
|--------|----------|
| `react` + `react-dom` | 모든 컴포넌트(.tsx)가 동작 |
| `react-router` | `router.tsx`의 라우팅, `<Navigate>`, `<Link>` 사용 가능 |
| `@headlessui/react` | `TaskModal.tsx`의 `<Dialog>` 컴포넌트 (접근성 보장) |
| `vite` | 개발 서버(HMR), 빌드(번들링), 프록시 기능 |
| `typescript` | 모든 `.ts`, `.tsx` 파일의 타입 검사 |
| `tailwindcss` | `index.css`의 `@import "tailwindcss"`로 유틸리티 클래스 활성화 |

**스크립트**:
```
npm run dev     → Vite 개발 서버 (localhost:5173, HMR)
npm run build   → TypeScript 컴파일 + Vite 번들링 → dist/ 폴더 생성
npm run lint    → ESLint 코드 품질 검사
npm run preview → 빌드 결과를 로컬에서 미리보기
```

---

### vite.config.ts — 빌드 도구 설정

**역할**: 개발 서버 동작, 빌드 방식, 플러그인을 정의한다.

```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],     // ① React + Tailwind 플러그인
  server: {
    proxy: {                              // ② 개발 서버 프록시
      '/api': { target: apiTarget },
      '/actuator': { target: apiTarget },
    },
  },
});
```

**각 설정의 영향**:

| # | 설정 | 영향 |
|---|------|------|
| ① | `plugins` | JSX 변환, Tailwind CSS 처리가 빌드에 포함됨 |
| ② | `proxy` | `npm run dev`시 `/api/*` → `localhost:8080`으로 프록시 |

> **프록시가 없으면?**
> 개발 서버(localhost:5173)에서 백엔드(localhost:8080)로 직접 요청하면
> 브라우저의 Same-Origin Policy에 의해 CORS 에러가 발생한다.
> 프록시를 사용하면 브라우저는 "같은 origin으로 요청했다"고 인식한다.

> **운영(docker-compose)에서는?**
> nginx가 프록시 역할을 하므로 Vite 프록시는 사용되지 않는다.
> Vite 프록시는 `npm run dev` (개발 서버)에서만 동작한다.

---

### tsconfig 파일 — TypeScript 컴파일 설정

```
tsconfig.json (루트)
  ├── tsconfig.app.json   → src/ 아래 앱 코드 컴파일
  └── tsconfig.node.json  → vite.config.ts 컴파일
```

**tsconfig.app.json 주요 설정**:

| 설정 | 값 | 영향 |
|------|-----|------|
| `strict: true` | 엄격한 타입 검사 | null 체크, 암묵적 any 금지 |
| `jsx: "react-jsx"` | React 17+ JSX 변환 | `import React` 없이 JSX 사용 가능 |
| `noUnusedLocals: true` | 미사용 변수 금지 | 사용하지 않는 변수가 있으면 컴파일 에러 |

---

### index.css — Tailwind CSS 진입점

```css
@import "tailwindcss";
```

> Tailwind CSS v4에서는 이 한 줄로 모든 유틸리티 클래스가 활성화된다.
> 별도의 `tailwind.config.js`가 필요 없다 (v3에서는 필요했음).
> Vite 플러그인(`@tailwindcss/vite`)이 빌드 시 사용된 클래스만 추출한다.

---

### nginx-local.conf / nginx-aws.conf — 정적 파일 서빙

**로컬용 (nginx-local.conf)**:
```
브라우저 → nginx(:80)
  /             → React 정적 파일 (SPA fallback)
  /api/*        → proxy_pass → backend:8080
  /actuator/*   → proxy_pass → backend:8080
```

**AWS용 (nginx-aws.conf)**:
```
브라우저 → ALB
  /api/*        → Backend Target Group (ALB가 라우팅)
  /actuator/*   → Backend Target Group (ALB가 라우팅)
  /*            → Frontend Target Group → nginx(:80)
                    → React 정적 파일 (SPA fallback만, 프록시 없음)
```

> **왜 파일이 2개인가?**
> 로컬에서는 nginx가 API 프록시를 해야 하지만, AWS에서는 ALB가 경로 라우팅을 한다.
> 프론트엔드 코드는 항상 `/api/...` 상대경로를 사용하므로 코드 변경 없이 환경만 전환된다.

---

## 2.2 요청 처리 흐름

### 브라우저 최초 접속: `http://localhost/`

```
① 브라우저 → GET / → nginx

② nginx: try_files
   - /usr/share/nginx/html/ 에 index.html 파일 있음
   - index.html 반환 (HTTP 200)

③ 브라우저: index.html 로드
   - <script src="/src/main.tsx"> → Vite가 번들링한 JS 로드

④ main.tsx 실행
   - React 앱 마운트 (id="root" 요소에)
   - RouterProvider에 router 전달

⑤ router.tsx: 현재 URL = "/"
   - path: "/" 매칭 → <Navigate to="/tasks" replace />
   - 브라우저 URL이 /tasks로 변경 (히스토리 교체)

⑥ router.tsx: 현재 URL = "/tasks"
   - path: "/tasks" 매칭 → <TaskPage /> 렌더링

⑦ TaskPage.tsx 렌더링
   - useTasks() 훅 초기화
   - 최초 useEffect 실행 → fetchTasks() API 호출

⑧ API 호출: GET /api/tasks?page=0&size=10&sort=createdAt,desc
   - apiClient.ts: fetch('/api/tasks?...') 실행
   - nginx: /api/* → proxy_pass → backend:8080
   - 백엔드 응답 → JSON 파싱 → state 업데이트

⑨ 리렌더링
   - tasks 배열에 데이터 → TaskList → TaskCard들 렌더링
   - 전체 건수 → TaskToolbar에 표시
   - 페이지 정보 → Pagination 렌더링
```

### 사용자 검색: 검색창에 "태스크" 입력

```
① 사용자가 "태" 입력
   - TaskToolbar: onFiltersChange({ q: "태" })
   - useTasks: filters.q = "태", debounce 타이머 시작 (300ms)

② 150ms 후 "태스" 입력
   - onFiltersChange({ q: "태스" })
   - 이전 타이머 취소, 새 타이머 시작 (300ms)

③ 200ms 후 "태스크" 입력
   - onFiltersChange({ q: "태스크" })
   - 이전 타이머 취소, 새 타이머 시작 (300ms)

④ 300ms 경과 (추가 입력 없음)
   - debouncedQ = "태스크" 업데이트
   - useEffect 트리거 → fetchTasks({ q: "태스크", page: 0, ... })
   - page가 0으로 초기화됨 (필터 변경 시)

⑤ API 호출 1회만 발생
   - GET /api/tasks?q=태스크&page=0&size=10&sort=createdAt,desc
```

> **debounce가 없으면?**
> "태스크" 3글자 입력 시 API가 3번 호출된다.
> 빠르게 타이핑하면 초당 10회 이상 호출될 수 있어 서버에 부하가 가해진다.

### 태스크 생성: 모달에서 저장

```
① 사용자: "새 태스크" 버튼 클릭
   - TaskPage: setIsOpen(true), setSelectedTask(null)
   - TaskModal: isOpen=true, task=null → 생성 모드

② 사용자: 제목 입력 + "저장" 클릭
   - TaskModal: 클라이언트 검증 (제목이 비어있지 않은지)
   - 통과 → createTask(request) API 호출

③ API 호출: POST /api/tasks
   - apiClient: fetch('/api/tasks', { method: 'POST', body: JSON })
   - 성공 (201) → onSuccess() 콜백 호출

④ TaskPage.handleModalSuccess()
   - refresh() → useTasks가 fetchTasks() 재호출
   - 목록이 새 태스크를 포함하여 갱신

⑤ 실패 시 (400 VALIDATION_FAILED)
   - apiClient: response.ok = false → ApiError throw
   - TaskModal: catch(error)
     - ApiError.fieldErrors → 필드별 에러 메시지 표시
     - 모달은 닫히지 않음 (사용자가 수정 가능)
```

---

## 2.3 파일 관계도

### 데이터 흐름

```
types/task.ts (타입 정의) ─── 모든 파일에서 import
  │
  ├── api/apiClient.ts (fetch 래퍼)
  │     └── 모든 HTTP 요청의 공통 처리 (헤더, 에러 변환)
  │
  ├── api/taskApi.ts (API 함수)
  │     ├── fetchTasks()   → useTasks에서 호출
  │     ├── createTask()   → TaskModal에서 호출
  │     ├── updateTask()   → TaskModal에서 호출
  │     └── deleteTask()   → TaskPage에서 호출
  │
  └── constants/task.ts (상수)
        ├── STATUS_LABELS, STATUS_COLORS → TaskCard, TaskToolbar
        ├── PRIORITY_LABELS, PRIORITY_COLORS → TaskCard, TaskToolbar
        └── SORT_OPTIONS, DEFAULT_PAGE_SIZE → TaskToolbar, useTasks
```

### 컴포넌트 트리

```
main.tsx
  └── RouterProvider
        └── router.tsx
              ├── "/" → <Navigate to="/tasks">
              ├── "/tasks" → TaskPage
              │     ├── useTasks() (상태 관리 훅)
              │     ├── TaskToolbar (검색 + 필터 + 정렬 + 새 태스크 버튼)
              │     ├── TaskList (카드 그리드)
              │     │     └── TaskCard × N (개별 카드)
              │     ├── Pagination (페이지 네비게이션)
              │     └── TaskModal (생성/수정 모달)
              └── "*" → NotFoundPage
```

### Props 흐름

```
TaskPage (상태 소유자)
  │
  ├── TaskToolbar
  │     props: filters, totalElements, onFiltersChange, onNewTask
  │
  ├── TaskList
  │     props: tasks, loading, error, onTaskClick, onTaskDelete, onRetry
  │     │
  │     └── TaskCard
  │           props: task, onClick, onDelete
  │
  ├── Pagination
  │     props: page, totalPages, onPageChange
  │
  └── TaskModal
        props: isOpen, task, onClose, onSuccess
```

> **상태 끌어올리기 (Lifting State Up)**:
> 모든 상태가 TaskPage에 집중되어 있다.
> 자식 컴포넌트는 props를 받아 렌더링만 하고, 이벤트가 발생하면
> 콜백 함수(onFiltersChange, onTaskClick 등)를 통해 부모에게 알린다.

---

## 2.4 핵심 개념

### 상대경로 API 호출

```typescript
// apiClient.ts
fetch('/api/tasks', { ... })   // ← 도메인 없이 경로만
```

> 브라우저는 현재 페이지의 도메인을 자동으로 붙인다:
> - 로컬: `http://localhost/api/tasks` → nginx 프록시 → backend
> - AWS: `http://ALB주소/api/tasks` → ALB 라우팅 → backend
>
> 코드 변경 없이 모든 환경에서 동작한다.

### 커스텀 훅 패턴 (useTasks)

```
useTasks() = useState + useEffect + useCallback 조합

역할:
  1. 필터/검색/정렬/페이징 상태 관리
  2. 상태 변경 시 자동으로 API 호출
  3. debounce 적용 (검색어)
  4. 로딩/에러 상태 관리

사용처:
  TaskPage에서 const { tasks, filters, setFilters, ... } = useTasks();
```

> 이 로직이 TaskPage 안에 직접 있으면 컴포넌트가 매우 길어진다.
> 훅으로 분리하면 "상태 관리"와 "UI 렌더링"을 명확히 나눌 수 있다.

### ApiError와 에러 처리

```
백엔드 ErrorResponse (JSON)
  ↓ apiClient.ts에서 변환
ApiError (JavaScript Error 객체)
  ↓ catch 블록에서 처리
컴포넌트별 에러 표시

예시:
  TaskModal에서 createTask() 실패
    → catch(error) { if (error instanceof ApiError) ... }
    → error.fieldErrors → 필드별 에러 메시지 렌더링
```

> 백엔드의 `ErrorResponse` 구조를 프론트엔드의 `ApiError`가 그대로 매핑한다.
> 덕분에 "어떤 필드에 어떤 에러가 있는지" 정확히 표시할 수 있다.

---

# 3. Docker

## 3.1 설정 파일 체계

### docker-compose.yml — 운영 모드

**역할**: `docker compose up --build` 한 번으로 전체 시스템을 실행한다.

**서비스 구성**:

```yaml
services:
  frontend:                              # nginx (React 정적 파일 + API 프록시)
    build: ./frontend                    # frontend/Dockerfile 사용
    ports: ["80:80"]                     # 유일한 외부 노출 포트
    depends_on: [backend]

  backend:                               # Spring Boot API 서버
    build: ./backend                     # backend/Dockerfile 사용
    stop_grace_period: 35s               # ★ graceful shutdown 대기 (Spring 30s + 여유 5s)
    environment:
      SPRING_PROFILES_ACTIVE: dev
      DB_HOST: db                        # docker-compose 서비스명 = DNS
    depends_on:
      db:
        condition: service_healthy       # DB 헬스체크 통과 후 시작

  db:                                    # MySQL 8.0
    image: mysql:8.0
    volumes: [db-data:/var/lib/mysql]    # 데이터 영속성
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
```

**핵심 설정의 영향**:

| 설정 | 영향 |
|------|------|
| `ports: ["80:80"]` | frontend만 외부 노출. backend/db는 Docker 내부에서만 접근 |
| `stop_grace_period: 35s` | `docker compose stop` 시 35초 대기 후 SIGKILL (Spring 종료 시간 보장) |
| `depends_on: service_healthy` | MySQL이 준비될 때까지 backend가 대기 |
| `DB_HOST: db` | Docker DNS로 컨테이너 간 통신 (IP 불필요) |
| `volumes: [db-data]` | `docker compose down`해도 데이터 유지 (`-v` 옵션 시 삭제) |

> **포트가 하나만 노출되는 이유**:
> 브라우저는 nginx(80)에만 접속한다. `/api/*` 요청은 nginx가 내부적으로
> backend:8080으로 프록시한다. 외부에서 DB에 직접 접근할 수 없다 (보안).

---

### docker-compose.dev.yml — 개발 모드

**역할**: 소스 코드 변경이 즉시 반영되는 개발 환경.

**운영 모드와의 차이**:

| 항목 | 운영 모드 | 개발 모드 |
|------|----------|----------|
| 실행 명령 | `docker compose up` | `docker compose -f docker-compose.dev.yml up` |
| Frontend | nginx (정적 빌드물) | Vite 개발 서버 (HMR) |
| Frontend 포트 | 80 | 5173 |
| Backend 포트 | 내부만 (프록시 경유) | 8080 외부 노출 |
| 소스 변경 | 이미지 재빌드 필요 | 즉시 반영 (바인드 마운트) |
| Dockerfile | Dockerfile (멀티스테이지) | Dockerfile.dev (단일스테이지) |

**개발 모드의 바인드 마운트**:
```yaml
frontend:
  volumes:
    - ./frontend:/app              # 호스트 소스 → 컨테이너 동기화
    - /app/node_modules            # node_modules는 컨테이너 것 유지

backend:
  volumes:
    - ./backend:/app               # 호스트 소스 → 컨테이너 동기화
```

> **왜 `/app/node_modules`를 별도로 마운트하는가?**
> `./frontend:/app`은 호스트의 frontend 폴더 전체를 덮어씌운다.
> 하지만 node_modules는 컨테이너 안에서 `npm ci`로 설치한 것을 사용해야 한다.
> 익명 볼륨으로 마운트하면 호스트의 node_modules와 격리된다.

---

### Dockerfile (운영) vs Dockerfile.dev (개발)

**backend/Dockerfile (운영)**:
```dockerfile
# Stage 1: 빌드 (JDK)
FROM eclipse-temurin:17-jdk AS builder
COPY . .
RUN ./gradlew bootJar -x test

# Stage 2: 실행 (JRE만)
FROM eclipse-temurin:17-jre
COPY --from=builder app.jar .
RUN adduser spring                     # 비root 사용자
USER spring
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
```

> **exec가 중요한 이유**:
> `sh -c "java ..."` → java는 sh의 **자식 프로세스** (PID 1 = sh)
> `sh -c "exec java ..."` → java가 sh를 **대체** (PID 1 = java)
> Docker는 SIGTERM을 PID 1에게만 보내므로, `exec` 없이는 java가 SIGTERM을 받지 못한다.
> 결과: graceful shutdown이 동작하지 않고 30초 후 SIGKILL로 강제 종료된다.

**backend/Dockerfile.dev (개발)**:
```dockerfile
FROM eclipse-temurin:17-jdk            # JDK (빌드 도구 포함)
RUN apt install inotify-tools          # 파일 변경 감지 도구
COPY gradle 관련 파일                   # 의존성 캐싱
RUN ./gradlew dependencies             # 의존성 사전 다운로드
# 소스 코드는 바인드 마운트로 주입
```

| 비교 | 운영 Dockerfile | 개발 Dockerfile.dev |
|------|----------------|-------------------|
| 스테이지 | 멀티스테이지 (builder + runtime) | 싱글스테이지 |
| 베이스 이미지 | JRE (경량) | JDK (빌드 도구 필요) |
| 소스 포함 | JAR에 포함 | 바인드 마운트 |
| 실행 | java -jar | inotifywait + gradlew bootRun |
| 이미지 크기 | 작음 | 큼 (JDK + 빌드 도구 포함) |
| 사용자 | spring (비root) | root |

**frontend/Dockerfile (운영)**:
```dockerfile
# Stage 1: 빌드 (Node)
FROM node:22-alpine AS builder
RUN npm ci && npm run build            # dist/ 폴더 생성

# Stage 2: 서빙 (nginx)
FROM nginx:1.27-alpine
COPY --from=builder dist/ /usr/share/nginx/html/
ARG NGINX_CONF=nginx-local.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
```

> **멀티스테이지 빌드의 이점**:
> 빌드 도구(JDK, Node, npm)는 최종 이미지에 포함되지 않는다.
> 최종 이미지는 실행에 필요한 것만 포함하므로 크기가 작고, 보안 취약점도 줄어든다.

---

### .dockerignore — 빌드 컨텍스트 제외

```
backend/.dockerignore:     frontend/.dockerignore:
  .gradle/                   node_modules/
  build/                     dist/
  .idea/                     .vscode/
  *.iml                      *.md
  .vscode/                   Dockerfile*
  src/test/                  .dockerignore
  *.md                       .git/
  Dockerfile*                .gitignore
  .dockerignore
  .git/
  .gitignore
```

> Docker 빌드 시 `COPY . .`가 실행되면 현재 디렉토리의 모든 파일을 복사한다.
> `.dockerignore`에 명시된 파일은 복사에서 제외되어 빌드 속도가 빨라지고
> 불필요한 파일이 이미지에 포함되지 않는다.
>
> **주요 제외 항목**:
> - `src/test/` (backend): `bootJar -x test`로 테스트를 건너뛰므로 불필요
> - `Dockerfile*`: 빌드 컨텍스트에 Dockerfile 자체가 포함될 필요 없음
> - `*.md`: 런타임에 불필요한 문서 파일
> - `nginx-*.conf`는 제외하면 안 됨: frontend Dockerfile에서 `COPY ${NGINX_CONF}`로 사용

---

## 3.2 요청 처리 흐름

### 운영 모드: 브라우저 → 태스크 생성

```
① 브라우저: POST http://localhost/api/tasks

② nginx (frontend 컨테이너, :80)
   - location /api/ 매칭
   - proxy_pass http://backend:8080
   - 헤더 추가: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto

③ Docker 내부 DNS
   - "backend" → backend 컨테이너 IP 해석

④ Spring Boot (backend 컨테이너, :8080)
   - RequestLoggingFilter → Controller → Service → Repository → MySQL

⑤ MySQL (db 컨테이너, :3306)
   - INSERT INTO tasks (...) VALUES (...)
   - db-data 볼륨에 영속 저장

⑥ 응답: MySQL → Spring → nginx → 브라우저
   - HTTP 201 Created + JSON
```

### 컨테이너 시작 순서

```
docker compose up --build

① Docker: 이미지 빌드 (frontend, backend)
   ├── frontend/Dockerfile: npm ci → npm run build → nginx 이미지
   └── backend/Dockerfile: gradlew dependencies → bootJar → JRE 이미지

② db 컨테이너 시작
   - MySQL 초기화 (MYSQL_DATABASE, MYSQL_USER 환경변수 적용)
   - healthcheck 시작: mysqladmin ping 반복 실행

③ db healthcheck 통과 (약 10~15초)
   - "service_healthy" 조건 충족

④ backend 컨테이너 시작
   - Spring Boot 시작
   - Flyway: flyway_schema_history 확인 → 마이그레이션 실행/검증
   - Hibernate: Entity ↔ DB 스키마 validate
   - "Started BackendApplication" 로그

⑤ frontend 컨테이너 시작
   - nginx 시작
   - 포트 80 리스닝

⑥ 전체 시스템 준비 완료
```

> **depends_on이 없으면?**
> backend가 db보다 먼저 시작할 수 있다.
> DB 연결 실패 → Spring Boot 시작 실패 → 컨테이너 종료.
> `service_healthy` 조건은 단순 시작이 아닌 "실제 준비 완료"를 보장한다.

---

## 3.3 파일 관계도

### 운영 모드 파일 연결

```
docker-compose.yml
  │
  ├── frontend/Dockerfile
  │     ├── node:22-alpine (빌드)
  │     │     └── package.json → npm ci
  │     │     └── src/ → npm run build → dist/
  │     ├── nginx:1.27-alpine (실행)
  │     │     └── dist/ → /usr/share/nginx/html/
  │     │     └── nginx-local.conf → /etc/nginx/conf.d/default.conf
  │     └── 포트 80 노출
  │
  ├── backend/Dockerfile
  │     ├── eclipse-temurin:17-jdk (빌드)
  │     │     └── build.gradle → gradlew dependencies
  │     │     └── src/ → gradlew bootJar → app.jar
  │     ├── eclipse-temurin:17-jre (실행)
  │     │     └── app.jar → java -jar
  │     │     └── JAVA_OPTS: -Xms256m -Xmx512m
  │     └── 포트 8080 (내부)
  │
  ├── mysql:8.0 (이미지 직접 사용)
  │     └── db-data 볼륨 → /var/lib/mysql
  │
  └── 네트워크: default (자동 생성)
        └── frontend ↔ backend ↔ db (서비스명으로 통신)

scripts/ecr-push.sh (ECR 푸시 자동화)
  ├── aws ecr get-login-password → Docker 로그인
  ├── docker build ./backend → taskflow/backend:${GIT_HASH}
  ├── docker build --build-arg NGINX_CONF=nginx-aws.conf ./frontend
  │     └── nginx-aws.conf 사용 (정적 서빙만, 프록시 없음)
  └── docker push → ECR 리포지토리
```

> **ECR 푸시 스크립트가 frontend 빌드 시 `nginx-aws.conf`를 지정하는 이유**:
> AWS에서는 ALB가 API 라우팅을 담당하므로 nginx에 프록시 설정이 없어야 한다.
> 로컬 docker-compose에서는 기본값 `nginx-local.conf`가 사용된다.

### 개발 모드 파일 연결

```
docker-compose.dev.yml
  │
  ├── frontend/Dockerfile.dev
  │     ├── node:22-alpine
  │     │     └── npm ci (의존성 설치)
  │     │     └── npm run dev --host 0.0.0.0 (Vite 서버)
  │     ├── 바인드 마운트: ./frontend → /app
  │     └── 포트 5173 노출
  │
  ├── backend/Dockerfile.dev
  │     ├── eclipse-temurin:17-jdk
  │     │     └── inotify-tools 설치
  │     │     └── gradlew dependencies (캐싱)
  │     ├── 바인드 마운트: ./backend → /app
  │     ├── command: inotifywait 감시 + gradlew bootRun
  │     └── 포트 8080 노출
  │
  └── db: 운영 모드와 동일
```

---

## 3.4 핵심 개념

### Docker 네트워크와 서비스 간 통신

```
docker-compose가 자동 생성하는 네트워크:
  task-flow_default

서비스명 = DNS 이름:
  frontend → frontend 컨테이너 IP
  backend  → backend 컨테이너 IP
  db       → db 컨테이너 IP

nginx-local.conf에서:
  proxy_pass http://backend:8080;
  → Docker DNS가 "backend"를 해석 → 컨테이너 IP로 변환

application-dev.yml에서:
  DB_HOST: db
  → jdbc:mysql://db:3306/taskboard → Docker DNS가 "db" 해석
```

> IP 주소 대신 서비스명을 사용하므로, 컨테이너가 재시작되어 IP가 바뀌어도 동작한다.

### 볼륨과 데이터 영속성

```
docker compose down      → 컨테이너 삭제, 볼륨 유지    → 데이터 보존
docker compose down -v   → 컨테이너 삭제, 볼륨도 삭제  → 데이터 초기화

db-data 볼륨:
  MySQL 데이터 파일 (/var/lib/mysql)
  flyway_schema_history 테이블 포함
  → 볼륨 삭제 시 Flyway가 다시 "applied" (재적용)
  → 볼륨 유지 시 Flyway가 "validated" (검증만)
```

### 멀티스테이지 빌드의 레이어 캐싱

```
backend/Dockerfile:

COPY gradlew build.gradle settings.gradle ./     ← 캐시 레이어 1
COPY gradle ./gradle/
RUN ./gradlew dependencies                        ← 캐시 레이어 2 (의존성)
COPY src ./src                                    ← 캐시 레이어 3 (소스)
RUN ./gradlew bootJar                             ← 빌드 실행

의존성이 변경되지 않으면 (build.gradle 수정 없음):
  → 레이어 1, 2가 캐시에서 재사용됨
  → 소스 코드만 다시 복사 + 빌드
  → 빌드 시간이 크게 단축됨 (의존성 다운로드 생략)

의존성이 변경되면 (build.gradle 수정):
  → 레이어 2부터 다시 실행
  → 모든 의존성 재다운로드
```

> Docker는 `COPY`나 `RUN` 명령마다 레이어를 만든다.
> 파일이 변경되지 않은 레이어는 캐시에서 재사용된다.
> 자주 변경되는 파일(소스 코드)을 뒤에, 덜 변경되는 파일(의존성)을 앞에 배치하면
> 캐시 적중률이 높아져 빌드가 빨라진다.

### 운영 vs 개발 모드 비교 요약

```
운영 모드 (docker-compose.yml):
  ┌────────────┐     ┌────────────┐     ┌────────────┐
  │  nginx:80  │────→│ Spring:8080│────→│ MySQL:3306 │
  │ (정적+프록시) │     │  (JAR 실행) │     │ (db-data)  │
  └────────────┘     └────────────┘     └────────────┘
  외부 노출: 80만      내부만              내부만

개발 모드 (docker-compose.dev.yml):
  ┌────────────┐     ┌────────────┐     ┌────────────┐
  │ Vite:5173  │     │ Spring:8080│────→│ MySQL:3306 │
  │  (HMR)     │     │(inotifywait)│     │ (db-data)  │
  └────────────┘     └────────────┘     └────────────┘
  외부 노출: 5173     외부 노출: 8080     내부만
  바인드 마운트        바인드 마운트
```
