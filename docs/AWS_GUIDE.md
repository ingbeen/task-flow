# AWS 배포 학습 가이드

> **목적:** AWS 회원가입부터 CI/CD까지 진행한 모든 과정을 학습용으로 정리
> **대상:** AWS 완전 초보자
> **원칙:** "무조건 따라하기"가 아닌, 왜 이렇게 하는지 이해하면서 진행
> **참조:** 설계 상세는 DESIGN.md, 로컬 구현 학습은 LEARNING.md, 테스트는 TESTING.md 참조

---

## 전체 아키텍처 요약

```
인터넷 (브라우저)
  ↓ HTTP :80
ALB (taskflow-alb) — Public Subnet에 위치, 양쪽 AZ에 걸쳐있음
  ├── /api/*       → Backend TG (IP target)  → Backend Task (Spring Boot :8080)
  ├── /actuator/*  → Backend TG              → Backend Task
  └── /* (기본)    → Frontend TG (IP target) → Frontend Task (nginx :80)

EC2 t3.small (Private Subnet, AZ-a에 1대)
  ├── Frontend Task (ENI 1개) — nginx: 정적 서빙만
  └── Backend Task (ENI 1개) — Spring Boot → RDS MySQL

NAT Gateway 1개 (Public Subnet, AZ-a) — Private에서 인터넷 아웃바운드용
RDS MySQL (Private Subnet, AZ-a) — Backend만 접근 가능
```

## 리소스 간 연결 관계도

아래는 "이 리소스가 왜 필요하고, 어디서 사용되는지"를 보여줍니다.

```
[AWS 계정 설정]
  MFA ─────────────→ 루트 사용자 보안 (콘솔 로그인 시 2차 인증)
  AWS Budgets ────→ 비용 알림 (크레딧 소진 속도 모니터링)
  액세스 키 ──────→ AWS CLI (WSL에서 ECR 이미지 푸시 시 인증)

[네트워크 계층]
  VPC ─────────────→ 모든 리소스의 가상 네트워크 공간
  서브넷 4개 ──────→ VPC 안의 IP 구역 (Public 2 + Private 2)
  인터넷 게이트웨이 → VPC ↔ 인터넷 양방향 연결 (Public subnet이 사용)
  NAT Gateway ────→ Private subnet → 인터넷 나가기 전용 (ECR pull, 로그 전송)
  라우팅 테이블 ──→ "어디로 가려면 어떤 문으로" 규칙 (Public→IGW, Private→NAT)
  보안 그룹 3개 ──→ 리소스별 방화벽 (ALB→ECS→RDS 체인)

[데이터 계층]
  RDS ─────────────→ MySQL 데이터베이스 (Backend Task가 접속)
    └── DB 서브넷 그룹 → RDS가 배치될 수 있는 서브넷 후보 목록
  SSM Parameter Store → DB 접속 정보 저장 (ECS Task가 시작 시 가져감)

[이미지 저장소]
  ECR 레포 2개 ────→ Docker 이미지 저장소 (frontend, backend)
    └── AWS CLI ────→ 로컬에서 ECR에 이미지 push 시 사용

[컴퓨팅 계층]
  ECS Cluster ─────→ Task를 실행하는 논리적 묶음
    └── EC2 (ASG) ──→ Task가 실제로 돌아가는 서버
  IAM Role ─────────→ Task의 권한 (ECR pull + SSM 읽기 + 로그 전송)
  Task Definition 2개 → 컨테이너 실행 명세 (이미지, 메모리, 환경변수, 포트)
    └── 환경변수 ────→ SSM Parameter Store에서 ValueFrom으로 주입
  ECS Service 2개 ──→ Task를 유지/배포하고 ALB TG에 자동 등록

[트래픽 계층]
  ALB ─────────────→ 외부 요청 진입점 (경로 기반 라우팅)
  Target Group 2개 → ALB가 트래픽/헬스체크를 보내는 대상 묶음
    └── ECS Service가 Task IP를 자동 등록/해제
  Listener Rules ──→ /api/* → Backend TG, /actuator/* → Backend TG, /* → Frontend TG
```
---

## 0단계: AWS 계정 설정

### 0-1. AWS 회원가입

**접속:** https://portal.aws.amazon.com/billing/signup

**가입 절차:**
1. 이메일 + 계정 이름 입력 → 이메일 인증 코드 확인
2. 루트 사용자 비밀번호 설정 (대문자/소문자/숫자/특수문자 포함)
3. 연락처 정보 (개인, 영문 입력)
4. 결제 정보 (신용카드/체크카드, $1 임시 결제 후 환불)
5. 본인 인증 (SMS 또는 음성 통화)
6. **무료 플랜(Free Plan) 선택** ← 핵심! 크레딧 소진 시 자동 과금 안 됨
7. Support 플랜: **기본(무료)** 선택

**결과:** 계정 활성화, $100 가입 크레딧 자동 지급

> **왜 무료 플랜?** 크레딧이 소진되면 서비스가 중단되고 카드 청구가 안 됩니다. 학습용에 가장 안전한 선택입니다.

### 0-2. 플랜 확인

**경로:** 콘솔 우측 상단 계정명 → 과금 정보 및 비용 관리 → 프리 티어

**확인 포인트:**
- "무료 플랜 계정에는 요금이 청구되지 않음" 메시지
- 남은 크레딧 금액

### 0-3. 리전 선택

**경로:** 콘솔 우측 상단 리전 이름 클릭 → **아시아 태평양(서울) ap-northeast-2** 선택

> **왜 서울?** 한국에서 가장 빠른 응답 속도. 학습 시 서울 리전 하나만 사용하여 리소스 관리를 단순화합니다.

### 0-4. MFA 설정

**경로:** 우측 상단 계정명 → 보안 자격 증명 → 멀티 팩터 인증(MFA) → MFA 디바이스 할당

**설정:**
- 디바이스 이름 입력
- 인증 앱 선택 (Google Authenticator 등)
- QR 코드 스캔 → 6자리 코드 2회 입력

> **왜 MFA?** 비밀번호만으로는 해킹 위험이 있습니다. MFA는 비밀번호 + 스마트폰 인증의 2단계 인증으로, 비밀번호 관련 공격의 99% 이상을 차단합니다. 2025년 6월부터 AWS가 모든 계정에 MFA를 강제합니다.

### 0-5. AWS Budgets 설정

**경로:** 콘솔 검색 → 과금 정보 및 비용 관리 → 예산 및 계획 → 예산 → 예산 생성

**설정:**
- 템플릿 사용(간소화) → **제로 지출 예산** 선택
- 알림 이메일 입력

> **왜 예산?** 무료 플랜이라 카드 결제는 안 되지만, 크레딧 소진 속도를 파악할 수 있습니다. NAT Gateway 같은 서비스는 시간당 과금이라 알림 없이는 크레딧이 얼마나 빠르게 줄어드는지 모릅니다.
>
> **온보딩 크레딧:** 이 활동을 완료하면 $100 추가 크레딧을 받을 수 있습니다.

### 0-6. 크레딧 확인

**경로:** 과금 정보 및 비용 관리 → 크레딧

