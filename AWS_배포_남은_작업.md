# AWS 배포 남은 작업 — Backend 문제 해결부터 완료까지

> **현재 상태:** Frontend Service 정상 (1/1), Backend Service 배포 실패 (헬스체크 타임아웃)
> **이 문서의 목표:** Backend 문제를 해결하고, 동작 확인 후 남은 작업을 완료

---

## 1. Backend 배포 실패 원인 분석

### 로그 분석 결과

CloudWatch Logs (`/ecs/taskflow-backend`)에서 확인된 내용:

```
Started BackendApplication in 45.802 seconds (process running for 49.122)
The following 1 profile is active: "prod"
```

**Spring Boot는 정상 시작됨.** DB 연결 에러, Flyway 에러 없음. prod 프로필도 정상 적용.

### 그런데 왜 실패?

**원인: 헬스체크 유예 기간(Health Check Grace Period)이 0초**

ECS Service 생성 시 "상태 검사 유예 기간"을 0초로 설정했습니다. 이 값은 "Task 시작 후 이 시간 동안은 헬스체크 실패를 무시해라"는 설정입니다.

```
시간 흐름:

0초   — Task 시작, Spring Boot 로딩 시작
0초   — 유예 기간 0 → ALB 헬스체크 즉시 시작
30초  — 첫 번째 헬스체크: Spring Boot 아직 로딩 중 → 실패
45초  — Spring Boot 시작 완료 (하지만 이미 1회 실패)
60초  — 두 번째 헬스체크: 이번엔 응답 가능하지만...
       → 비정상 임계값 2회 도달 전에 ECS 배포 회로 차단기(circuit breaker)가
         Task를 중지시킬 수 있음
       → Task 중지 → 새 Task 시작 → 또 같은 상황 반복
```

**Spring Boot가 45초 걸려서 시작되는데, 유예 기간이 0초라서 시작도 하기 전에 "비정상"으로 판정되는 것입니다.**

---

## 2. 해결 방법: 헬스체크 유예 기간 변경

### 조치

**경로:** ECS → 클러스터 → taskflow-cluster → 서비스 탭 → `taskflow-backend-service` 클릭 → **서비스 업데이트** 클릭

**변경할 항목:**

| 항목 | 현재 값 | 변경 값 | 이유 |
|---|---|---|---|
| 상태 검사 유예 기간 | 0초 | **120초** | Spring Boot 시작(~46초) + Flyway 마이그레이션 + 여유 시간 |

나머지 설정은 그대로 두고 **업데이트** 클릭

> **120초인 이유:** Spring Boot 시작에 약 46초 + Flyway 마이그레이션 + JVM 워밍업. 넉넉히 120초로 잡으면 안전합니다. 이 시간 동안 ALB 헬스체크가 실패해도 ECS가 Task를 죽이지 않습니다.
>
> **왜 처음부터 120초로 안 했나?** ECS 콘솔의 기본값이 0이고, Spring Boot 시작 시간을 미리 알기 어렵습니다. 이런 트러블슈팅 과정 자체가 학습 포인트입니다.

### Frontend Service도 동일하게 변경

**경로:** `taskflow-frontend-service` → 서비스 업데이트 → 상태 검사 유예 기간: **60초**

> nginx는 1~2초면 시작하지만, 여유를 두어 60초로 설정합니다.

### 변경 후 확인

업데이트 후 ECS가 자동으로 새 Task를 배포합니다. 1~3분 후:

**확인 경로:** ECS → 클러스터 → taskflow-cluster → 태스크 탭

**정상 상태:**
- taskflow-backend:1 — 마지막 상태: **실행 중**, 원하는 상태: **실행 중**
- taskflow-frontend:1 — 마지막 상태: **실행 중**, 원하는 상태: **실행 중**

**여전히 실패하면:**
- CloudWatch Logs에서 새 로그 스트림 확인
- DB 연결 에러가 있는지 확인 (SSM 파라미터 값이 정확한지)
- 보안 그룹 확인 (rds-sg가 ecs-sg에서 3306 허용하는지)

---

## 3. 동작 확인 (4단계)

Backend가 정상 실행되면, ALB DNS로 접속하여 전체 동작을 확인합니다.

### ALB DNS 확인

**경로:** EC2 → 로드 밸런싱 → 로드밸런서 → taskflow-alb → DNS 이름 복사

DNS 이름 예시: `taskflow-alb-1790501168.ap-northeast-2.elb.amazonaws.com`

