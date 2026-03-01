package com.taskflow.repository;

import com.taskflow.entity.Task;
import com.taskflow.entity.TaskPriority;
import com.taskflow.entity.TaskStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TaskRepository extends JpaRepository<Task, Long> {

    @Query("SELECT t FROM Task t WHERE "
         + "(:status IS NULL OR t.status = :status) AND "
         + "(:priority IS NULL OR t.priority = :priority) AND "
         + "(:keyword IS NULL OR t.title LIKE %:keyword% OR t.description LIKE %:keyword%)")
    Page<Task> findByFilters(
        @Param("status") TaskStatus status,
        @Param("priority") TaskPriority priority,
        @Param("keyword") String keyword,
        Pageable pageable
    );
}