**확인 포인트:**
- 남은 총 금액 (가입 $100 + 온보딩 $100 = $200 확인)
- 만료 날짜
- 활성 크레딧 개수

---

## 1단계: 네트워크 구성

> **이 단계의 목표:** 서버가 들어갈 네트워크 환경을 만듭니다. 건물을 짓기 전에 도로/전기/배관을 까는 단계입니다.

### 1-1. VPC 생성

**경로:** 콘솔 검색 → VPC → VPC → VPC 생성

**VPC란?** AWS 안에서 나만 쓰는 가상 네트워크입니다. 모든 AWS 리소스(EC2, RDS, ALB 등)는 이 VPC 안에 배치됩니다.

| 항목 | 값 | 이유 |
|---|---|---|
| 생성할 리소스 | VPC만 | 서브넷 등을 수동으로 만들기 위해 |
| 이름 태그 | `taskflow-vpc` | 프로젝트명 접두어로 구분 |
| IPv4 CIDR | `10.0.0.0/16` | VPC 안에서 쓸 IP 범위 (~65,000개), 서브넷 나눌 여유 확보 |
| IPv6 | 없음 | 학습용, IPv4만 사용 |
| 테넌시 | 기본값 | 전용 서버는 비용이 훨씬 비쌈 |

**추가 설정 — DNS 호스트 이름 활성화:**
VPC 목록 → `taskflow-vpc` 선택 → 작업 → VPC 설정 편집 → **DNS 호스트 이름 활성화** 체크

> **왜 DNS 활성화?** RDS는 IP가 아닌 DNS 이름(예: `taskflow-db.xxx.rds.amazonaws.com`)으로 접속합니다. RDS가 재시작되면 IP가 바뀔 수 있는데, DNS는 자동으로 새 IP를 가리킵니다. 이 기능이 꺼져있으면 VPC 안에서 DNS 이름을 해석할 수 없어 DB 연결이 안 됩니다.

> **기본 VPC:** AWS가 자동으로 만들어둔 VPC가 이미 존재합니다(172.31.0.0/16). 이건 건드리지 말고, 우리 프로젝트용 VPC를 새로 만듭니다. 기본 VPC와 우리 VPC는 완전히 독립된 별개 네트워크입니다.

### 1-2. 서브넷 4개 생성

**경로:** VPC → 서브넷 → 서브넷 생성 → VPC: `taskflow-vpc` 선택

**서브넷이란?** VPC 안의 IP 구역입니다. VPC가 아파트 단지 전체라면, 서브넷은 각 동(棟)입니다. 서브넷 자체에는 Public/Private 구분이 없고, **연결하는 라우팅 테이블에 따라** Public 또는 Private이 됩니다.

| 이름 | AZ | CIDR | 용도 |
|---|---|---|---|
| `taskflow-public-a` | ap-northeast-2a | `10.0.1.0/24` (IP 256개) | ALB, NAT Gateway 배치 |
| `taskflow-public-b` | ap-northeast-2b | `10.0.2.0/24` | ALB 생성 조건 (최소 2 AZ) |
| `taskflow-private-a` | ap-northeast-2a | `10.0.11.0/24` | EC2, Task, RDS 배치 |
| `taskflow-private-b` | ap-northeast-2b | `10.0.12.0/24` | RDS 서브넷 그룹 조건 (최소 2 AZ) |

> **왜 4개?** ALB는 최소 2개 AZ의 Public subnet을 요구합니다. RDS 서브넷 그룹도 최소 2개 AZ의 Private subnet을 요구합니다. 이 AWS 서비스 생성 조건을 충족하기 위해 4개가 필요합니다.
>
> **왜 AZ를 a, b로 나눴나?** 같은 AZ에 Public/Private을 쌍으로 두면 NAT Gateway 라우팅이 자연스럽습니다. 실제 리소스(EC2, NAT, RDS)는 전부 AZ-a에만 배치하고, AZ-b는 AWS 생성 조건용 빈 그릇입니다.
>
> **CIDR 설계:** Public은 1, 2번대, Private은 11, 12번대로 번호를 떼어놓아 한눈에 구분됩니다. /24이면 각 서브넷에 256개 IP(실제 251개 사용 가능)로 학습용에 충분합니다.

### 1-3. 인터넷 게이트웨이 생성

**경로:** VPC → 인터넷 게이트웨이 → 인터넷 게이트웨이 생성

**인터넷 게이트웨이(IGW)란?** VPC와 인터넷을 연결하는 양방향 출입문입니다. 이게 없으면 VPC는 인터넷과 완전히 단절됩니다.

| 항목 | 값 |
|---|---|
| 이름 태그 | `taskflow-igw` |

**생성 후:** 작업 → VPC에 연결 → `taskflow-vpc` 선택

> **왜 VPC에 연결?** IGW는 만들기만 하면 어떤 VPC에도 붙어있지 않습니다. VPC에 연결해야 비로소 출입문이 열립니다. VPC당 1개만 연결 가능합니다.
>
> **비용:** 무료. NAT Gateway와 달리 시간당 과금이 없습니다.

### 1-4. NAT Gateway 생성

**경로:** VPC → NAT 게이트웨이 → NAT 게이트웨이 생성

**NAT Gateway란?** Private subnet에서 인터넷으로 나가는 전용 후문입니다. 밖에서 들어오는 건 차단하고, 안에서 밖으로만 나갈 수 있습니다.

| 항목 | 값 | 이유 |
|---|---|---|
| 이름 | `taskflow-nat` | |
| 가용성 모드 | **영역별** | NAT 1개만 만들어 비용 절감 (리전별은 여러 AZ에 자동 분산) |
| 서브넷 | `taskflow-public-a` | NAT는 IGW에 접근 가능한 Public에 있어야 함 |
| 연결 유형 | 퍼블릭 | 인터넷 아웃바운드용 |
| 탄력적 IP | 자동 | NAT에 고정 공인 IP 할당 |

> **왜 Public subnet에?** NAT는 Private의 트래픽을 대신 인터넷으로 보내주는 중개자입니다. NAT 자체가 인터넷에 나가려면 IGW에 접근 가능한 Public subnet에 있어야 합니다.
>
> **Private에서 NAT를 통해 나가는 경우:** ECR에서 Docker 이미지 pull, CloudWatch에 로그 전송, SSM Parameter Store에서 비밀번호 가져오기 등.
>
> **⚠️ 비용 주의:** 시간당 $0.045 (월 ~$33). 트래픽이 없어도 과금됩니다. 학습 종료 시 반드시 삭제. 탄력적 IP도 별도 반납(Release) 필요.

### 1-5. 라우팅 테이블 2개 설정

**경로:** VPC → 라우팅 테이블 → 라우팅 테이블 생성

**라우팅 테이블이란?** "어디로 가려면 어떤 문으로 나가라"는 이정표입니다. 서브넷이 Public인지 Private인지는 서브넷 자체가 아니라 **연결된 라우팅 테이블이 결정**합니다.

#### Public용 라우팅 테이블

| 항목 | 값 |
|---|---|
| 이름 | `taskflow-rt-public` |
| VPC | `taskflow-vpc` |

