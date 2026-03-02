# 수동 테스트 가이드

> AWS 배포 전, 로컬 환경에서 직접 확인하는 체크리스트.
> 각 항목에 **왜 이런 결과가 나오는지** 설명을 포함합니다.

---

## 0) 사전 준비

```bash
# 운영 모드 실행
docker compose up --build -d

# 상태 확인 (3개 서비스 모두 Up이어야 함)
docker compose ps
```

| 서비스 | 포트 | 정상 상태 |
|--------|------|----------|
| frontend | 80 | Up |
| backend | 8080 (내부) | Up |
| db | 3306 (내부) | Up (healthy) |

> **왜 포트가 다른가?**
> frontend(nginx)만 호스트의 80번 포트에 바인딩됩니다.
> backend와 db는 Docker 내부 네트워크에서만 접근 가능하고, 호스트에 노출되지 않습니다.
> 브라우저는 `localhost:80`으로 접속하고, nginx가 `/api/*` 요청을 내부의 `backend:8080`으로 프록시합니다.

---

## 1) Docker / 인프라 테스트

### 1-1. 컨테이너 기동 순서

```bash
docker compose logs --tail=20 backend
```

- [ ] backend 로그에 `Started BackendApplication` 메시지가 보이는가?
- [ ] backend가 db보다 늦게 시작했는가?

> **왜?** docker-compose.yml에서 `depends_on: db: condition: service_healthy`로 설정되어 있습니다.
> MySQL의 healthcheck(`mysqladmin ping`)가 성공해야 backend가 시작됩니다.
> 이것이 없으면 backend가 DB 연결에 실패하여 즉시 종료됩니다.

### 1-2. Flyway 마이그레이션 확인

```bash
docker compose logs backend | grep -i flyway
```

**첫 실행 시 (DB 볼륨이 없을 때):**

- [ ] `Migrating schema ... to version "1 - init"` 메시지가 보이는가?
- [ ] `Migrating schema ... to version "2 - indexes"` 메시지가 보이는가?
- [ ] `Successfully applied 2 migrations` 메시지가 보이는가?

**재시작 시 (DB 볼륨이 이미 있을 때):**

- [ ] `Successfully validated 2 migrations` 메시지가 보이는가?
- [ ] `applied` 대신 `validated`로 표시되는가?

> **왜 재시작하면 "applied"가 아닌 "validated"인가?**
> Flyway는 `flyway_schema_history` 테이블에 적용 이력을 기록합니다.
> 재시작 시 이 테이블을 확인하여 이미 적용된 마이그레이션은 건너뛰고, 파일의 체크섬(checksum)만 검증합니다.
> 따라서 **최초 실행**에서만 `applied`가 나오고, 이후에는 `validated`만 나옵니다.
>
> 만약 `applied` 메시지를 직접 보고 싶다면 DB 볼륨을 삭제 후 재시작하면 됩니다:
> ```bash
> docker compose down -v   # 볼륨 삭제
> docker compose up --build -d
> docker compose logs backend | grep -i flyway
> ```
>
> `ddl-auto: validate`이므로 Hibernate는 스키마를 변경하지 않고, Flyway가 만든 스키마와 엔티티가 일치하는지 검증만 합니다.

### 1-3. nginx 프록시 동작

```bash
# 정적 파일 (React)
curl -s -o /dev/null -w "%{http_code}" http://localhost/

# API 프록시
curl -s -o /dev/null -w "%{http_code}" http://localhost/api/tasks

# Actuator 프록시
curl -s -o /dev/null -w "%{http_code}" http://localhost/actuator/health
```

- [ ] `/` → 200 (React index.html)
- [ ] `/api/tasks` → 200 (JSON 응답)
- [ ] `/actuator/health` → 200 (`{"status":"UP"}`)

> **왜 모두 80번 포트인가?**
> nginx가 경로에 따라 요청을 분배합니다:
> - `/` → 로컬 파일시스템의 React 빌드 결과 (`/usr/share/nginx/html`)
> - `/api/*` → `proxy_pass http://backend:8080` (Docker 내부 DNS)
> - `/actuator/*` → `proxy_pass http://backend:8080`
>
> 이 구조 덕분에 브라우저는 단일 origin(`localhost:80`)만 사용하여 **CORS 문제가 발생하지 않습니다.**

