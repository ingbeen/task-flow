package com.taskflow.service;

import com.taskflow.dto.PageResponse;
import com.taskflow.dto.TaskCreateRequest;
import com.taskflow.dto.TaskResponse;
import com.taskflow.dto.TaskUpdateRequest;
import com.taskflow.entity.Task;
import com.taskflow.entity.TaskPriority;
import com.taskflow.entity.TaskStatus;
import com.taskflow.exception.TaskNotFoundException;
import com.taskflow.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class TaskService {

    private final TaskRepository taskRepository;

    public PageResponse<TaskResponse> getTasks(
            TaskStatus status,
            TaskPriority priority,
            String keyword,
            int page,
            int size,
            String sort) {

        Sort sortObj = parseSortParameter(sort);
        Pageable pageable = PageRequest.of(page, size, sortObj);

        Page<Task> taskPage = taskRepository.findByFilters(status, priority, keyword, pageable);
        Page<TaskResponse> responsePage = taskPage.map(TaskResponse::from);

        return PageResponse.from(responsePage);
    }

    @Transactional
    public TaskResponse createTask(TaskCreateRequest request) {
        Task task = new Task();
        task.setTitle(request.getTitle());
        task.setDescription(request.getDescription());
        task.setStatus(request.getStatus() != null ? request.getStatus() : TaskStatus.TODO);
        task.setPriority(request.getPriority() != null ? request.getPriority() : TaskPriority.MEDIUM);
        task.setDueDate(request.getDueDate());

        Task saved = taskRepository.save(task);
        return TaskResponse.from(saved);
    }

    @Transactional
    public TaskResponse updateTask(@NonNull Long id, TaskUpdateRequest request) {
        Task task = taskRepository.findById(id)
                .orElseThrow(() -> new TaskNotFoundException(id));

        task.setTitle(request.getTitle());
        task.setDescription(request.getDescription());
        task.setStatus(request.getStatus());
        task.setPriority(request.getPriority());
        task.setDueDate(request.getDueDate());

        Task updated = taskRepository.save(task);
        return TaskResponse.from(updated);
    }

    @Transactional
    public void deleteTask(@NonNull Long id) {
        if (!taskRepository.existsById(id)) {
            throw new TaskNotFoundException(id);
        }
        taskRepository.deleteById(id);
    }

    @NonNull
    private Sort parseSortParameter(String sort) {
        if (sort == null || sort.isBlank()) {
            return Sort.by(Sort.Direction.DESC, "createdAt");
        }

        String[] parts = sort.split(",");
        String property = parts[0].trim();
        Sort.Direction direction = (parts.length > 1 && "asc".equalsIgnoreCase(parts[1].trim()))
                ? Sort.Direction.ASC
                : Sort.Direction.DESC;

        if (!isAllowedSortProperty(property)) {
            return Sort.by(Sort.Direction.DESC, "createdAt");
        }

        return Sort.by(direction, property);
    }

    private boolean isAllowedSortProperty(String property) {
        return "createdAt".equals(property)
            || "updatedAt".equals(property)
            || "dueDate".equals(property)
            || "title".equals(property)
            || "priority".equals(property)
            || "status".equals(property);
    }
}