- 라우팅 탭 → 라우팅 편집 → 라우팅 추가: `0.0.0.0/0` → 인터넷 게이트웨이(`taskflow-igw`)
- 서브넷 연결 탭 → 서브넷 연결 편집 → `taskflow-public-a`, `taskflow-public-b` 체크

#### Private용 라우팅 테이블

| 항목 | 값 |
|---|---|
| 이름 | `taskflow-rt-private` |
| VPC | `taskflow-vpc` |

- 라우팅 탭 → 라우팅 편집 → 라우팅 추가: `0.0.0.0/0` → NAT 게이트웨이(`taskflow-nat`)
- 서브넷 연결 탭 → 서브넷 연결 편집 → `taskflow-private-a`, `taskflow-private-b` 체크

> **`0.0.0.0/0`은?** "모든 IP 주소" = VPC 밖으로 나가는 모든 트래픽에 대한 규칙입니다. VPC 내부(10.0.x.x끼리)는 `local` 규칙이 자동으로 처리합니다.
>
> **2개인 이유:** Public은 IGW로 직접 인터넷과 통신, Private은 NAT로 우회해서 나가기만 가능. 같은 라우팅 테이블을 쓰면 Public/Private 구분이 무의미해집니다.
>
> **라우팅과 보안 그룹의 역할 차이:**
> - 라우팅 테이블: "길이 있는가?" (물리적 경로)
> - 보안 그룹: "출입 허가가 있는가?" (접근 권한)
> - 길이 있어도 허가 없으면 차단, 허가 있어도 길이 없으면 도착 불가

### 1-6. 보안 그룹 3개 생성

**경로:** VPC → 보안 → 보안 그룹 → 보안 그룹 생성

**보안 그룹이란?** 리소스별 방화벽입니다. "누가 어디로 접근할 수 있는지"를 역할 기반으로 제어합니다.

#### alb-sg (ALB용)

| 인바운드 규칙 | 포트 | 소스 | 이유 |
|---|---|---|---|
| HTTP | 80 | `0.0.0.0/0` (모든 곳) | 인터넷에서 사용자 요청을 받아야 함 |

#### ecs-sg (ECS Task용)

| 인바운드 규칙 | 포트 | 소스 | 이유 |
|---|---|---|---|
| 사용자 지정 TCP | 80 | `taskflow-alb-sg` | ALB에서 Frontend Task로 |
| 사용자 지정 TCP | 8080 | `taskflow-alb-sg` | ALB에서 Backend Task로 |

#### rds-sg (RDS용)

| 인바운드 규칙 | 포트 | 소스 | 이유 |
|---|---|---|---|
| MySQL/Aurora | 3306 | `taskflow-ecs-sg` | ECS Task에서만 DB 접근 |

> **소스에 IP 대신 보안 그룹을 지정한 이유:** IP는 바뀔 수 있지만 보안 그룹은 고정입니다. "ALB에 속한 리소스만 ECS에 접근 가능"처럼 역할 기반으로 제어합니다.
>
> **체인 구조의 의미:** 인터넷 → alb-sg → ecs-sg → rds-sg. 인터넷에서 RDS로 직접 접근 불가. 최소 권한 원칙입니다.
>
> **보안 그룹은 서비스보다 먼저 만듦:** 보안 그룹은 규칙 묶음일 뿐이고, 나중에 서비스(ALB, ECS, RDS)를 만들 때 "어떤 보안 그룹을 쓸지" 선택합니다.

---

## 2단계: DB + 이미지 저장소

> **이 단계의 목표:** 데이터를 저장할 DB와 Docker 이미지를 올릴 저장소를 준비합니다.

####  RDS 서브넷 그룹 생성

**경로:** 콘솔 검색 → RDS → 서브넷 그룹 → DB 서브넷 그룹 생성

**서브넷 그룹이란?** RDS가 배치될 수 있는 서브넷 후보 목록입니다. 최소 2개 AZ의 서브넷이 필요합니다.

| 항목 | 값 |
|---|---|
| 이름 | `taskflow-db-subnet-group` |
| VPC | `taskflow-vpc` |
| 가용 영역 | `ap-northeast-2a`, `ap-northeast-2b` |
| 서브넷 | `taskflow-private-a`, `taskflow-private-b` |

> **Private만 넣은 이유:** Public에 넣으면 RDS가 Public에 배치될 가능성이 생깁니다. DB 보안을 위해 Private만 후보로 지정합니다.

**이 리소스는 어디서 사용되나?** → 2-2 RDS 생성 시 "DB 서브넷 그룹" 선택란에서 사용

####  RDS MySQL 생성

**경로:** RDS → 데이터베이스 → 데이터베이스 생성

| 항목 | 값 | 이유 |
|---|---|---|
| 생성 방식 | 표준 생성 | |
| 엔진 | MySQL 8.0.x | 로컬 docker-compose와 동일 버전 |
| 템플릿 | **프리 티어** | Single-AZ, 소형 인스턴스 자동 설정 |
| DB 식별자 | `taskflow-db` | |
| 마스터 사용자 | `admin` | |
| 자격 증명 관리 | 자체 관리 | 직접 비밀번호 입력 |
| 암호 자동 생성 | **체크 해제** | 놓치면 비밀번호를 다시 볼 수 없음 |
| 인스턴스 | `db.t4g.micro` | ARM(Graviton) 기반, t3보다 저렴, 성능 동일 |
| 스토리지 | gp3, 20GiB | 학습용 충분 |
| 스토리지 자동 조정 | **해제** | 예상치 못한 비용 방지 |
| VPC | `taskflow-vpc` | |
| 서브넷 그룹 | `taskflow-db-subnet-group` | ← 2-1에서 만든 것 |
| 퍼블릭 액세스 | **아니요** | DB를 인터넷에서 차단 |
| 보안 그룹 | `taskflow-rds-sg` | ← 1-6에서 만든 것. default 제거 필수! |
| 가용 영역 | `ap-northeast-2a` | EC2와 같은 AZ (지연/비용 최소화) |
| 초기 DB 이름 | `taskboard` | 자동으로 DB 생성됨 |
| 자동 백업 | **해제** | 학습용, 백업 비용 절감 |
| 삭제 방지 | **해제** | 학습 종료 후 쉽게 삭제 |

> **생성 소요:** 5~10분. 상태가 "사용 가능"이 되면 엔드포인트 주소를 확인합니다.
>
> **엔드포인트:** `taskflow-db.xxxx.ap-northeast-2.rds.amazonaws.com` — 이 주소를 SSM에 저장합니다.

####  SSM Parameter Store 등록

**경로:** 콘솔 검색 → Systems Manager → 파라미터 스토어 → 파라미터 생성

**SSM Parameter Store란?** DB 접속 정보 같은 설정값을 안전하게 저장하는 곳입니다. 로컬에서는 docker-compose.yml에 환경변수로 넣었지만, AWS에서는 여기에 저장하고 ECS Task가 시작할 때 자동으로 가져갑니다.

| 이름 | 유형 | 값 |
|---|---|---|
| `/taskflow/db/host` | 문자열 | RDS 엔드포인트 주소 |
| `/taskflow/db/port` | 문자열 | `3306` |
| `/taskflow/db/name` | 문자열 | `taskboard` |
| `/taskflow/db/user` | 문자열 | `admin` |
| `/taskflow/db/password` | **보안 문자열** | RDS 비밀번호 |

