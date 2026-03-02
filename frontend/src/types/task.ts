/** Task 상태 (백엔드 TaskStatus enum 대응) */
export type TaskStatus = 'TODO' | 'DOING' | 'DONE';

/** Task 우선순위 (백엔드 TaskPriority enum 대응) */
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/** 백엔드 TaskResponse DTO 대응 */
export interface TaskResponse {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 백엔드 PageResponse<T> DTO 대응 */
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

/** 백엔드 TaskCreateRequest DTO 대응 */
export interface TaskCreateRequest {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
}

/** 백엔드 TaskUpdateRequest DTO 대응 */
export interface TaskUpdateRequest {
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
}

/** 백엔드 ErrorResponse DTO 대응 */
export interface ErrorResponse {
  status: number;
  code: string;
  message: string;
  fieldErrors: FieldError[] | null;
  timestamp: string;
}

/** 백엔드 ErrorResponse.FieldError 대응 */
export interface FieldError {
  field: string;
  message: string;
}

/** Task 목록 조회 쿼리 파라미터 */
export interface TaskListParams {
  status?: TaskStatus;
  priority?: TaskPriority;
  q?: string;
  page: number;
  size: number;
  sort: string;
}