### 1-4. SPA fallback 확인

```bash
# 존재하지 않는 경로 요청
curl -s -o /dev/null -w "%{http_code}" http://localhost/tasks
curl -s -o /dev/null -w "%{http_code}" http://localhost/some/random/path
```

- [ ] `/tasks` → 200 (index.html 반환)
- [ ] `/some/random/path` → 200 (index.html 반환)

> **왜 404가 아니라 200인가?**
> nginx의 `try_files $uri $uri/ /index.html` 설정 때문입니다.
> 파일이 없으면 index.html을 반환하고, React Router가 클라이언트에서 라우팅을 처리합니다.
> SPA(Single Page Application)의 핵심 패턴입니다. 이것이 없으면 브라우저에서 직접 URL을 입력하거나 새로고침할 때 404가 발생합니다.

### 1-5. 컨테이너 재시작 내구성

```bash
# backend만 재시작
docker compose restart backend

# 잠시 후 확인
curl -s http://localhost/actuator/health
```

- [ ] 재시작 후 `{"status":"UP"}` 응답이 오는가?
- [ ] Flyway가 이미 적용된 마이그레이션을 건너뛰는가? (`docker compose logs backend | grep flyway`)

> **왜?** Flyway는 `flyway_schema_history` 테이블을 확인하여 이미 적용된 버전은 건너뜁니다.
> DB 볼륨(`db-data`)이 유지되므로 데이터도 보존됩니다.

### 1-6. DB 볼륨 영속성

```bash
# 태스크 1개 생성
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"볼륨 테스트"}'

# 전체 종료 후 재시작 (볼륨 유지)
docker compose down
docker compose up -d

# 데이터 확인
curl -s http://localhost/api/tasks | python3 -m json.tool
```

- [ ] 재시작 후에도 "볼륨 테스트" 태스크가 존재하는가?

> **왜?** `docker compose down`은 컨테이너만 삭제하고 볼륨(`db-data`)은 유지합니다.
> `docker compose down -v`를 하면 볼륨도 삭제되어 데이터가 초기화됩니다.

---

## 2) 백엔드 API 테스트

### 2-1. Task 생성 (POST)

#### 최소 필드로 생성

```bash
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"첫 번째 태스크"}' | python3 -m json.tool
```

- [ ] HTTP 201 Created
- [ ] `status`가 `"TODO"`인가?
- [ ] `priority`가 `"MEDIUM"`인가?
- [ ] `description`, `dueDate`가 `null`인가?
- [ ] `createdAt`과 `updatedAt`이 같은 시각인가?

> **왜 status=TODO, priority=MEDIUM인가?**
> `TaskCreateRequest`에서 status와 priority는 선택 필드입니다.
> 값이 없으면 `TaskService.createTask()`에서 기본값을 할당합니다:
> `task.setStatus(request.status() != null ? request.status() : TaskStatus.TODO)`

#### 모든 필드로 생성

```bash
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "전체 필드 태스크",
    "description": "설명입니다",
    "status": "DOING",
    "priority": "HIGH",
    "dueDate": "2026-12-31"
  }' | python3 -m json.tool
```

- [ ] 모든 필드가 요청한 값 그대로 반환되는가?

#### 테스트 데이터 대량 생성 (이후 테스트용)

```bash
# 다양한 상태/우선순위로 12개 생성
for i in $(seq 1 4); do
  curl -s -X POST http://localhost/api/tasks \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"TODO 태스크 $i\",\"status\":\"TODO\",\"priority\":\"LOW\"}" > /dev/null
done

for i in $(seq 1 4); do
  curl -s -X POST http://localhost/api/tasks \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"DOING 태스크 $i\",\"status\":\"DOING\",\"priority\":\"MEDIUM\"}" > /dev/null
done

for i in $(seq 1 4); do
  curl -s -X POST http://localhost/api/tasks \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"DONE 태스크 $i\",\"status\":\"DONE\",\"priority\":\"HIGH\"}" > /dev/null
done

echo "생성 완료. 총 건수:"
curl -s http://localhost/api/tasks | python3 -c "import sys,json; print(json.load(sys.stdin)['totalElements'])"
```

### 2-2. Task 생성 — Validation 실패

#### 제목 없음