### 확인 항목

| URL | 예상 결과 | 무엇을 확인하나 |
|---|---|---|
| `http://ALB_DNS/` | React UI 화면 | ALB → Frontend TG → nginx 정상 |
| `http://ALB_DNS/api/tasks` | `{"content":[],...}` (빈 목록) | ALB → Backend TG → Spring Boot → RDS 정상 |
| `http://ALB_DNS/actuator/health` | `{"status":"UP"}` | Spring Boot Actuator 정상 |

### 확인 방법

브라우저에서 위 URL을 직접 접속하거나, WSL에서 curl로 확인:

```bash
# React UI (HTML 응답)
curl http://ALB_DNS/

# API (JSON 응답)
curl http://ALB_DNS/api/tasks

# 헬스체크 (JSON 응답)
curl http://ALB_DNS/actuator/health
```

### CRUD 테스트

```bash
ALB=taskflow-alb-1790501168.ap-northeast-2.elb.amazonaws.com

# 생성
curl -X POST http://$ALB/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"첫 번째 AWS 태스크","priority":"HIGH"}'

# 조회
curl http://$ALB/api/tasks

# 수정
curl -X PUT http://$ALB/api/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"title":"수정된 태스크","status":"DOING","priority":"MEDIUM"}'

# 삭제
curl -X DELETE http://$ALB/api/tasks/1
```

> **전체 흐름 검증:**
> 브라우저 → ALB(Public) → Frontend Task(nginx) → React UI
> React UI → /api/tasks → ALB → Backend Task(Spring Boot) → RDS MySQL
> 이 경로가 모두 정상이면 AWS 배포가 완료된 것입니다.

---

## 4. CloudWatch Logs 확인

**경로:** 콘솔 검색 → CloudWatch → 로그 그룹

| 로그 그룹 | 내용 |
|---|---|
| `/ecs/taskflow-backend` | Spring Boot 로그 (API 요청, 에러 등) |
| `/ecs/taskflow-frontend` | nginx 접근 로그 |

> **왜 확인?** 로컬에서는 `docker compose logs`로 봤던 로그를 AWS에서는 CloudWatch로 봅니다. 에러 추적, 요청 로깅 확인, 배포 문제 디버깅에 필수입니다.
>
> **로그 보존 기간 설정 권장:** 기본값이 "만료 없음(영구 보관)"이므로 로그가 무한히 쌓입니다. 로그 그룹 선택 → 작업 → 보존 기간 편집 → **7일** 또는 **30일**로 설정하면 스토리지 비용을 절약할 수 있습니다.

---

## 5. (선택) GitHub Actions CI/CD

설계서의 "AWS 2단계: GitHub Actions 자동화"에 해당합니다. 수동 배포가 성공한 후에 진행합니다.

### 왜 필요한가?

현재 코드를 변경하면 매번 이렇게 해야 합니다:
```
코드 수정 → docker build → docker tag → ECR 로그인 → docker push → ECS Service 업데이트
```

GitHub Actions로 자동화하면:
```
git push → 자동으로 위 과정 전부 실행
```

### 구현 개요

프로젝트에 `.github/workflows/deploy.yml` 파일을 만들어서:

1. `git push` 시 자동 트리거
2. GitHub Actions에서 Docker 이미지 빌드
3. ECR에 이미지 push
4. ECS Service 업데이트 (새 이미지로 교체)

> **비용:** public 레포지토리면 GitHub Actions 완전 무료.
>
> **이 작업은 수동 배포를 먼저 성공시킨 후에 진행합니다.** 수동 배포가 안 되는 상태에서 CI/CD를 만들면 디버깅이 어렵습니다.

---

## 6. 리소스 정리 (학습 종료 시)

학습이 끝나면 아래 순서대로 정리합니다. **순서가 중요합니다.**

> ⚠️ **NAT Gateway, ALB는 Stop이 불가합니다.** 존재하는 동안 시간당 과금됩니다. 삭제만 가능합니다.
> ⚠️ **무료 플랜이라도 크레딧이 줄어드는 건 같습니다.** 사용하지 않으면 리소스를 정리해야 크레딧을 아낄 수 있습니다.