> **비밀번호만 보안 문자열인 이유:** AWS KMS로 암호화됩니다. 호스트, 포트 같은 정보는 민감하지 않으므로 일반 문자열로 충분합니다.
>
> **`/taskflow/db/` 경로 구조:** 나중에 프로젝트가 여러 개일 때 `/taskflow/*`, `/other/*`로 분리 가능. IAM 권한도 `/taskflow/*`만 허용하는 식으로 범위 제한 가능합니다.
>
> **비용:** Standard 파라미터는 완전 무료.

**이 리소스는 어디서 사용되나?** → 3-3 Task Definition의 환경변수에서 `ValueFrom`으로 참조

### 2-4. ECR 레포지토리 생성

**경로:** 콘솔 검색 → ECR → 프라이빗 레지스트리 → 리포지토리 → 리포지토리 생성

**ECR이란?** Docker 이미지를 저장하는 AWS 저장소입니다. Docker Hub의 AWS 버전이라고 생각하면 됩니다.

| 이름 | 가시성 |
|---|---|
| `taskflow/frontend` | 프라이빗 |
| `taskflow/backend` | 프라이빗 |

> **2개로 나눈 이유:** Frontend(nginx)와 Backend(Spring Boot)는 별도 Docker 이미지입니다. 각각 독립적으로 빌드/배포하려면 레포지토리도 분리합니다.
>
> **비용:** 500MB까지 무료. 우리 이미지 2개 합쳐서 200~300MB 정도.

**이 리소스는 어디서 사용되나?** → 2-5 이미지 푸시, 3-3 Task Definition의 이미지 URI

### 2-5. AWS CLI 설치 + ECR 푸시

**WSL에서 실행:**

```bash
# AWS CLI 설치
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
rm -rf awscliv2.zip aws/

# 설치 확인
aws --version
```

**액세스 키 생성:**
AWS 콘솔 → 우측 상단 계정명 → 보안 자격 증명 → 액세스 키 → 액세스 키 만들기 → CLI 선택

**WSL에서 자격 증명 설정:**
```bash
aws configure
# Access Key ID: (생성한 키)
# Secret Access Key: (생성한 비밀 키)
# Default region: ap-northeast-2
# Output format: json

# 연결 확인
aws sts get-caller-identity
```

**ECR 푸시:**
```bash
cd ~/workspace/task-flow
./scripts/ecr-push.sh ap-northeast-2
```

> **액세스 키가 필요한 이유:** 콘솔은 브라우저 로그인, WSL에서 AWS 서비스 접근은 액세스 키로 인증합니다.
>
> **⚠️ 보안:** 액세스 키를 절대 GitHub에 올리면 안 됩니다.

---

## 3단계: 서버 + 서비스 띄우기

> **이 단계의 목표:** 실제로 컨테이너를 실행하고 인터넷에서 접속 가능하게 만듭니다.

####  ECS Cluster + EC2 생성

**경로:** 콘솔 검색 → ECS → 클러스터 → 클러스터 생성

**ECS Cluster란?** Task(컨테이너)를 실행하는 논리적 묶음입니다. Cluster 자체는 빈 껍데기이고, 안에 EC2를 등록하면 그 위에서 Task가 실행됩니다.

| 항목 | 값 | 이유 |
|---|---|---|
| 이름 | `taskflow-cluster` | |
| 인프라 | Amazon EC2 인스턴스 (Fargate 해제) | EC2 관리 경험이 학습 목표 |
| ASG | 새 Auto Scaling 그룹 생성 | EC2 수를 자동 관리 |
| OS | Amazon Linux 2023 | ECS Agent 사전 설치된 최적화 AMI |
| 인스턴스 유형 | **t3.small** | ENI 최대 3개 (2 Service 분리에 필요한 최소 스펙) |
| 용량 | 최소 1, 최대 1 | EC2 1대 고정 |
| SSH 키 | 없음 | Session Manager로 대체 가능 |
| VPC | `taskflow-vpc` | |
| 서브넷 | `taskflow-private-a` 만 | EC2를 Private에 배치 (보안) |
| 보안 그룹 | `taskflow-ecs-sg` | ← 1-6에서 만든 것 |
| 퍼블릭 IP | 끄기 | Private subnet이므로 불필요 |
| Container Insights | 꺼짐 | 추가 비용 방지 |

> **ASG(Auto Scaling Group):** EC2 수를 자동 관리합니다. 최소 1, 최대 1이면 항상 1대 유지. EC2가 죽으면 자동으로 새 EC2를 생성합니다. 학습 종료 시 용량을 0으로 바꾸면 EC2가 자동 종료됩니다.
>
> **t3.small인 이유:** ENI 최대 3개 = primary(1) + frontend task(1) + backend task(1). t3.micro는 ENI 2개라 2 Service 분리가 불가능합니다.

####  IAM Role 생성

**경로:** 콘솔 검색 → IAM → 역할 → 역할 생성

**IAM Role이란?** "이 Task는 이런 AWS 서비스에 접근할 수 있다"는 권한 묶음입니다.

**ecsTaskExecutionRole:**

- 신뢰 엔터티: AWS 서비스 → Elastic Container Service → Elastic Container Service Task
- 권한 정책 2개:
  - `AmazonECSTaskExecutionRolePolicy` — ECR 이미지 pull + CloudWatch 로그 전송
  - `AmazonSSMReadOnlyAccess` — SSM Parameter Store에서 DB 정보 읽기

> **이 Role이 없으면:** Task가 ECR에서 이미지를 못 가져오고, SSM에서 비밀번호를 못 읽고, 로그를 못 보냅니다. Task 시작 자체가 실패합니다.

**이 리소스는 어디서 사용되나?** → 3-3 Task Definition의 "태스크 실행 역할"에서 선택

####  Task Definition 2개 생성

**경로:** ECS → 태스크 정의 → 새 태스크 정의 생성

**Task Definition이란?** "이 컨테이너를 이런 설정으로 실행해라"라는 명세서입니다. docker-compose.yml의 각 서비스 설정에 해당합니다.

#### taskflow-backend

| 항목 | 값 | 이유 |
|---|---|---|
| 패밀리 | `taskflow-backend` | |
| 시작 유형 | EC2 (Fargate 해제) | |
| 네트워크 모드 | awsvpc | Task마다 자기 IP, ALB TG(IP target)에 필수 |
| CPU | 0.5 vCPU | |
| 메모리 | 0.75 GB (768MB) | JVM -Xmx512m + 오버헤드 ~256MB |
| 태스크 실행 역할 | ecsTaskExecutionRole | ← 3-2에서 만든 것 |
| 컨테이너 이름 | `backend` | |
| 이미지 URI | `843302972967.dkr.ecr.ap-northeast-2.amazonaws.com/taskflow/backend:7b00354` | ← 2-5에서 푸시한 이미지 |
| 포트 | 8080 TCP | Spring Boot 포트 |

**환경변수:**

