package com.taskflow.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * HTTP 요청/응답 로깅 필터.
 * method, URI, 상태 코드, 처리 시간을 기록한다.
 * Actuator 경로는 로깅에서 제외한다.
 */
@Component
@Slf4j
public class RequestLoggingFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain)
            throws ServletException, IOException {

        long startTime = System.currentTimeMillis();

        try {
            filterChain.doFilter(request, response);
        } finally {
            long duration = System.currentTimeMillis() - startTime;
            log.atInfo()
                    .addKeyValue("http_method", request.getMethod())
                    .addKeyValue("uri", request.getRequestURI())
                    .addKeyValue("status", response.getStatus())
                    .addKeyValue("latency_ms", duration)
                    .log("HTTP {} {} {} {}ms",
                            request.getMethod(),
                            request.getRequestURI(),
                            response.getStatus(),
                            duration);
        }
    }

    /**
     * Actuator 경로(/actuator/**)는 로깅에서 제외한다.
     * ALB 헬스체크가 30초 간격으로 호출하여 로그가 과도하게 쌓이는 것을 방지한다.
     */
    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        return request.getRequestURI().startsWith("/actuator");
    }
}
