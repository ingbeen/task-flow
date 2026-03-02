package com.taskflow.dto;

import lombok.Getter;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 표준 에러 응답 DTO.
 * 모든 에러 응답은 이 포맷으로 반환된다.
 */
@Getter
public class ErrorResponse {

    private int status;
    private String code;
    private String message;
    private List<FieldError> fieldErrors;
    private LocalDateTime timestamp;

    /**
     * 일반 에러 응답 생성.
     */
    public static ErrorResponse of(int status, String code, String message) {
        ErrorResponse response = new ErrorResponse();
        response.status = status;
        response.code = code;
        response.message = message;
        response.fieldErrors = null;
        response.timestamp = LocalDateTime.now();
        return response;
    }

    /**
     * Validation 에러 응답 생성.
     * 필드별 에러 목록을 포함한다.
     */
    public static ErrorResponse of(int status, String code, String message,
                                   List<FieldError> fieldErrors) {
        ErrorResponse response = new ErrorResponse();
        response.status = status;
        response.code = code;
        response.message = message;
        response.fieldErrors = fieldErrors;
        response.timestamp = LocalDateTime.now();
        return response;
    }

    /**
     * Validation 필드별 에러 정보.
     */
    @Getter
    public static class FieldError {

        private String field;
        private String message;

        public static FieldError of(String field, String message) {
            FieldError error = new FieldError();
            error.field = field;
            error.message = message;
            return error;
        }
    }
}