```bash
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool
```

- [ ] HTTP 400
- [ ] `code`가 `"VALIDATION_FAILED"`인가?
- [ ] `fieldErrors`에 `{"field":"title", "message":"Title is required"}`가 포함되는가?

> **왜?** `TaskCreateRequest`의 `title` 필드에 `@NotBlank` 어노테이션이 있습니다.
> Spring의 `@Valid`가 요청 본문을 검증하고, 실패하면 `MethodArgumentNotValidException`이 발생합니다.
> `GlobalExceptionHandler`가 이를 잡아 `ErrorResponse` 형태로 변환합니다.

#### 제목이 공백만

```bash
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"   "}' | python3 -m json.tool
```

- [ ] HTTP 400, `code: "VALIDATION_FAILED"`

> **왜?** `@NotBlank`는 `@NotNull` + `@NotEmpty`보다 엄격합니다.
> null, 빈 문자열(""), 공백만 있는 문자열("   ") 모두 거부합니다.
> `@NotNull`만 쓰면 빈 문자열이 통과하고, `@NotEmpty`만 쓰면 공백 문자열이 통과합니다.

#### 제목 255자 초과

```bash
LONG_TITLE=$(python3 -c "print('가' * 256)")
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$LONG_TITLE\"}" | python3 -m json.tool
```

- [ ] HTTP 400
- [ ] `fieldErrors`에 `"Title must be 255 characters or less"` 메시지가 포함되는가?

> **왜?** `@Size(max = 255)` 어노테이션이 제한합니다.
> DB 컬럼도 `VARCHAR(255)`이므로, 어노테이션 없이 저장하면 DB 레벨에서 에러가 발생합니다.
> 애플리케이션 레벨에서 먼저 검증하여 더 명확한 에러 메시지를 반환하는 것이 좋은 관행입니다.

#### 잘못된 Enum 값

```bash
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"테스트","status":"INVALID"}' | python3 -m json.tool
```

- [ ] HTTP 400
- [ ] `code`가 `"INVALID_REQUEST_BODY"`인가?

> **왜?** Jackson이 JSON을 Java 객체로 변환할 때 `"INVALID"`를 `TaskStatus` enum으로 변환할 수 없습니다.
> `HttpMessageNotReadableException`이 발생하고, `GlobalExceptionHandler`가 이를 `INVALID_REQUEST_BODY`로 처리합니다.
> `VALIDATION_FAILED`와 다른 이유: Validation은 객체 변환 성공 후 필드값을 검증하는 것이고, 이 경우는 변환 자체가 실패한 것입니다.

#### 잘못된 JSON

```bash
curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{invalid json}' | python3 -m json.tool
```

- [ ] HTTP 400, `code: "INVALID_REQUEST_BODY"`

> **왜?** JSON 파싱 자체가 실패하여 `HttpMessageNotReadableException`이 발생합니다.
> 위의 잘못된 Enum 값과 동일한 예외 타입이지만, 원인은 다릅니다 (구문 오류 vs 타입 변환 오류).

### 2-3. Task 수정 (PUT)

#### 정상 수정

```bash
# 먼저 존재하는 ID 확인
TASK_ID=$(curl -s http://localhost/api/tasks | python3 -c "import sys,json; print(json.load(sys.stdin)['content'][0]['id'])")

curl -s -X PUT "http://localhost/api/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "수정된 제목",
    "description": "수정된 설명",
    "status": "DOING",
    "priority": "HIGH",
    "dueDate": "2026-06-15"
  }' | python3 -m json.tool
```

- [ ] HTTP 200
- [ ] `updatedAt`이 `createdAt`보다 이후 시각인가?

> **왜 updatedAt이 변경되는가?**
> `@LastModifiedDate` 어노테이션(JPA Auditing)이 엔티티가 수정될 때마다 자동으로 현재 시각을 기록합니다.
> `@EnableJpaAuditing`이 `JpaConfig`에 분리되어 있어 이 기능이 활성화됩니다.

#### 필수 필드 누락 (status 없음)

```bash
curl -s -X PUT "http://localhost/api/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d '{"title":"제목만","priority":"HIGH"}' | python3 -m json.tool
```

- [ ] HTTP 400
- [ ] `fieldErrors`에 `"Status is required"` 메시지가 있는가?

