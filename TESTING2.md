# 운영 항목 수동 테스트 가이드

> AWS 배포 대비 운영 항목 5종(Graceful Shutdown, JSON 로그, ECR 스크립트, Health Check 상세화, .dockerignore)의 로컬 검증 체크리스트.
> 각 항목에 **왜 이런 결과가 나오는지** 설명을 포함합니다.

---

## 테스트 가능 여부 요약

| 항목 | docker-compose.yml | 특별 조건 |
|------|:--:|---|
| 1. Health Check 상세화 | 완전 테스트 | 없음 (dev 프로필 자동 적용) |
| 2. Graceful Shutdown | 완전 테스트 | 없음 |
| 3. .dockerignore 최적화 | 완전 테스트 | 없음 (빌드 시 자동 적용) |
| 4. 구조화된 JSON 로그 | 부분 테스트 | 환경변수 임시 변경 필요 (prod 프로필) |
| 5. ECR 푸시 스크립트 | 문법만 검증 | 실제 푸시는 AWS 계정 필수 |

---

## 0) 사전 준비

```bash
# 깨끗한 상태에서 시작 (기존 컨테이너 + 볼륨 삭제)
docker compose down -v

# 운영 모드 빌드 + 실행
docker compose up --build -d

# 상태 확인 (3개 서비스 모두 Up이어야 함)
docker compose ps
```

> **왜 `--build`가 필요한가?**
> .dockerignore, Dockerfile ENTRYPOINT 변경이 이미지에 반영되려면 재빌드가 필요합니다.
> `-v`로 볼륨을 삭제하면 Flyway 마이그레이션이 처음부터 실행되어 깨끗한 상태가 됩니다.

---

## 1) Health Check 상세화

### 1-1. dev 프로필에서 상세 정보 확인

```bash
curl -s http://localhost/actuator/health | python3 -m json.tool
```

**기대 결과:**

```json
{
    "status": "UP",
    "components": {
        "db": {
            "status": "UP",
            "details": {
                "database": "MySQL",
                "validationQuery": "isValid()"
            }
        },
        "diskSpace": {
            "status": "UP",
            "details": { ... }
        },
        "ping": {
            "status": "UP"
        }
    }
}
```

- [ ] `status`가 `"UP"`인가?
- [ ] `components.db`가 존재하는가?
- [ ] `components.db.status`가 `"UP"`인가?
- [ ] `components.db.details.database`가 `"MySQL"`인가?

> **왜 DB 정보가 보이는가?**
> `application-dev.yml`에 `management.endpoint.health.show-details: always`가 설정되어 있습니다.
> docker-compose.yml에서 `SPRING_PROFILES_ACTIVE=dev`이므로 이 설정이 적용됩니다.
> Spring Boot Actuator는 DataSource Bean이 있으면 자동으로 DB health indicator를 등록합니다.
>
> **참고**: `management.endpoints`(복수, 노출 범위)와 `management.endpoint`(단수, 개별 설정)는 다른 설정입니다.
> - `management.endpoints.web.exposure.include=health` → 어떤 엔드포인트를 노출할지
> - `management.endpoint.health.show-details=always` → health 엔드포인트의 상세 수준

### 1-2. DB 다운 시 503 반환 확인

```bash
# DB 컨테이너만 중지
docker compose stop db

# 잠시 대기 (커넥션 풀 타임아웃)
sleep 5

# 헬스체크 확인
curl -s -o /dev/null -w "%{http_code}" http://localhost/actuator/health
```

- [ ] HTTP 상태 코드가 `503`인가?

```bash
curl -s http://localhost/actuator/health | python3 -m json.tool
```

- [ ] `status`가 `"DOWN"`인가?
- [ ] `components.db.status`가 `"DOWN"`인가?

> **왜 503인가?**
> Spring Actuator는 `status=DOWN`이면 HTTP 503(Service Unavailable)을 반환합니다.
> AWS에서는 ALB가 이 503 응답을 감지하여 해당 Task를 unhealthy로 판단합니다.
> 이렇게 하면 DB 장애 시 자동으로 트래픽이 차단되어 사용자에게 에러가 전파되지 않습니다.
>
> **prod에서도 동일한가?**
> 네. prod에서는 `show-details: never`(기본값)이므로 `{"status":"DOWN"}`만 반환하지만,
> HTTP 상태 코드는 동일하게 503입니다. ALB 헬스체크는 상태 코드만 보므로 문제없습니다.