| 키 | 값 유형 | 값 | 설명 |
|---|---|---|---|
| SPRING_PROFILES_ACTIVE | 값 | `prod` | 운영 프로필 |
| DB_HOST | ValueFrom | `/taskflow/db/host` | ← SSM에서 가져옴 |
| DB_PORT | ValueFrom | `/taskflow/db/port` | ← SSM에서 가져옴 |
| DB_NAME | ValueFrom | `/taskflow/db/name` | ← SSM에서 가져옴 |
| DB_USER | ValueFrom | `/taskflow/db/user` | ← SSM에서 가져옴 |
| DB_PASSWORD | ValueFrom | `/taskflow/db/password` | ← SSM에서 가져옴 |

> **ValueFrom:** ECS가 Task 시작 시 SSM Parameter Store에서 값을 자동으로 가져와 컨테이너 환경변수로 주입합니다. 비밀번호가 Task Definition에 직접 노출되지 않습니다. 이건 로컬의 docker-compose.yml에서 `environment: DB_HOST=db` 하던 것과 같은 구조입니다.

**로그:** awslogs-group: `/ecs/taskflow-backend`

#### taskflow-frontend

| 항목 | 값 |
|---|---|
| 패밀리 | `taskflow-frontend` |
| CPU | 0.25 vCPU |
| 메모리 | 0.25 GB (256MB) |
| 컨테이너 | `frontend` |
| 이미지 | `843302972967.dkr.ecr.ap-northeast-2.amazonaws.com/taskflow/frontend:7b00354` |
| 포트 | 80 TCP |
| 환경변수 | 없음 (nginx는 불필요) |
| 로그 | `/ecs/taskflow-frontend` |

### 3-4. ALB + Target Group + Listener Rules

**경로:** 콘솔 검색 → EC2 → 로드 밸런싱 → 로드밸런서 → 로드 밸런서 생성 → Application Load Balancer

**ALB란?** 외부 요청의 진입점입니다. URL 경로를 보고 Frontend/Backend로 트래픽을 분배하는 교통 경찰입니다.

#### ALB 생성

| 항목 | 값 | 이유 |
|---|---|---|
| 이름 | `taskflow-alb` | |
| 체계 | 인터넷 경계 (Internet-facing) | 인터넷에서 접근 가능 |
| VPC | `taskflow-vpc` | |
| 매핑 | public-a (2a) + public-b (2b) | ⚠️ Public subnet! Private 선택 시 인터넷 접근 불가 |
| 보안 그룹 | `taskflow-alb-sg` | ← 1-6에서 만든 것. default 제거! |

#### Target Group 2개

TG는 ALB 생성 화면에서 "대상 그룹 생성" 링크로 새 탭에서 만듭니다.

| 이름 | 대상 유형 | 포트 | 헬스체크 경로 | 성공 코드 |
|---|---|---|---|---|
| `taskflow-frontend-tg` | **IP** ⚠️ | 80 | `/` | 200-399 |
| `taskflow-backend-tg` | **IP** ⚠️ | 8080 | `/actuator/health` | 200-399 |

> **⚠️ 대상 유형: IP가 필수!** awsvpc 모드에서 Task가 자체 IP를 받으므로 IP target이어야 합니다. 콘솔 기본값이 Instance이므로 반드시 변경하세요!
>
> **대상 등록 건너뛰기:** ECS Service가 Task 시작 시 자동으로 TG에 IP를 등록합니다.
>
> **헬스체크:** TG가 등록된 타겟의 IP:Port로 직접 요청합니다. ALB Listener rule과 무관합니다.

#### Listener Rules (ALB 생성 후)

ALB 상세 → 리스너 및 규칙 → HTTP:80 → 규칙 관리 → 규칙 추가

| 우선순위 | 이름 | 조건 | 대상 그룹 |
|---|---|---|---|
| 1 | api-rule | 경로 = `/api/*` | taskflow-backend-tg |
| 2 | actuator-rule | 경로 = `/actuator/*` | taskflow-backend-tg |
| 기본 | - | 나머지 모든 요청 | taskflow-frontend-tg |

> **기본 리스너에 Frontend TG:** `/api/*`, `/actuator/*`에 매칭되지 않는 모든 요청(React 앱)은 Frontend로 갑니다.
>
> **`/actuator/*` 규칙은 헬스체크와 무관:** 브라우저에서 `http://ALB_DNS/actuator/health`로 운영 상태를 확인하기 위한 용도입니다. TG 헬스체크는 이 규칙 없이도 동작합니다.

**이 리소스는 어디서 사용되나?** → 3-5 ECS Service 생성 시 로드밸런서 연결

### 3-5. ECS Service 2개 생성

**경로:** ECS → 클러스터 → taskflow-cluster → 서비스 탭 → 생성

**ECS Service란?** Task를 유지/배포하고, ALB Target Group에 자동으로 등록/해제하는 관리자입니다. Task가 죽으면 자동으로 새 Task를 띄워줍니다.

#### taskflow-backend-service

| 항목 | 값 | 이유 |
|---|---|---|
| 패밀리 | taskflow-backend | |
| 서비스 이름 | `taskflow-backend-service` | |
| 원하는 태스크 | 1 | |
| 가용 영역 리밸런싱 | **해제** | AZ-a만 사용, 리밸런싱 불필요 |
| 최소 실행 작업 비율 | **0** | ENI 여유 0이므로 기존 Task를 먼저 내림 |
| 최대 실행 작업 비율 | **100** | 새 Task를 추가로 올리지 않음 |
| 서브넷 | `taskflow-private-a` 만 | EC2가 있는 곳 |
| 보안 그룹 | `taskflow-ecs-sg` | |
| 로드밸런서 | taskflow-alb | |
| 대상 그룹 | `taskflow-backend-tg` | ← 3-4에서 만든 것 |

#### taskflow-frontend-service

Backend와 동일하되:

| 항목 | 값 |
|---|---|
| 패밀리 | taskflow-frontend |
| 서비스 이름 | `taskflow-frontend-service` |
| 대상 그룹 | `taskflow-frontend-tg` |

> **최소 0%, 최대 100%의 의미:**
> - 기본값(100/200)이면 새 Task를 먼저 올리려는데 ENI가 부족하여 PENDING
> - 0/100으로 하면 기존 Task를 먼저 내리고 새 Task를 올림 (수초 다운타임 발생, 학습용 OK)
>
> **가용 영역 리밸런싱 해제:** AZ 간 Task 분배를 하려면 최대가 100 초과여야 하는데, ENI 제약으로 불가. AZ-a만 쓰므로 해제합니다.

---

---

## 4단계: 문제 해결 + 동작 확인

> **이 단계의 목표:** Backend 배포 실패를 해결하고, 전체 시스템이 정상 동작하는지 확인합니다.

#### 헬스체크 유예 기간 변경

**문제:** Backend Service가 배포 실패 상태. Spring Boot는 정상 시작(~46초)되지만, ECS가 Task를 죽이는 반복.

**원인:** ECS Service의 상태 검사 유예 기간(Health Check Grace Period)이 0초. Spring Boot가 아직 로딩 중인데 ALB 헬스체크가 즉시 시작되어 "비정상"으로 판정. 배포 회로 차단기(circuit breaker)가 Task를 중지시키고, 새 Task를 다시 띄우는 무한 루프 발생.

**조치:**