> **왜?** `TaskUpdateRequest`의 `status`에는 `@NotNull`이 있습니다.
> PUT은 전체 교체(Full Replace) 방식이므로 모든 필수 필드를 보내야 합니다.
> PATCH였다면 보낸 필드만 수정하겠지만, 이 프로젝트는 모달에서 전체 필드를 저장하는 구조이므로 PUT을 선택했습니다.

#### 존재하지 않는 ID

```bash
curl -s -X PUT http://localhost/api/tasks/99999 \
  -H "Content-Type: application/json" \
  -d '{"title":"없는ID","status":"TODO","priority":"LOW"}' | python3 -m json.tool
```

- [ ] HTTP 404
- [ ] `code`가 `"NOT_FOUND"`인가?
- [ ] `message`에 `"Task not found: id=99999"`가 포함되는가?

> **왜?** `TaskService.updateTask()`에서 `taskRepository.findById(id)`가 빈 결과를 반환하면
> `TaskNotFoundException`을 던지고, `GlobalExceptionHandler`가 이를 404로 매핑합니다.

#### 경로 파라미터 타입 불일치

```bash
curl -s -X PUT http://localhost/api/tasks/abc \
  -H "Content-Type: application/json" \
  -d '{"title":"타입에러","status":"TODO","priority":"LOW"}' | python3 -m json.tool
```

- [ ] HTTP 400
- [ ] `code`가 `"TYPE_MISMATCH"`인가?

> **왜?** Spring MVC가 경로 변수 `{id}`를 Long 타입으로 변환하려고 할 때 `"abc"`는 숫자가 아니므로
> `MethodArgumentTypeMismatchException`이 발생합니다.
> 이것은 요청 본문 검증(`VALIDATION_FAILED`)과 다른 단계에서 발생하는 에러입니다.

#### description을 null로 변경

```bash
curl -s -X PUT "http://localhost/api/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d '{"title":"설명 제거","status":"DOING","priority":"HIGH","description":null}' | python3 -m json.tool
```

- [ ] HTTP 200
- [ ] `description`이 `null`인가?

> **왜 null이 허용되는가?** description 필드에는 Validation 어노테이션이 없습니다.
> PUT 전체 교체 방식이므로 null을 보내면 기존 값이 null로 덮어씌워집니다.
> "필드를 삭제한다"는 의미로 null을 사용할 수 있는 설계입니다.

### 2-4. Task 삭제 (DELETE)

#### 정상 삭제

```bash
# 삭제할 태스크 생성
NEW_ID=$(curl -s -X POST http://localhost/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"삭제할 태스크"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# 삭제
curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost/api/tasks/$NEW_ID"
```

- [ ] HTTP 204 (No Content, 응답 본문 없음)

> **왜 204인가?**
> HTTP 204는 "요청은 성공했지만 응답 본문이 없다"는 의미입니다.
> 삭제된 리소스를 다시 반환할 필요가 없으므로 204가 적절합니다.
> 200 + 삭제된 객체 반환도 가능하지만, 204가 REST 관례상 더 일반적입니다.

#### 동일 ID 재삭제

```bash
curl -s -X DELETE "http://localhost/api/tasks/$NEW_ID" | python3 -m json.tool
```

- [ ] HTTP 404, `code: "NOT_FOUND"`

> **왜?** Hard delete이므로 DB에서 완전히 삭제됩니다.
> 두 번째 삭제 요청 시 `findById()`가 빈 결과를 반환하여 `TaskNotFoundException`이 발생합니다.
> Soft delete 방식이었다면 `deleted=true` 플래그만 설정하고 실제 행은 남겨둘 텐데,
> 이 프로젝트는 학습 목적이므로 단순한 Hard delete를 선택했습니다.

### 2-5. 목록 조회 — 페이징

```bash
# 기본 조회 (page=0, size=10)
curl -s "http://localhost/api/tasks" | python3 -m json.tool
```

- [ ] `page`가 `0`인가?
- [ ] `size`가 `10`인가?
- [ ] `content` 배열 길이가 `size` 이하인가?
- [ ] `totalElements`가 전체 태스크 수와 일치하는가?
- [ ] `totalPages`가 `ceil(totalElements / size)`인가?