| 순서 | 리소스 | 조치 방법 | 주의사항 |
|---|---|---|---|
| 1 | ECS Service 2개 | 서비스 삭제 또는 원하는 태스크 0으로 | Task가 먼저 내려가야 함 |
| 2 | ALB | EC2 → 로드밸런서 → **삭제** | Stop 없음, TG도 함께 삭제 |
| 3 | NAT Gateway | VPC → NAT 게이트웨이 → **삭제** | Stop 없음 |
| 4 | 탄력적 IP | EC2 → 탄력적 IP → **반납(Release)** | NAT 삭제해도 자동 반납 안 됨! |
| 5 | ECS Cluster | ECS → 클러스터 → 삭제 | EC2(ASG)도 함께 정리됨 |
| 6 | RDS | RDS → 데이터베이스 → **삭제** | Stop은 7일 후 자동 재시작됨 |
| 7 | EC2 확인 | EC2 → 인스턴스 → Terminate 확인 | ASG 삭제 시 자동 종료되나 확인 필수 |
| 8 | EBS 볼륨 | EC2 → 볼륨 → "available" 상태 확인 → 삭제 | EC2 종료해도 남아있을 수 있음 |
| 9 | ECR 이미지 | ECR → 리포지토리 → 이미지 삭제 | 500MB 초과 시 과금 |
| 10 | CloudWatch 로그 | CloudWatch → 로그 그룹 → 삭제 | 소량이면 비용 미미 |

### 임시 중단 (나중에 다시 할 때)

완전 삭제가 아니라 비용만 줄이고 싶다면:

```
비용이 큰 것만 삭제:
1. NAT Gateway 삭제 + 탄력적 IP 반납 (~$33/월 절감)
2. ALB 삭제 (~$20/월 절감)
3. ECS Service 원하는 태스크 0으로 (Task 중지)
4. RDS Stop (7일 후 자동 재시작 주의)
5. EC2 ASG 원하는 용량 0으로 (EC2 중지)

남겨두는 것 (비용 없음):
- VPC, 서브넷, 라우팅 테이블, 보안 그룹
- SSM Parameter Store
- ECR 레포지토리 (이미지 500MB 이내)
- Task Definition, IAM Role
```

> **다시 시작할 때:** NAT Gateway와 ALB를 다시 만들고, 라우팅 테이블에 새 NAT를 연결하면 됩니다.

---

## 트러블슈팅 가이드

### Backend Task가 시작 후 바로 중지됨

**원인 1: 헬스체크 유예 기간 부족**
- 증상: 로그에 "Started BackendApplication" 있지만 Task가 중지됨
- 해결: ECS Service 업데이트 → 상태 검사 유예 기간 120초

**원인 2: DB 연결 실패**
- 증상: 로그에 "Connection refused" 또는 "Access denied"
- 확인: SSM Parameter Store의 host/password 값이 정확한지
- 확인: rds-sg 인바운드에 ecs-sg 3306 허용되어 있는지
- 확인: RDS 상태가 "사용 가능"인지

**원인 3: SSM 파라미터 읽기 실패**
- 증상: 로그에 "ResourceNotFoundException" 또는 Task 시작 자체가 안 됨
- 확인: Task Definition의 ValueFrom 경로가 `/taskflow/db/host` 형식인지
- 확인: ecsTaskExecutionRole에 AmazonSSMReadOnlyAccess 정책이 있는지

### ALB 접속 시 502 Bad Gateway

- Backend Task가 실행 중인지 확인 (ECS → 태스크 탭)
- Target Group 상태 확인 (EC2 → 대상 그룹 → 대상 탭 → "healthy" 여부)
- Spring Boot 시작 완료까지 Flyway 포함 약 46초 소요 → 기다리고 재시도

### ALB 접속 시 503 Service Unavailable

- Target Group에 등록된 healthy 대상이 0개
- ECS Service에서 Task가 실행되고 있는지 확인
- 보안 그룹 체인 확인: alb-sg → ecs-sg (80/8080) → rds-sg (3306)

### Task가 PENDING 상태에서 멈춤

- ENI 부족: 다른 Task가 이미 실행 중일 수 있음 → 기존 Task 중지 후 재시도
- EC2 용량 부족: ASG 원하는 용량이 0인지 확인
- 서브넷 불일치: Task가 EC2와 다른 서브넷에 배치되려고 하는지 확인

### ECR에서 이미지 pull 실패

- NAT Gateway 상태 확인: VPC → NAT 게이트웨이 → "Available"인지
- Private subnet 라우팅 테이블에 `0.0.0.0/0 → NAT` 규칙이 있는지
- ecsTaskExecutionRole에 AmazonECSTaskExecutionRolePolicy가 있는지