| 서비스 | 변경 항목 | 변경 전 | 변경 후 | 이유 |
|---|---|---|---|---|
| `taskflow-backend-service` | 상태 검사 유예 기간 | 0초 | **120초** | Spring Boot 시작(~46초) + Flyway + JVM 워밍업 + 여유 |
| `taskflow-frontend-service` | 상태 검사 유예 기간 | 0초 | **60초** | nginx는 1~2초면 시작하지만 여유 확보 |

**경로:** ECS → 클러스터 → `taskflow-cluster` → 서비스 탭 → 해당 서비스 → 서비스 업데이트

> **헬스체크 유예 기간이란?** "Task 시작 후 이 시간 동안은 헬스체크 실패를 무시하라"는 설정. JVM 기반 애플리케이션은 Cold Start가 느리기 때문에, 애플리케이션이 완전히 준비될 때까지 기다려주는 버퍼가 필수.
>
> **왜 처음부터 120초로 안 했나?** ECS 콘솔의 기본값이 0이고, Spring Boot 시작 시간을 미리 알기 어려움. 이런 트러블슈팅 과정 자체가 학습 포인트.

#### 강제 새 배포

유예 기간만 변경하면 자동 배포가 시작되지 않을 수 있음. 배포 회로 차단기가 이미 실패로 판정한 상태면 ECS가 새 Task를 시도하지 않음.

**조치:** ECS → 서비스 → `taskflow-backend-service` → 서비스 업데이트 → **"강제 새 배포" 체크** → 업데이트

**결과:** 1~3분 후 정상 배포 완료.

- 서비스 개정(revision)이 2개 표시됨:
  - **"소스" (이전 배포):** 0개 요청됨 / 0개 실행 중 — 실패했던 배포, ECS가 Task를 모두 내린 상태
  - **"대상" (새 배포):** 1개 요청됨 / 1개 실행 중 — 유예 기간 120초 덕분에 성공
- 배포 완료 후 소스 개정은 사라지고 대상 개정만 남음

---

### 4-2. 전체 동작 확인

####  ALB DNS 확인

**경로:** EC2 → 로드밸런싱 → 로드밸런서 → `taskflow-alb` → DNS 이름 복사

**DNS:** `taskflow-alb-1790501168.ap-northeast-2.elb.amazonaws.com`

####  확인 결과

| URL | 결과 | 검증 내용 |
|---|---|---|
| `http://ALB_DNS/actuator/health` | `{"status":"UP"}` | ALB → Backend TG → Spring Boot Actuator 정상 |
| `http://ALB_DNS/` (→ `/tasks`) | React UI 정상 표시 | ALB → Frontend TG → nginx → React SPA 정상 |
| `http://ALB_DNS/api/tasks` | JSON 응답 (태스크 목록) | ALB → Backend TG → Spring Boot → RDS 전체 경로 정상 |

####  CRUD 테스트

브라우저에서 React UI를 통해 생성/조회/수정/삭제 전체 흐름 확인 완료.

---

## 5단계: CloudWatch Logs

> **이 단계의 목표:** 로컬에서 `docker compose logs`로 보던 로그를 AWS에서는 CloudWatch로 확인합니다.

####  로그 그룹 확인

**경로:** 콘솔 검색 → CloudWatch → 로그 그룹

| 로그 그룹 | 내용 | 생성 방식 |
|---|---|---|
| `/ecs/taskflow-backend` | Spring Boot 로그 (JSON 구조화) | ECS가 자동 생성 |
| `/ecs/taskflow-frontend` | nginx access log | ECS가 자동 생성 |

> **자동 생성 원리:** Task Definition에서 awslogs-group을 지정하면, ECS 콘솔이 `awslogs-create-group: true` 옵션을 자동 포함. `ecsTaskExecutionRole`의 `AmazonECSTaskExecutionRolePolicy`에 `logs:CreateLogGroup` 권한이 있어서 Task가 처음 실행될 때 로그 그룹이 자동 생성됨.
>
> **로그 그룹과 Task 매핑 확인:** ECS → 태스크 정의 → 해당 Task Definition → 최신 개정 → 컨테이너 정의 → 로그 구성에서 `awslogs-group`, `awslogs-region`, `awslogs-stream-prefix` 확인 가능.

####  Backend 로그 (JSON 구조화)

prod 프로필에서 JSON 구조화 로그가 정상 출력됨. CloudWatch Logs Insights에서 필드별 쿼리 가능.

```json
{
  "@timestamp": "2026-03-08T04:48:30.711681659Z",
  "message": "HTTP GET /api/tasks 200 10ms",
  "logger_name": "com.taskflow.filter.RequestLoggingFilter",
  "level": "INFO",
  "http_method": "GET",
  "uri": "/api/tasks",
  "status": 200,
  "latency_ms": 10
}
```

####  Frontend 로그 (nginx access log)

nginx의 기본 access log 형식. ALB 헬스체크 로그도 포함됨.

```
10.0.1.91 - - [08/Mar/2026:04:47:47 +0000] "GET / HTTP/1.1" 200 455 "-" "ELB-HealthChecker/2.0" "-"
10.0.2.142 - - [08/Mar/2026:04:47:27 +0000] "GET / HTTP/1.1" 200 455 "-" "ELB-HealthChecker/2.0" "-"
```

> **두 IP의 정체:** `10.0.1.91`은 ALB의 public-a 노드, `10.0.2.142`는 public-b 노드. ALB 생성 시 public-a, public-b 두 서브넷에 매핑했기 때문에 양쪽 노드가 독립적으로 헬스체크를 수행. nginx Task는 private-a에만 있지만, ALB 양쪽 노드가 같은 Target Group의 IP로 직접 헬스체크를 보냄.

### 5-4. 보존 기간 설정

**조치:** 두 로그 그룹 모두 보존 기간을 **7일**로 변경

**경로:** CloudWatch → 로그 그룹 → 선택 → 작업 → 보존 기간 편집 → 7일

> **왜?** 기본값이 "만료 없음(영구 보관)"이라 로그가 무한히 쌓임. 학습용에서는 7일이면 충분하고 스토리지 비용 절약.

---


---

## 6단계: GitHub Actions CI/CD

> **이 단계의 목표:** `git push` 한 번으로 Docker 빌드 → ECR 푸시 → ECS 배포를 자동화합니다.

####  브랜치 분리

```bash
git checkout -b develop
git push -u origin develop
```

- `develop`: 개발 브랜치
- `master`: 배포 브랜치 (merge 시 자동 배포)

####  GitHub Secrets 등록

**경로:** GitHub 레포 → Settings → Secrets and variables → Actions → New repository secret

| Name | 값 | 설명 |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | (액세스 키) | AWS CLI 인증 |
| `AWS_SECRET_ACCESS_KEY` | (비밀 키) | AWS CLI 인증 |
| `AWS_ACCOUNT_ID` | `843302972967` | ECR URI 구성에 사용 (고정값, 변경 안 됨) |

> **Repository secrets vs Environment secrets:** Environment secrets는 staging/production 같은 배포 환경을 분리할 때 사용. 학습용에서는 Repository secrets로 충분.

####  워크플로우 파일 생성

**파일:** `.github/workflows/deploy.yml`

**트리거:** `master` 브랜치 push 시 + workflow_dispatch (수동 트리거)

