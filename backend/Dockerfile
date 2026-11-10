# 後端容器映像。建置 context 必須是專案根目錄（backend/gradlew 會呼叫 android/gradlew）：
#   docker build -f backend/Dockerfile .

# ---- 建置階段：用與本機相同的 Gradle wrapper 打包 Spring Boot jar ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY android/gradlew android/gradlew
COPY android/gradle/wrapper android/gradle/wrapper
COPY backend/gradlew backend/build.gradle backend/settings.gradle backend/
RUN chmod +x android/gradlew backend/gradlew \
 && backend/gradlew --no-daemon -q dependencies > /dev/null
COPY backend/src backend/src
# 測試在本機與 CI 執行；這裡只打包
RUN backend/gradlew --no-daemon -q bootJar \
 && cp "$(ls backend/build/libs/*.jar | grep -v -- '-plain.jar$')" /workspace/app.jar

# ---- 執行階段：只放 JRE 與 jar，以非 root 使用者執行 ----
FROM eclipse-temurin:21-jre
RUN groupadd --system app && useradd --system --gid app --no-create-home app
WORKDIR /app
COPY --from=build /workspace/app.jar app.jar
USER app
# 依容器記憶體上限分配 heap；記憶體不足時直接結束讓平台重啟，而不是卡住
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
EXPOSE 10000
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