> **왜 page가 0부터 시작하는가?**
> Spring Data JPA의 `Pageable`은 0-based 페이지 번호를 사용합니다.
> 프론트엔드 UI에서는 1-based로 표시하지만, API 호출 시에는 0-based로 변환합니다.

```bash
# 2페이지, 5개씩
curl -s "http://localhost/api/tasks?page=1&size=5" | python3 -m json.tool
```

- [ ] `page`가 `1`인가?
- [ ] `content` 배열 길이가 5 이하인가?
- [ ] 1페이지(page=0)에 없던 태스크들이 표시되는가?

### 2-6. 목록 조회 — 필터

```bash
# 상태 필터
curl -s "http://localhost/api/tasks?status=TODO" | python3 -m json.tool
```

- [ ] `content`의 모든 항목이 `status: "TODO"`인가?
- [ ] `totalElements`가 TODO 상태 태스크 수와 일치하는가?

```bash
# 우선순위 필터
curl -s "http://localhost/api/tasks?priority=HIGH" | python3 -m json.tool
```

- [ ] `content`의 모든 항목이 `priority: "HIGH"`인가?

```bash
# 복합 필터
curl -s "http://localhost/api/tasks?status=DOING&priority=MEDIUM" | python3 -m json.tool
```

- [ ] 모든 항목이 `status: "DOING"` AND `priority: "MEDIUM"`인가?

> **왜 AND 조건인가?**
> `TaskRepository`의 `@Query`에서 `(:status IS NULL OR t.status = :status) AND (:priority IS NULL OR t.priority = :priority)` 형태로 작성되어 있습니다.
> 파라미터가 null이면 해당 조건은 무시(전체)되고, 값이 있으면 AND로 결합됩니다.

### 2-7. 목록 조회 — 검색

```bash
# 제목/설명 검색
curl -s "http://localhost/api/tasks?q=TODO" | python3 -m json.tool
```

- [ ] `content`의 항목들이 title 또는 description에 "TODO"를 포함하는가?

```bash
# 빈 검색어 (무시됨)
curl -s "http://localhost/api/tasks?q=" | python3 -m json.tool
```

- [ ] 전체 목록이 반환되는가? (필터 없음과 동일)

> **왜 빈 검색어가 무시되는가?**
> Repository 쿼리에서 `(:keyword IS NULL OR :keyword = '' OR ...)` 조건을 사용합니다.
> 빈 문자열이면 검색 조건이 적용되지 않아 전체 결과가 반환됩니다.

### 2-8. 목록 조회 — 정렬

```bash
# 제목 오름차순
curl -s "http://localhost/api/tasks?sort=title,asc" | python3 -m json.tool
```

- [ ] `content`가 title 기준 알파벳/가나다 오름차순으로 정렬되었는가?

```bash
# 허용되지 않는 정렬 필드
curl -s "http://localhost/api/tasks?sort=hackerField,asc" | python3 -m json.tool
```

- [ ] 에러 없이 200 응답이 오는가?
- [ ] 기본 정렬(createdAt,desc)이 적용되었는가?

> **왜 에러 대신 기본값으로 처리하는가?**
> `TaskService`에서 정렬 필드 화이트리스트(`createdAt`, `updatedAt`, `dueDate`, `title`, `priority`, `status`)를 유지합니다.
> 허용되지 않는 필드가 들어오면 기본값(`createdAt,desc`)으로 대체합니다.
> 이는 보안 조치입니다 — 임의 필드로 정렬을 허용하면 SQL injection 위험이나 성능 문제가 발생할 수 있습니다.

### 2-9. Actuator 헬스체크

```bash
curl -s http://localhost/actuator/health | python3 -m json.tool
```

- [ ] `{"status":"UP"}` 응답인가?

> **왜 DB 정보가 안 보이는가?**
> `management.endpoints.web.exposure.include=health`로 health 엔드포인트만 노출합니다.
> 기본적으로 health 엔드포인트는 상세 정보(DB 상태 등)를 숨기고 단순 UP/DOWN만 반환합니다.
> `management.endpoint.health.show-details=always`를 설정하면 DB 연결 상태 등 상세 정보를 볼 수 있지만,
> 보안상 운영 환경에서는 숨기는 것이 일반적입니다.

### 2-10. 요청 로깅 확인

