import type { ErrorResponse } from '../types/task';

/**
 * API 호출 시 발생하는 에러.
 * 백엔드 GlobalExceptionHandler가 반환하는 ErrorResponse 구조를 포함한다.
 */
export class ApiError extends Error {
  status: number;
  errorResponse: ErrorResponse;

  constructor(status: number, errorResponse: ErrorResponse) {
    super(errorResponse.message);
    this.name = 'ApiError';
    this.status = status;
    this.errorResponse = errorResponse;
  }
}

/**
 * fetch 래퍼.
 * 모든 API 호출에 공통 헤더를 추가하고, 에러 응답을 ApiError로 변환한다.
 */
export async function apiClient<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  // 204 No Content (DELETE 응답)
  if (response.status === 204) {
    return undefined as T;
  }

  // 에러 응답 처리
  if (!response.ok) {
    const errorBody: ErrorResponse = await response.json();
    throw new ApiError(response.status, errorBody);
  }

  return response.json() as Promise<T>;
}