```bash
# DB 다시 시작
docker compose start db

# 복구 확인 (10-20초 소요)
sleep 15
curl -s -o /dev/null -w "%{http_code}" http://localhost/actuator/health
```

- [ ] 다시 `200`으로 복구되는가?

---

## 2) Graceful Shutdown

### 2-1. 종료 로그 확인

```bash
# backend에 요청을 보낸 직후 종료 시작
curl -s http://localhost/api/tasks > /dev/null

# backend만 종료
docker compose stop backend
```

- [ ] 종료가 즉시가 아닌 수 초 후에 완료되는가?

```bash
# 종료 로그 확인
docker compose logs --tail=30 backend | grep -i -E "graceful|shutting|shutdown"
```

- [ ] `Commencing graceful shutdown` 메시지가 보이는가?
- [ ] `Graceful shutdown complete` 메시지가 보이는가?

> **왜 이 메시지가 나오는가?**
> `application.yml`에 `server.shutdown: graceful` 설정이 있습니다.
> Spring Boot는 SIGTERM을 받으면:
> 1. 새로운 요청 수락을 중지
> 2. 진행 중인 요청이 완료될 때까지 대기 (최대 30초)
> 3. 모든 요청이 완료되면 종료
>
> `Commencing graceful shutdown` → 단계 1 시작
> `Graceful shutdown complete` → 단계 3 완료

### 2-2. exec 확인 (PID 1 = java)

```bash
# backend 다시 시작
docker compose start backend
sleep 10

# 컨테이너 내부의 PID 1 프로세스 확인
docker compose exec backend ps -p 1 -o comm=
```

- [ ] 출력이 `java`인가? (`sh`가 아닌지 확인)

> **왜 PID 1이 java여야 하는가?**
> Docker는 `docker stop` 시 PID 1에게만 SIGTERM을 보냅니다.
> Dockerfile ENTRYPOINT가 `sh -c "exec java ..."` 형태이므로:
> - `exec` 있음 → java가 sh를 대체 → PID 1 = java → SIGTERM 직접 수신 → graceful shutdown 동작
> - `exec` 없음 → PID 1 = sh, java = 자식 프로세스 → sh가 SIGTERM 받아도 java에 전달 안 됨 → 30초 후 SIGKILL

### 2-3. stop_grace_period 확인

```bash
# 종료 시 시간 측정
time docker compose stop backend
```

- [ ] 종료가 10초 이내에 완료되는가? (유휴 상태일 때)
- [ ] 35초 이전에 완료되는가?

> **왜 35초인가?**
> `docker-compose.yml`의 `stop_grace_period: 35s`는 "SIGTERM 보내고 최대 35초 기다린 후 SIGKILL"이라는 의미입니다.
> Spring의 shutdown timeout이 30초이므로, Docker가 30초 이내에 종료되지 않으면 SIGKILL로 강제 종료됩니다.
> 35s = Spring 30s + 여유 5s로 설정하여 graceful shutdown이 완료될 시간을 보장합니다.
>
> **Docker 기본값은 10초**입니다. 이 설정이 없으면 Spring이 진행 중 요청을 처리하기 전에
> Docker가 10초 만에 SIGKILL을 보내 graceful shutdown이 무의미해집니다.

### 2-4. 진행 중 요청 완료 보장 확인 (고급)

> 이 테스트는 선택사항입니다. 느린 요청을 시뮬레이션하기 어렵지만, 개념을 확인할 수 있습니다.

```bash
# backend 시작 확인
docker compose start backend
sleep 10

# 터미널 1: 느린 요청 시뮬레이션 (목록 조회)
curl -s http://localhost/api/tasks &

# 터미널 2: 즉시 종료 명령
docker compose stop backend

# 결과: curl 요청이 에러 없이 완료되어야 함
```

> **왜?** Graceful shutdown은 "진행 중 요청은 완료하되, 새 요청은 거부"하는 방식입니다.
> ECS 배포 시 Task 교체 과정에서 이 동작이 중요합니다:
> 1. ALB가 드레이닝 시작 (새 요청 → 새 Task로)
> 2. ECS가 기존 Task에 SIGTERM 전송
> 3. Spring이 진행 중 요청 완료 후 종료
> 4. 사용자는 502 에러를 보지 않음

