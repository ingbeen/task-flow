# AWS 배포 진행 기록 — TaskFlow 프로젝트

> **목적:** AWS 회원가입부터 ECS Service 생성까지 진행한 모든 과정을 학습용으로 정리
> **대상:** AWS 완전 초보자
> **원칙:** "무조건 따라하기"가 아닌, 왜 이렇게 하는지 이해하면서 진행

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
> **온보딩 크레딧:** 이 활동을 완료하면 $20 추가 크레딧을 받을 수 있습니다.

### 0-6. 크레딧 확인

**경로:** 과금 정보 및 비용 관리 → 크레딧

**확인 포인트:**
- 남은 총 금액 (가입 $100 + 온보딩 $20 = $120 확인)
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

### 2-1. RDS 서브넷 그룹 생성

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

### 2-2. RDS MySQL 생성

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

### 2-3. SSM Parameter Store 등록

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
./scripts/ecr-push.sh 843302972967 ap-northeast-2
```

> **액세스 키가 필요한 이유:** 콘솔은 브라우저 로그인, WSL에서 AWS 서비스 접근은 액세스 키로 인증합니다.
>
> **⚠️ 보안:** 액세스 키를 절대 GitHub에 올리면 안 됩니다.

---

## 3단계: 서버 + 서비스 띄우기

> **이 단계의 목표:** 실제로 컨테이너를 실행하고 인터넷에서 접속 가능하게 만듭니다.

### 3-1. ECS Cluster + EC2 생성

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

### 3-2. IAM Role 생성

**경로:** 콘솔 검색 → IAM → 역할 → 역할 생성

**IAM Role이란?** "이 Task는 이런 AWS 서비스에 접근할 수 있다"는 권한 묶음입니다.

**ecsTaskExecutionRole:**

- 신뢰 엔터티: AWS 서비스 → Elastic Container Service → Elastic Container Service Task
- 권한 정책 2개:
  - `AmazonECSTaskExecutionRolePolicy` — ECR 이미지 pull + CloudWatch 로그 전송
  - `AmazonSSMReadOnlyAccess` — SSM Parameter Store에서 DB 정보 읽기

> **이 Role이 없으면:** Task가 ECR에서 이미지를 못 가져오고, SSM에서 비밀번호를 못 읽고, 로그를 못 보냅니다. Task 시작 자체가 실패합니다.

**이 리소스는 어디서 사용되나?** → 3-3 Task Definition의 "태스크 실행 역할"에서 선택

### 3-3. Task Definition 2개 생성

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

## 현재 상태 요약

| 리소스 | 상태 | 비고 |
|---|---|---|
| VPC + 서브넷 + IGW + NAT + 라우팅 | ✅ 완료 | |
| 보안 그룹 3개 | ✅ 완료 | |
| RDS | ✅ 사용 가능 | |
| SSM Parameter Store | ✅ 5개 등록 | |
| ECR + 이미지 푸시 | ✅ 완료 | 태그: 7b00354 |
| ECS Cluster + EC2 | ✅ 활성 | 인스턴스 1대 |
| IAM Role | ✅ 생성 | |
| Task Definition | ✅ 2개 | |
| ALB + TG + Rules | ✅ 완료 | |
| Frontend Service | ✅ 1/1 실행 중 | 정상 |
| Backend Service | ❌ 배포 실패 | 헬스체크 타임아웃 — 다음 문서에서 해결 |

---

## 생성한 리소스 전체 목록 (정리 시 참고)

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
