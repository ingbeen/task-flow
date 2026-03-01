package com.taskflow.dto;

import com.taskflow.entity.TaskPriority;
import com.taskflow.entity.TaskStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

@Getter
@Setter
public class TaskCreateRequest {

    @NotBlank(message = "Title is required")
    @Size(max = 255, message = "Title must be 255 characters or less")
    private String title;

    private String description;

    private TaskStatus status;      // 기본값: TODO (Service에서 처리)

    private TaskPriority priority;  // 기본값: MEDIUM (Service에서 처리)

    private LocalDate dueDate;
}