```bash
# API 요청 보내기
curl -s http://localhost/api/tasks > /dev/null

# 로그 확인
docker compose logs --tail=5 backend
```

- [ ] `[HTTP] GET /api/tasks 200 XXms` 형태의 로그가 보이는가?

```bash
# Actuator 요청
curl -s http://localhost/actuator/health > /dev/null

# 로그 확인
docker compose logs --tail=5 backend
```

- [ ] Actuator 요청은 로그에 **기록되지 않는가?**

> **왜 Actuator는 로깅에서 제외하는가?**
> `RequestLoggingFilter`에서 `/actuator/**` 경로를 제외합니다.
> ALB 헬스체크가 30초마다 `/actuator/health`를 호출하므로, 로깅하면 로그가 스팸으로 가득 찹니다.
> 비즈니스 로직과 무관한 운영 트래픽이므로 제외하는 것이 실무 관행입니다.

### 2-11. 존재하지 않는 API 경로

```bash
curl -s http://localhost/api/nonexistent | python3 -m json.tool
```

- [ ] HTTP 404 응답이 오는가?

> **왜?** Spring Boot의 `NoResourceFoundException`이 발생합니다.
> `GlobalExceptionHandler`에서 이를 처리하여 표준 `ErrorResponse` 형태로 반환합니다.

---

## 3) 프론트엔드 UI 테스트

> 브라우저에서 `http://localhost/` 접속

### 3-1. 초기 로딩

- [ ] 페이지가 정상적으로 로딩되는가?
- [ ] URL이 `/tasks`로 리다이렉트되는가?
- [ ] 기존 태스크 목록이 표시되는가?
- [ ] 전체 건수가 표시되는가?

> **왜 /tasks로 리다이렉트되는가?**
> React Router 설정에서 `/` → `/tasks` 리다이렉트가 설정되어 있습니다.
> SPA이므로 이 라우팅은 서버가 아닌 클라이언트(브라우저)에서 처리됩니다.

### 3-2. 태스크 생성

1. "새 태스크" 버튼 클릭
2. 모달이 열리는지 확인

- [ ] 제목 입력 없이 "저장" → 클라이언트 검증 에러가 표시되는가?
- [ ] 제목만 입력 후 "저장" → 태스크가 생성되는가?
- [ ] 생성된 태스크의 상태가 `TODO`, 우선순위가 `MEDIUM`인가?
- [ ] 모달이 닫히고 목록이 갱신되는가?

> **왜 모달 방식인가?**
> 별도 페이지로 이동하면 목록 컨텍스트를 잃습니다.
> 모달은 현재 목록을 유지한 채 생성/수정이 가능하여 UX가 좋습니다.
> Headless UI의 `Dialog` 컴포넌트를 사용하여 접근성(a11y)도 보장합니다
> (Esc 키로 닫기, 포커스 트랩, 배경 클릭으로 닫기 등).

### 3-3. 태스크 수정

1. 태스크 카드 클릭
2. 수정 모달이 열리는지 확인

- [ ] 기존 값이 폼에 채워져 있는가?
- [ ] 상태를 변경 후 "저장" → 카드의 상태 배지가 변경되는가?
- [ ] 설명을 지우고 저장 → 설명이 사라지는가?

### 3-4. 태스크 삭제

1. 태스크 카드의 삭제 버튼(휴지통 아이콘) 클릭

- [ ] 확인 대화상자("정말 삭제하시겠습니까?")가 나타나는가?
- [ ] "취소" → 삭제되지 않는가?
- [ ] "확인" → 태스크가 사라지고 목록이 갱신되는가?
- [ ] 삭제 버튼 클릭 시 카드의 수정 모달이 열리지 않는가?

> **왜 수정 모달이 안 열리는가?**
> 삭제 버튼에 `e.stopPropagation()`이 적용되어 있습니다.
> 카드 전체에 클릭 이벤트(수정 모달 열기)가 있고, 삭제 버튼은 그 안에 있으므로
> 이벤트 버블링을 막지 않으면 삭제와 동시에 수정 모달도 열립니다.

### 3-5. 검색

1. 검색 입력란에 키워드 입력

