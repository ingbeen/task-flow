package com.taskflow.exception;

import lombok.Getter;

/**
 * 요청한 Task를 찾을 수 없을 때 발생하는 예외.
 */
@Getter
public class TaskNotFoundException extends RuntimeException {

    private final Long taskId;

    public TaskNotFoundException(Long taskId) {
        super("태스크를 찾을 수 없습니다: " + taskId);
        this.taskId = taskId;
    }
}
