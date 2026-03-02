import type { TaskFilters } from '../hooks/useTasks';
import { STATUS_LABELS, PRIORITY_LABELS, SORT_OPTIONS } from '../constants/task';
import type { TaskStatus, TaskPriority } from '../types/task';

interface TaskToolbarProps {
  filters: TaskFilters;
  totalElements: number;
  onFiltersChange: (update: Partial<TaskFilters>) => void;
  onNewTask: () => void;
}

/**
 * 검색, 필터(status/priority), 정렬, "새 태스크" 버튼을 담는 도구 모음.
 */
export default function TaskToolbar({ filters, totalElements, onFiltersChange, onNewTask }: TaskToolbarProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {/* 검색 */}
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>
        <input
          type="text"
          placeholder="검색..."
          value={filters.q}
          onChange={(e) => onFiltersChange({ q: e.target.value })}
          className="rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm
            placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* status 필터 */}
      <select
        value={filters.status ?? ''}
        onChange={(e) => onFiltersChange({ status: (e.target.value || undefined) as TaskStatus | undefined })}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">전체 상태</option>
        {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>

      {/* priority 필터 */}
      <select
        value={filters.priority ?? ''}
        onChange={(e) => onFiltersChange({ priority: (e.target.value || undefined) as TaskPriority | undefined })}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">전체 우선순위</option>
        {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
        ))}
      </select>

      {/* 정렬 */}
      <select
        value={filters.sort}
        onChange={(e) => onFiltersChange({ sort: e.target.value })}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* 전체 건수 */}
      <span className="text-sm text-gray-500">
        {totalElements}건
      </span>

      {/* 새 태스크 버튼 (우측 정렬) */}
      <button
        onClick={onNewTask}
        className="ml-auto rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white
          transition-colors hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        새 태스크
      </button>
    </div>
  );
}
