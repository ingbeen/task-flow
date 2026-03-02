import { apiClient } from './apiClient';
import type {
  TaskResponse,
  TaskCreateRequest,
  TaskUpdateRequest,
  PageResponse,
  TaskListParams,
} from '../types/task';

/** Task 목록 조회 (필터/검색/페이징/정렬) */
export function fetchTasks(params: TaskListParams): Promise<PageResponse<TaskResponse>> {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('size', String(params.size));
  searchParams.set('sort', params.sort);
  if (params.status) searchParams.set('status', params.status);
  if (params.priority) searchParams.set('priority', params.priority);
  if (params.q) searchParams.set('q', params.q);

  return apiClient<PageResponse<TaskResponse>>(`/api/tasks?${searchParams.toString()}`);
}

/** Task 생성 */
export function createTask(request: TaskCreateRequest): Promise<TaskResponse> {
  return apiClient<TaskResponse>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/** Task 수정 (전체 교체) */
export function updateTask(id: number, request: TaskUpdateRequest): Promise<TaskResponse> {
  return apiClient<TaskResponse>(`/api/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
}

/** Task 삭제 */
export function deleteTask(id: number): Promise<void> {
  return apiClient<void>(`/api/tasks/${id}`, {
    method: 'DELETE',
  });
}