---

## 3) .dockerignore 최적화

### 3-1. 빌드 컨텍스트 크기 확인

```bash
# backend 빌드 컨텍스트 확인
docker build --no-cache --progress=plain ./backend 2>&1 | head -5
```

- [ ] `transferring context` 크기가 합리적인가? (수십 MB 이하)

> **왜 빌드 컨텍스트 크기가 중요한가?**
> `docker build`는 먼저 지정된 디렉토리(context)의 모든 파일을 Docker 데몬으로 전송합니다.
> `.dockerignore`가 없으면 `.gradle/`(수백 MB), `build/`(수십 MB) 등이 모두 전송됩니다.
> ECR 푸시 시 빌드 시간이 길어지고, 불필요한 파일이 이미지에 포함될 수 있습니다.

### 3-2. 제외된 파일 확인

```bash
# backend 이미지 빌드 후 내부 확인
docker compose up --build -d
docker compose exec backend sh -c "ls /app/ 2>/dev/null || echo 'app.jar만 존재'"
```

- [ ] `/app/app.jar`만 존재하는가?
- [ ] `src/test/` 디렉토리가 없는가?
- [ ] `*.md` 파일이 없는가?

> **왜 src/test/가 제외되는가?**
> Dockerfile에서 `./gradlew bootJar -x test`로 테스트를 건너뛰므로
> 테스트 소스 코드가 빌드 컨텍스트에 포함될 필요가 없습니다.
> 제외하면 빌드 컨텍스트 전송량이 줄어 빌드 속도가 빨라집니다.

### 3-3. frontend 제외 항목 확인

```bash
docker compose exec frontend sh -c "ls /usr/share/nginx/html/"
```

- [ ] React 빌드 결과물(index.html, assets/)이 존재하는가?
- [ ] `node_modules/`가 없는가?
- [ ] `*.md` 파일이 없는가?

> **왜 node_modules/가 제외되는가?**
> Dockerfile의 multi-stage 빌드에서 `npm ci`로 의존성을 컨테이너 안에서 설치합니다.
> 호스트의 `node_modules/`는 OS/아키텍처가 다를 수 있어 컨테이너에서 사용할 수 없습니다.
> 또한 수만 개의 파일을 전송하면 빌드 컨텍스트 전송이 매우 느려집니다.
>
> **주의**: `nginx-*.conf`는 `.dockerignore`에 포함하면 안 됩니다.
> frontend Dockerfile에서 `COPY ${NGINX_CONF}` 명령으로 nginx 설정 파일을 복사하기 때문입니다.

---

## 4) 구조화된 JSON 로그

> 이 항목은 `prod` 프로필에서만 JSON 형식이 적용됩니다.
> docker-compose.yml의 기본 설정은 `SPRING_PROFILES_ACTIVE=dev`이므로
> **환경변수를 임시로 변경**해야 합니다.

### 4-1. dev 프로필 — 텍스트 로그 확인 (기본 상태)

```bash
# dev 프로필로 실행 중인 상태에서
curl -s http://localhost/api/tasks > /dev/null

# 로그 확인
docker compose logs --tail=5 backend
```

**기대 결과 (텍스트 형식):**
```
... INFO ... --- [nio-8080-exec-1] c.t.filter.RequestLoggingFilter : HTTP GET /api/tasks 200 12ms
```

- [ ] 사람이 읽을 수 있는 텍스트 형식인가?
- [ ] `HTTP GET /api/tasks 200 XXms` 패턴인가?

> **왜 dev에서는 텍스트인가?**
> `application-dev.yml`에는 `logging.structured.format.console` 설정이 없습니다.
> Spring Boot의 기본 로그 포맷(텍스트)이 적용됩니다.
> 개발 시에는 가독성이 중요하므로 텍스트가 적절합니다.

### 4-2. prod 프로필 — JSON 로그 확인

```bash
# 기존 컨테이너 종료
docker compose down

# prod 프로필로 임시 실행
# (DB 환경변수는 docker-compose.yml에서 이미 설정되어 있음)
SPRING_PROFILES_ACTIVE=prod docker compose up -d
```

