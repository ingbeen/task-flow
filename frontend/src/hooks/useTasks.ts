import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchTasks } from '../api/taskApi';
import { DEFAULT_PAGE_SIZE, DEFAULT_SORT } from '../constants/task';
import type { TaskResponse, TaskStatus, TaskPriority } from '../types/task';

/** 필터/검색/정렬 상태 */
export interface TaskFilters {
  status: TaskStatus | undefined;
  priority: TaskPriority | undefined;
  q: string;
  sort: string;
  size: number;
}

/** useTasks 훅 반환 타입 */
export interface UseTasksReturn {
  tasks: TaskResponse[];
  page: number;
  totalPages: number;
  totalElements: number;
  loading: boolean;
  error: string | null;
  filters: TaskFilters;
  setFilters: (update: Partial<TaskFilters>) => void;
  setPage: (page: number) => void;
  refresh: () => void;
}

const INITIAL_FILTERS: TaskFilters = {
  status: undefined,
  priority: undefined,
  q: '',
  sort: DEFAULT_SORT,
  size: DEFAULT_PAGE_SIZE,
};

/**
 * Task 목록 조회, 필터/검색/페이징 상태를 관리하는 커스텀 훅.
 *
 * 1. filters 또는 page가 변경되면 자동으로 fetchTasks를 호출한다.
 * 2. 검색어(q) 변경 시 300ms debounce를 적용한다.
 * 3. 필터 변경 시 page를 0으로 초기화한다.
 */
export function useTasks(): UseTasksReturn {
  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<TaskFilters>(INITIAL_FILTERS);

  // debounce된 검색어
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // 검색어 debounce (300ms)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQ(filters.q);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filters.q]);

  // 데이터 조회
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTasks({
        status: filters.status,
        priority: filters.priority,
        q: debouncedQ || undefined,
        page,
        size: filters.size,
        sort: filters.sort,
      });
      setTasks(result.content);
      setTotalPages(result.totalPages);
      setTotalElements(result.totalElements);
    } catch (err) {
      const message = err instanceof Error ? err.message : '목록 조회에 실패했습니다';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.priority, debouncedQ, filters.sort, filters.size, page]);

  // filters/page 변경 시 자동 조회
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // 필터 변경 (page를 0으로 초기화)
  const setFilters = useCallback((update: Partial<TaskFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...update }));
    setPage(0);
  }, []);

  // 목록 재조회 (CRUD 후 호출)
  const refresh = useCallback(() => {
    loadTasks();
  }, [loadTasks]);

  return {
    tasks,
    page,
    totalPages,
    totalElements,
    loading,
    error,
    filters,
    setFilters,
    setPage,
    refresh,
  };
}