- [ ] 입력 후 약 300ms 후에 목록이 갱신되는가?
- [ ] 빠르게 연속 입력해도 마지막 입력만 검색되는가?
- [ ] 검색어를 지우면 전체 목록이 다시 표시되는가?
- [ ] 검색 결과의 전체 건수가 변경되는가?

> **왜 300ms 지연이 있는가?**
> debounce 패턴입니다. 사용자가 타이핑할 때마다 API를 호출하면
> 불필요한 요청이 많아집니다 (예: "태스크" 입력 시 "태", "태스", "태스크" 3번 호출).
> 300ms 동안 추가 입력이 없을 때만 API를 호출하여 서버 부하를 줄입니다.

### 3-6. 필터

- [ ] 상태 드롭다운에서 "TODO" 선택 → TODO 태스크만 표시되는가?
- [ ] 우선순위 드롭다운에서 "HIGH" 선택 → HIGH 태스크만 표시되는가?
- [ ] 두 필터를 동시에 적용 → AND 조건으로 필터되는가?
- [ ] "전체 상태"/"전체 우선순위" 선택 → 필터가 해제되는가?
- [ ] 필터 변경 시 페이지가 1페이지로 초기화되는가?

> **왜 필터 변경 시 1페이지로 가는가?**
> 필터를 변경하면 전체 결과 수가 바뀝니다.
> 예를 들어 3페이지를 보다가 필터를 적용했는데 결과가 5개뿐이면 3페이지는 빈 결과입니다.
> `useTasks` 훅에서 필터 변경 시 `page`를 0으로 초기화하여 이 문제를 방지합니다.

### 3-7. 정렬

- [ ] 정렬 드롭다운에서 옵션을 변경하면 목록 순서가 바뀌는가?
- [ ] "제목 (가나다순)" 선택 → 알파벳/가나다 오름차순인가?
- [ ] 기본 정렬이 "최신순"(createdAt,desc)인가?

### 3-8. 페이지네이션

> 태스크가 11개 이상 있어야 테스트 가능 (기본 size=10)

- [ ] 총 페이지 수가 정확한가?
- [ ] 페이지 번호 클릭 시 해당 페이지로 이동하는가?
- [ ] "이전" 버튼: 1페이지에서는 비활성, 2페이지에서는 활성인가?
- [ ] "다음" 버튼: 마지막 페이지에서는 비활성인가?
- [ ] 데이터가 10개 이하일 때 페이지네이션이 숨겨지는가?

> **왜 UI는 1부터, API는 0부터인가?**
> 사용자에게 "0페이지"는 직관적이지 않으므로 UI에서는 1-based로 표시합니다.
> Spring Data JPA는 0-based 페이지를 사용하므로, 프론트엔드에서 `page - 1`로 변환하여 API를 호출합니다.

### 3-9. 카드 시각 요소

- [ ] 상태 배지 색상이 TODO/DOING/DONE별로 다른가?
- [ ] 우선순위 배지 색상이 LOW/MEDIUM/HIGH별로 다른가?
- [ ] 카드 왼쪽 테두리 색상이 우선순위에 따라 다른가?
- [ ] 마감일이 지난 태스크의 날짜가 빨간색인가?
- [ ] 마감일이 오늘인 태스크의 날짜가 주황색인가?
- [ ] 긴 제목이 한 줄에서 말줄임(...)으로 처리되는가?
- [ ] 긴 설명이 두 줄에서 말줄임으로 처리되는가?

### 3-10. 새로고침 내구성

- [ ] 목록 페이지(`/tasks`)에서 브라우저 새로고침(F5) → 정상 로딩되는가?
- [ ] 직접 URL 입력(`http://localhost/tasks`) → 정상 로딩되는가?

> **왜 새로고침이 작동하는가?**
> nginx의 SPA fallback(`try_files $uri $uri/ /index.html`) 덕분입니다.
> `/tasks`라는 실제 파일은 없지만 index.html을 반환하고,
> React Router가 브라우저에서 `/tasks` 경로를 해석하여 올바른 컴포넌트를 렌더링합니다.

### 3-11. 브라우저 개발자 도구 확인

> F12 → Network 탭 열고 UI 조작

- [ ] API 호출이 `/api/tasks`로 가는가? (절대 URL이 아닌 상대 경로)
- [ ] 필터/검색/정렬 변경 시 query parameter가 올바르게 추가되는가?
- [ ] 응답 Content-Type이 `application/json`인가?
- [ ] 에러 발생 시 Console 탭에 에러 메시지가 표시되는가?

