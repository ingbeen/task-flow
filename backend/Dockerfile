# ========================================
# Stage 1: Gradle build
# ========================================
FROM eclipse-temurin:17-jdk AS builder

WORKDIR /app

# 1. Gradle wrapper + 빌드 설정 (의존성 캐시 레이어)
COPY gradlew settings.gradle build.gradle ./
COPY gradle/ gradle/
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon

# 2. 소스 코드 복사 + 빌드
COPY src/ src/
RUN ./gradlew bootJar --no-daemon -x test

# ========================================
# Stage 2: JRE runtime
# ========================================
FROM eclipse-temurin:17-jre

WORKDIR /app

# 비root 사용자 생성
RUN groupadd -r spring && useradd -r -g spring spring

# 빌드 결과물 복사
COPY --from=builder /app/build/libs/*.jar app.jar

# 소유권 변경 + 사용자 전환
RUN chown spring:spring app.jar
USER spring

# JVM 메모리 설정 (ECS Task Definition memory 768MB 기준)
ENV JAVA_OPTS="-Xms256m -Xmx512m"

EXPOSE 8080

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