**파이프라인 흐름:**
1. 코드 체크아웃
2. 이미지 태그 설정 (git short hash)
3. AWS 자격 증명 설정 (GitHub Secrets)
4. Amazon ECR 로그인
5. Backend 이미지 빌드 → ECR 푸시 (태그: git hash + latest)
6. Backend 이미지 푸시
7. Frontend 이미지 빌드 (build arg: `NGINX_CONF=nginx-aws.conf`) → ECR 푸시
8. Frontend 이미지 푸시
9. Backend ECS 서비스 배포 (`aws ecs update-service --force-new-deployment`)
10. Frontend ECS 서비스 배포

**총 소요 시간:** 약 1분 42초

####  Task Definition 이미지 태그 변경

**문제:** Task Definition의 이미지 URI가 `:7b00354` (특정 git hash)로 고정되어 있어서, CI/CD에서 새 이미지를 푸시해도 ECS가 옛날 태그를 참조.

**조치:** Task Definition 새 개정 생성 시 이미지 태그를 `:latest`로 변경.

| Task Definition | 변경 전 | 변경 후 |
|---|---|---|
| `taskflow-backend` | `...taskflow/backend:7b00354` | `...taskflow/backend:latest` |
| `taskflow-frontend` | `...taskflow/frontend:7b00354` | `...taskflow/frontend:latest` |

**경로:** ECS → 태스크 정의 → 최신 리비전 선택 → "새 개정 생성" → 이미지 URI 변경

> **`:latest` 태그의 트레이드오프:** 편리하지만 어떤 커밋의 코드가 실행 중인지 추적이 어려움. 실무에서는 CI/CD 파이프라인 안에서 Task Definition 자체를 새 git hash 태그로 업데이트하는 방식을 사용. 학습 단계에서는 `:latest`로 충분.

### 6-5. 배포 확인

`develop` → `master` merge 시 GitHub Actions가 자동 실행되어 ECR 이미지 빌드/푸시 및 ECS Service 업데이트가 정상 완료됨.

---


---

## 7단계: 추가 설정

> **이 단계의 목표:** 운영 편의를 위한 추가 설정을 진행합니다.

### 7-1. nginx 헬스체크 로그 제외

####  문제

Frontend CloudWatch Logs에 ALB 헬스체크 로그가 30초마다 찍혀 실제 사용자 요청 로그가 묻힘.

####  조치

`frontend/nginx-aws.conf`에 헬스체크 로그 필터링 추가:

```nginx
# ALB 헬스체크 로그 제외 (User-Agent: ELB-HealthChecker/2.0)
map $http_user_agent $loggable {
    ~ELB-HealthChecker  0;
    default             1;
}

server {
    listen 80;
    server_name _;

    access_log /var/log/nginx/access.log combined if=$loggable;

    # React 정적 파일 + SPA fallback (ALB가 API 라우팅 담당)
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

> **`map` 디렉티브:** User-Agent 헤더에 `ELB-HealthChecker`가 포함된 요청은 `$loggable=0`(로그 안 찍음), 나머지는 `$loggable=1`(로그 찍음).
>
> **`nginx-local.conf`는 변경 안 함:** 로컬에는 ALB 헬스체크가 없으므로 불필요.

####  반영

`develop`에서 변경 → `master` merge → GitHub Actions 자동 배포로 반영 완료.

---

### 7-2. EC2 Session Manager 접속 설정

####  문제

EC2 → 인스턴스 → 연결 → SSM Session Manager 탭에서 "오프라인" 상태.

에러: `SSM Agent unable to acquire credentials: no valid credentials could be retrieved for ec2 identity. AccessDeniedException: Systems Manager's instance management role is not configured`

####  원인

EC2의 IAM Role(`ecsInstanceRole`)에 SSM 관련 권한이 없음. ECS 클러스터 생성 시 자동으로 만들어진 이 Role에는 `AmazonEC2ContainerServiceforEC2Role`(ECS 관련) 권한만 있었음.

####  조치

**경로:** IAM → 역할 → `ecsInstanceRole` → 권한 추가 → 정책 연결

**추가한 정책:** `AmazonSSMManagedInstanceCore`

이 정책이 EC2에게 SSM 서비스와 통신할 수 있는 권한을 부여.

**정책 추가 후 EC2 재부팅 필요:**

**경로:** EC2 → 인스턴스 → 해당 인스턴스 → 인스턴스 상태 → 인스턴스 재부팅

> **재부팅 시 주의:** ASG에 속한 인스턴스라는 경고가 표시되지만, Reboot은 안전함. Terminate(종료)와 달리 인스턴스를 그대로 유지하면서 OS만 다시 시작. 다만 재부팅 중 ECS Task들이 잠시 중단됨 (ECS가 자동으로 다시 띄워줌).

####  결과

`ecsInstanceRole`의 최종 권한 정책:

| 정책 | 용도 |
|---|---|
| `AmazonEC2ContainerServiceforEC2Role` | ECS Agent가 클러스터와 통신 |
| `AmazonSSMManagedInstanceCore` | Session Manager 접속 허용 |

재부팅 후 SSM Session Manager Ping status가 "온라인"으로 변경, 브라우저에서 EC2 터미널 접속 가능.

> **Session Manager의 장점:** SSH 키 불필요, Private subnet EC2에도 접속 가능 (NAT Gateway를 통해 SSM 서비스 엔드포인트에 연결).

---


---

## 8단계: EC2 내부 탐색 (Session Manager)

> **이 단계의 목표:** EC2에 접속하여 컨테이너, 메모리, 네트워크 등 실제 환경을 탐색합니다.

### 8-1. Docker 컨테이너 확인

```bash
sudo docker ps -a
```

> **`sudo` 필요:** Session Manager는 `ssm-user`로 로그인되며, docker 그룹에 미포함.

**확인 결과:**
- 실행 중: frontend(nginx), backend(Spring Boot), ecs-agent, 각 Task의 pause 컨테이너
- 종료됨(Exited): 이전 배포의 컨테이너들 (`:7b00354` 태그 등)

> **종료된 컨테이너 자동 정리:** ECS Agent가 `ECS_ENGINE_TASK_CLEANUP_WAIT_DURATION` 설정에 따라 자동 정리. 현재 설정 파일(`/etc/ecs/ecs.config`)에 해당 항목이 없으므로 기본값 3시간 적용. 수동 정리: `sudo docker container prune`

> **EC2에 소스 코드는 없음:** Docker 이미지(바이너리 레이어)와 그 위에서 돌아가는 컨테이너만 존재. GitHub → GitHub Actions 빌드 → ECR 이미지 저장 → ECS가 pull → EC2에서 컨테이너 실행.

### 8-2. 메모리 사용량

```bash
free -h
```

| 항목 | 값 |
|---|---|
| total | 1.9GB (t3.small 스펙) |
| used | 738MB |
| free | 286MB |
| buff/cache | 888MB |
| available | 1.0GB |

> **JVM 메모리 설정 근거:** 2GB 중 OS + Docker + containerd + ECS Agent + 컨테이너들이 나눠 사용. JVM `-Xmx512m` + 오버헤드 ≈ 600MB가 대부분을 차지. 이보다 크게 잡으면 OOM Kill 위험.