> **왜 상대 경로가 중요한가?**
> 프론트엔드 코드가 `/api/tasks`로 호출하면:
> - 로컬: `http://localhost/api/tasks` → nginx가 backend로 프록시
> - AWS: `http://ALB_DNS/api/tasks` → ALB가 Backend TG로 라우팅
>
> 환경에 따라 코드를 변경할 필요가 없습니다.
> 만약 `http://localhost:8080/api/tasks`로 하드코딩했다면 AWS에서는 동작하지 않습니다.

---

## 4) 개발 모드 테스트

```bash
# 운영 모드 종료
docker compose down

# 개발 모드 시작
docker compose -f docker-compose.dev.yml up --build
```

### 4-1. Vite 개발 서버

- [ ] `http://localhost:5173/` 접속 시 React UI가 표시되는가?

> **왜 포트가 5173인가?**
> 개발 모드에서는 nginx 대신 Vite dev server가 직접 서빙합니다.
> Vite의 기본 포트가 5173이고, HMR(Hot Module Replacement)을 지원합니다.

### 4-2. 프론트엔드 핫 리로드

1. `frontend/src/` 아래의 아무 컴포넌트 파일 수정 (예: 제목 텍스트 변경)

- [ ] 브라우저가 자동으로 갱신되는가? (새로고침 없이)
- [ ] 변경이 즉시(1초 이내) 반영되는가?

> **왜 즉시 반영되는가?**
> Vite HMR(Hot Module Replacement)은 변경된 모듈만 교체합니다.
> 전체 페이지 새로고침 없이 컴포넌트만 교체하므로 상태도 유지됩니다.
> `docker-compose.dev.yml`에서 `volumes: [./frontend:/app]`으로 소스를 바인드 마운트하여
> 호스트의 파일 변경이 컨테이너 안에 즉시 반영됩니다.

### 4-3. 백엔드 핫 리로드

1. `backend/src/main/java/` 아래의 아무 Java 파일 수정 (예: 로그 메시지 변경)

- [ ] backend 컨테이너 로그에 재시작 메시지가 보이는가?
- [ ] 약 10초 후 변경사항이 반영되는가?

> **왜 10초나 걸리는가?**
> `inotifywait`가 `.java` 파일 변경을 감지하면 `./gradlew bootRun`을 재시작합니다.
> Java는 컴파일 언어이므로 소스 변경 → Gradle 컴파일 → Spring Boot 시작까지 시간이 필요합니다.
> Vite(인터프리터 기반)처럼 즉시 반영은 불가능합니다.

### 4-4. 개발 모드 API 접근

```bash
# 백엔드 직접 접근 (nginx 우회)
curl -s http://localhost:8080/api/tasks | python3 -m json.tool
curl -s http://localhost:8080/actuator/health
```

- [ ] 백엔드에 직접 접근 가능한가?

> **왜 개발 모드에서는 8080 포트가 노출되는가?**
> `docker-compose.dev.yml`에서 `ports: ["8080:8080"]`으로 호스트에 바인딩합니다.
> 운영 모드에서는 nginx만 80번 포트로 노출하고 backend는 내부에 숨깁니다.
> 개발 시에는 API를 직접 호출하여 디버깅할 수 있어야 하므로 노출합니다.

---

## 5) 정리

```bash
# 개발 모드 종료
docker compose -f docker-compose.dev.yml down

# 또는 운영 모드 종료
docker compose down

# 데이터까지 초기화
docker compose down -v
```

---

## 부록: 에러 코드 요약

| HTTP | code | 발생 상황 | 예시 |
|------|------|----------|------|
| 400 | `VALIDATION_FAILED` | 필드값 검증 실패 | title 공백, status 누락 |
| 400 | `INVALID_REQUEST_BODY` | JSON 파싱/변환 실패 | 잘못된 JSON, 잘못된 enum |
| 400 | `TYPE_MISMATCH` | 파라미터 타입 변환 실패 | `/api/tasks/abc` |
| 404 | `NOT_FOUND` | 리소스 없음 | 존재하지 않는 ID |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 | 예상치 못한 예외 |
