# AWS 리소스 정리 기록

> **목적:** AWS 학습 종료 후 모든 리소스를 삭제하고 과금을 중단하기 위한 정리 기록
> **실행일:** 2026년 3월 11일
> **원칙:** 의존 관계 역순으로 삭제 (과금 리소스 우선, 무료 리소스 후순위)

---

## 삭제 순서 및 실행 내역

### 과금 리소스 (우선 삭제)

| 순서 | 리소스 | 경로 | 조치 | 월 비용 |
|------|--------|------|------|--------|
| 1 | ECS Service 2개 | ECS → 클러스터 → taskflow-cluster → 서비스 | 원하는 태스크 0 → Task 내려간 후 삭제 | - |
| 2 | ALB | EC2 → 로드밸런서 → taskflow-alb | 삭제 (Stop 불가) | ~$20/월 |
| 3 | NAT Gateway | VPC → NAT 게이트웨이 → taskflow-nat | 삭제 (Stop 불가, Deleted 상태 대기) | ~$33/월 |
| 4 | 탄력적 IP | EC2 → 탄력적 IP | 2개 모두 릴리스 (NAT 삭제해도 자동 반납 안 됨) | 시간당 과금 |
| 5 | ECS Cluster | ECS → 클러스터 → taskflow-cluster | 클러스터 삭제 (ASG + EC2 함께 정리됨) | ~$19/월 |
| 6 | EC2 인스턴스 확인 | EC2 → 인스턴스 | terminated 상태 확인 | - |
| 7 | EBS 볼륨 확인 | EC2 → 볼륨 | available 상태 볼륨 삭제 | ~$2.4/월 |
| 8 | RDS | RDS → taskflow-db | 삭제 (스냅샷 생성 해제, 백업 보존 해제) | ~$17/월 |

### 무료 리소스 (이후 삭제)

| 순서 | 리소스 | 경로 | 조치 |
|------|--------|------|------|
| 9 | Target Group 2개 | EC2 → 대상 그룹 | taskflow-frontend-tg, backend-tg 삭제 |
| 10 | ECR 리포지토리 2개 | ECR → 리포지토리 | 이미지 전체 삭제 → 리포지토리 삭제 |
| 11 | CloudWatch 로그 그룹 | CloudWatch → 로그 그룹 | /ecs/taskflow-backend, frontend 삭제 |
| 12 | SSM Parameter Store | Systems Manager → 파라미터 스토어 | /taskflow/db/* 5개 삭제 |
| 13 | Task Definition 2개 | ECS → 태스크 정의 | 모든 개정 등록 해제 → 삭제 |
| 14 | IAM Role | IAM → 역할 | ecsTaskExecutionRole, ecsInstanceRole 삭제 |
| 15 | 보안 그룹 3개 | VPC → 보안 그룹 | rds-sg → ecs-sg → alb-sg 순서로 삭제 (참조 관계) |
| 16 | RDS 서브넷 그룹 | RDS → 서브넷 그룹 | taskflow-db-subnet-group 삭제 |
| 17 | 라우팅 테이블 2개 | VPC → 라우팅 테이블 | 서브넷 연결 해제 후 삭제 (rt-private, rt-public) |
| 18 | 서브넷 4개 | VPC → 서브넷 | 4개 전체 삭제 |
| 19 | IGW | VPC → 인터넷 게이트웨이 | VPC에서 분리 → 삭제 |
| 20 | VPC | VPC → VPC | taskflow-vpc 삭제 (기본 VPC는 유지) |

---

## 삭제 확인 결과

| 확인 항목 | 경로 | 결과 |
|----------|------|------|
| EC2 인스턴스 | EC2 → 인스턴스 | ✅ 인스턴스 없음 |
| 로드밸런서 | EC2 → 로드밸런서 | ✅ 로드밸런서 없음 |
| 대상 그룹 | EC2 → 대상 그룹 | ✅ 대상 그룹 없음 |
| 탄력적 IP | EC2 → 탄력적 IP | ✅ 0개 |
| EBS 볼륨 | EC2 → 볼륨 | ✅ 볼륨 없음 |
| VPC | VPC → VPC | ✅ 기본 VPC(172.31.0.0/16)만 남음 |
| NAT Gateway | VPC → NAT 게이트웨이 | ✅ 없음 |
| ECS Cluster | ECS → 클러스터 | ✅ 클러스터 없음 (0) |
| Task Definition | ECS → 태스크 정의 | ✅ 태스크 정의 없음 (0) |
| RDS | RDS → 데이터베이스 | ✅ 리소스 없음 (0) |
| ECR | ECR → 리포지토리 | ✅ 리포지토리 없음 |
| SSM Parameter Store | Systems Manager → 파라미터 스토어 | ✅ 파라미터 없음 |
| CloudWatch Logs | CloudWatch → 로그 그룹 | ✅ 로그 그룹 없음 (0) |
| IAM Role | IAM → 역할 | ✅ AWSServiceRoleFor* 7개만 남음 (AWS 자동 생성, 삭제 불필요) |

---

## 최종 확인

- **크레딧 확인:** 과금 정보 및 비용 관리 → 크레딧에서 하루 뒤 소진 중단 확인 필요
- **남아있는 IAM 역할 7개:** AWSServiceRoleForAutoScaling, AWSServiceRoleForECS, AWSServiceRoleForElasticLoadBalancing, AWSServiceRoleForRDS, AWSServiceRoleForResourceExplorer, AWSServiceRoleForSupport, AWSServiceRoleForTrustedAdvisor — 전부 AWS가 서비스 사용 시 자동 생성한 역할이며 비용 없음, 삭제 불필요

---

## 참고: 삭제한 리소스 전체 비용 요약

| 리소스 | 월 비용 |
|--------|--------|
| NAT Gateway | ~$33 |
| ALB | ~$20 |
| EC2 (t3.small) | ~$19 |
| RDS (db.t4g.micro) | ~$17 |
| EBS (30GiB) | ~$2.4 |
| **합계** | **~$91/월** |