> **주의**: prod 프로필은 DB 환경변수 기본값이 없습니다(fail-fast 설계).
> docker-compose.yml에서 `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`를
> 환경변수로 주입하므로 정상 동작합니다.

```bash
# Spring Boot 시작 대기
sleep 15

# API 요청
curl -s http://localhost/api/tasks > /dev/null

# JSON 로그 확인
docker compose logs --tail=5 backend
```

**기대 결과 (JSON 형식):**
```json
{"@timestamp":"2026-03-02T...","message":"HTTP GET /api/tasks 200 12ms","http_method":"GET","uri":"/api/tasks","status":200,"latency_ms":12,...}
```

- [ ] 로그가 JSON 형식인가?
- [ ] `http_method` 필드가 존재하는가?
- [ ] `uri` 필드가 존재하는가?
- [ ] `status` 필드가 숫자(200)인가?
- [ ] `latency_ms` 필드가 숫자인가?
- [ ] `message` 필드에 기존 텍스트 메시지가 포함되는가?

> **왜 JSON인가?**
> `application-prod.yml`에 `logging.structured.format.console: logstash` 설정이 있습니다.
> Spring Boot 3.4+ 내장 structured logging 기능으로, 추가 라이브러리가 필요 없습니다.
>
> **왜 `addKeyValue()`를 사용하는가?**
> `RequestLoggingFilter`에서 `log.atInfo().addKeyValue("http_method", ...)` 형태로 로깅합니다.
> - prod (JSON): `addKeyValue()`의 key-value가 JSON 최상위 필드로 출력됨
> - dev (텍스트): `addKeyValue()`가 무시되고 `message` 문자열만 출력됨
>
> CloudWatch Logs Insights에서 이 JSON 필드로 쿼리할 수 있습니다:
> ```
> fields @timestamp, http_method, uri, status, latency_ms
> | filter status >= 400
> | sort @timestamp desc
> ```

### 4-3. Actuator 로그 제외 확인

```bash
# Actuator 요청
curl -s http://localhost/actuator/health > /dev/null

# 로그에 actuator 요청이 없는지 확인
docker compose logs --tail=10 backend | grep actuator
```

- [ ] Actuator 요청이 로그에 기록되지 **않는가?**

> **왜 제외하는가?**
> ALB 헬스체크가 30초마다 `/actuator/health`를 호출합니다.
> 이를 로깅하면 하루에 2,880건의 무의미한 로그가 쌓입니다.
> `RequestLoggingFilter.shouldNotFilter()`에서 `/actuator`로 시작하는 경로를 제외합니다.

### 4-4. dev 프로필로 복원

```bash
# prod 테스트 종료 후 dev로 복원
docker compose down
docker compose up -d
```

---

## 5) ECR 푸시 스크립트

> ECR 푸시는 AWS 계정이 필요하므로 **실제 푸시는 불가능**합니다.
> 스크립트 문법 검증과 Docker 이미지 빌드만 로컬에서 확인합니다.

### 5-1. 스크립트 문법 검증

```bash
bash -n scripts/ecr-push.sh
```

- [ ] 에러 없이 완료되는가?

> **`bash -n`이란?**
> 스크립트를 실행하지 않고 문법(syntax)만 검사합니다.
> 따옴표 미닫힘, 괄호 불일치 등의 문법 에러를 잡을 수 있습니다.

### 5-2. 실행 권한 확인

```bash
ls -la scripts/ecr-push.sh
```

- [ ] `-rwxr-xr-x` 등 실행 권한(`x`)이 있는가?

### 5-3. 사용법 확인 (인자 없이 실행)

```bash
./scripts/ecr-push.sh 2>&1 || true
```

- [ ] 사용법 안내 메시지가 출력되는가?
- [ ] `사용법:` 또는 `AWS_ACCOUNT_ID`가 포함된 에러 메시지인가?

> **왜 인자 없이 실행하면 에러인가?**
> `${1:?사용법: ...}` 구문은 첫 번째 인자가 없으면 에러 메시지를 출력하고 종료합니다.
> 이는 bash의 파라미터 확장(parameter expansion) 기능입니다.

### 5-4. git 태그 확인

```bash
git rev-parse --short HEAD
```