### 8-3. 네트워크 인터페이스

```bash
ip addr
```

| 인터페이스 | IP | 용도 |
|---|---|---|
| `ens5` | `10.0.11.48/24` | EC2 primary ENI (private-a 서브넷) |
| `docker0` | `172.17.0.1/16` | Docker 기본 브리지 (사용 안 함) |
| `ecs-bridge` | `169.254.172.1/22` | ECS 내부 통신용 브리지 |

> **awsvpc 모드에서 ENI:** `ip addr`에는 EC2의 primary ENI만 보임. Task별 ENI는 네트워크 네임스페이스로 격리되어 있어 호스트에서 직접 보이지 않음. AWS 콘솔의 EC2 → 네트워크 인터페이스에서 확인 가능.

### 8-4. NAT Gateway 아웃바운드 확인

```bash
curl -s https://checkip.amazonaws.com
```

**결과:** `43.201.145.189`

이 IP가 NAT Gateway의 탄력적 IP임을 EC2 → 네트워크 및 보안 → 탄력적 IP에서 확인 가능. Private subnet의 EC2가 인터넷으로 나갈 때 `EC2 → NAT Gateway → IGW → 인터넷` 경로를 타며, 외부에서 보면 출발지 IP가 NAT의 탄력적 IP로 표시됨.

---


---

## 현재 상태 요약

| 항목 | 상태 |
|---|---|
| VPC + 서브넷 + IGW + NAT + 라우팅 | ✅ 완료 |
| 보안 그룹 3개 | ✅ 완료 |
| RDS | ✅ 사용 가능 |
| SSM Parameter Store | ✅ 5개 등록 |
| ECR + 이미지 푸시 | ✅ 완료 |
| ECS Cluster + EC2 | ✅ 활성 |
| IAM Role | ✅ 생성 (ecsTaskExecutionRole + ecsInstanceRole) |
| Task Definition | ✅ 2개 (이미지 태그 `:latest`) |
| ALB + TG + Rules | ✅ 완료 |
| Frontend Service | ✅ 정상 (1/1 실행 중) |
| Backend Service | ✅ 정상 (1/1 실행 중, 유예 기간 120초) |
| ALB → React UI | ✅ 정상 |
| ALB → API → RDS | ✅ 정상 |
| ALB → Actuator | ✅ `{"status":"UP"}` |
| CloudWatch Logs | ✅ 보존 7일 설정 |
| GitHub Actions CI/CD | ✅ `master` merge 시 자동 배포 |
| nginx 헬스체크 로그 | ✅ 제외 완료 |
| EC2 Session Manager | ✅ 접속 가능 |
| CRUD 전체 흐름 | ✅ 확인 완료 |

---

## 부록 A: 생성한 리소스 전체 목록

### 초기 구성 리소스

| 리소스 | 이름/식별자 | 과금 여부 | 삭제 시 주의 |
|---|---|---|---|
| VPC | taskflow-vpc | 무료 | |
| 서브넷 4개 | taskflow-public-a/b, private-a/b | 무료 | |
| 인터넷 게이트웨이 | taskflow-igw | 무료 | |
| NAT Gateway | taskflow-nat | **~$33/월** | 삭제만 가능 (Stop 없음) |
| 탄력적 IP | (NAT에 연결됨) | **시간당 과금** | NAT 삭제 후 별도 반납(Release) |
| 라우팅 테이블 2개 | taskflow-rt-public, rt-private | 무료 | |
| 보안 그룹 3개 | taskflow-alb-sg, ecs-sg, rds-sg | 무료 | |
| RDS | taskflow-db (db.t4g.micro) | **~$17/월** | Stop 후 7일 자동 재시작 |
| SSM Parameter Store | /taskflow/db/* (5개) | 무료 | |
| ECR 레포 2개 | taskflow/frontend, backend | 500MB까지 무료 | |
| ECS Cluster | taskflow-cluster | 무료 (EC2에 과금) | |
| EC2 (ASG) | t3.small 1대 | **~$19/월** | |
| EBS 볼륨 | 30GiB (EC2 루트) | ~$2.4/월 | EC2 종료해도 남을 수 있음 |
| IAM Role | ecsTaskExecutionRole | 무료 | |
| Task Definition 2개 | taskflow-frontend/backend | 무료 | |
| ALB | taskflow-alb | **~$20/월** | 삭제만 가능 (Stop 없음) |
| Target Group 2개 | taskflow-frontend-tg, backend-tg | 무료 (ALB에 포함) | |
| ECS Service 2개 | frontend-service, backend-service | 무료 (EC2에 과금) | |

### 이후 변경/추가 리소스

| 리소스 | 변경 내용 | 비용 |
|---|---|---|
| ECS Service (backend) | 헬스체크 유예 기간 0 → 120초 | 무료 |
| ECS Service (frontend) | 헬스체크 유예 기간 0 → 60초 | 무료 |
| Task Definition (backend) | 이미지 태그 `:7b00354` → `:latest` | 무료 |
| Task Definition (frontend) | 이미지 태그 `:7b00354` → `:latest` | 무료 |
| IAM Role (ecsInstanceRole) | `AmazonSSMManagedInstanceCore` 추가 | 무료 |
| CloudWatch Logs | 보존 기간 7일 설정 | 비용 절감 |
| GitHub Actions | `.github/workflows/deploy.yml` 추가 | 무료 (public 레포) |
| GitHub Secrets | 3개 등록 | 무료 |
| nginx-aws.conf | 헬스체크 로그 필터링 추가 | 무료 |

---


---

## 부록 B: 리소스 정리 (학습 종료 시)

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

---

## 부록 C: 트러블슈팅 가이드

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

---

## 부록 D: 학습 포인트 정리

| 주제 | 핵심 내용 |
|---|---|
| 헬스체크 유예 기간 | JVM 앱은 Cold Start가 느려서 유예 기간이 필수. 기본값 0초는 Spring Boot에 부적합 |
| 강제 새 배포 | 회로 차단기가 실패 상태로 고정되면 수동으로 강제 배포 필요 |
| ALB 다중 AZ 노드 | ALB는 매핑된 각 AZ에 노드를 갖고, 양쪽에서 독립적으로 헬스체크 수행 |
| ECS 로그 그룹 자동 생성 | `awslogs-create-group: true` + IAM 권한으로 Task 첫 실행 시 자동 생성 |
| `:latest` 태그 | 편리하지만 커밋 추적 어려움. 실무에서는 CI/CD에서 Task Definition까지 업데이트 |
| Session Manager vs SSH | Private subnet EC2에 SSH 키 없이 접속 가능. IAM 권한만 필요 |
| 컨테이너 환경변수 격리 | SSM에서 주입된 DB 정보는 컨테이너 안에서만 보임. 호스트에서는 안 보임 |
| NAT Gateway IP | Private EC2의 아웃바운드 트래픽은 NAT의 탄력적 IP로 나감 |
| 메모리 계획 | t3.small 2GB에서 JVM + OS + Docker가 나눠 사용. `-Xmx512m`이 상한선 |
| 종료된 컨테이너 정리 | ECS Agent가 기본 3시간 후 자동 정리 |