- [ ] 7자리 해시가 출력되는가? (예: `9106ed7`)

> **왜 git hash를 태그로 사용하는가?**
> ECR에 푸시된 이미지가 어떤 커밋에서 빌드되었는지 추적할 수 있습니다.
> `latest` 태그만 사용하면 "지금 배포된 버전이 어떤 코드인지" 알 수 없습니다.
> git hash 태그를 사용하면 `git log 9106ed7`로 해당 이미지의 소스를 즉시 확인할 수 있습니다.

### 5-5. Docker 이미지 빌드 확인 (푸시 없이)

```bash
# backend 이미지 빌드
docker build -t taskboard-backend:test ./backend

# frontend 이미지 빌드 (AWS용 nginx 설정)
docker build --build-arg NGINX_CONF=nginx-aws.conf -t taskboard-frontend:test ./frontend
```

- [ ] backend 이미지 빌드가 성공하는가?
- [ ] frontend 이미지 빌드가 성공하는가?

> **왜 `NGINX_CONF=nginx-aws.conf`인가?**
> ECR 스크립트는 AWS용 이미지를 빌드합니다.
> AWS에서는 ALB가 API 라우팅을 담당하므로, nginx는 정적 파일 서빙만 합니다.
> `nginx-aws.conf`에는 `proxy_pass` 설정이 없고, `nginx-local.conf`에만 있습니다.
> 로컬 docker-compose.yml은 기본값 `nginx-local.conf`를 사용합니다.

### 5-6. AWS용 nginx 설정 확인

```bash
# AWS용 이미지에서 nginx 설정 확인
docker run --rm taskboard-frontend:test cat /etc/nginx/conf.d/default.conf
```

- [ ] `proxy_pass` 설정이 **없는가?** (정적 서빙만)
- [ ] `try_files` 설정이 있는가? (SPA fallback)

```bash
# 로컬용과 비교
docker run --rm $(docker compose images frontend -q 2>/dev/null || echo "taskboard-frontend:test") cat /etc/nginx/conf.d/default.conf 2>/dev/null
```

> **로컬 vs AWS nginx 설정 차이:**
> | 항목 | nginx-local.conf | nginx-aws.conf |
> |------|------------------|----------------|
> | 정적 서빙 | O | O |
> | SPA fallback | O | O |
> | `/api/*` 프록시 | O (`proxy_pass http://backend:8080`) | X (ALB가 처리) |
> | `/actuator/*` 프록시 | O | X |

### 5-7. 테스트 이미지 정리

```bash
docker rmi taskboard-backend:test taskboard-frontend:test 2>/dev/null
```

---

## 6) 정리

```bash
# 운영 모드 종료
docker compose down

# 데이터까지 초기화
docker compose down -v
```

---

## 부록: 5가지 항목이 AWS에서 하는 역할

| 항목 | 로컬에서 확인하는 것 | AWS에서 하는 역할 |
|------|---------------------|------------------|
| Health Check 상세화 | DB 연결 상태 표시, 503 반환 | ALB 헬스체크 실패 → 트래픽 차단 |
| Graceful Shutdown | SIGTERM → 진행 중 요청 완료 후 종료 | ECS Task 교체 시 502 에러 방지 |
| .dockerignore | 빌드 컨텍스트 축소 | ECR 푸시 시간 단축, 이미지 크기 최적화 |
| JSON 로그 | 로그 형식 확인 | CloudWatch Logs Insights에서 필드별 쿼리 |
| ECR 스크립트 | 문법 검증, 이미지 빌드 확인 | `./scripts/ecr-push.sh` 한 줄로 배포 |

```
로컬에서 확인한 것들이 AWS에서 이렇게 연결됩니다:

docker compose stop             →  ECS Task 교체 시 SIGTERM
  └── graceful shutdown 동작        └── 502 에러 없이 교체 완료

curl /actuator/health → 503     →  ALB 헬스체크 실패
  └── DB 다운 감지                   └── 자동 트래픽 차단

docker compose logs (JSON)      →  CloudWatch Logs Insights
  └── http_method, status 필드       └── filter status >= 400 쿼리

docker build (fast)             →  ecr-push.sh → ECR 푸시
  └── .dockerignore 적용             └── 빌드/전송 시간 단축
```
