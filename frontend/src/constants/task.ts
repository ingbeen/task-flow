import type { TaskStatus, TaskPriority } from '../types/task';

/** 상태별 한글 라벨 */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: '할 일',
  DOING: '진행 중',
  DONE: '완료',
};

/** 상태별 배지 색상 (배경 + 텍스트) */
export const STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: 'bg-gray-100 text-gray-700',
  DOING: 'bg-blue-100 text-blue-700',
  DONE: 'bg-green-100 text-green-700',
};

/** 우선순위별 한글 라벨 */
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: '낮음',
  MEDIUM: '보통',
  HIGH: '높음',
};

/** 우선순위별 배지 색상 (배경 + 텍스트) */
export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH: 'bg-red-100 text-red-700',
};

/** 우선순위별 카드 좌측 테두리 색상 */
export const PRIORITY_BORDER_COLORS: Record<TaskPriority, string> = {
  LOW: 'border-l-slate-300',
  MEDIUM: 'border-l-yellow-400',
  HIGH: 'border-l-red-400',
};

/** 정렬 옵션 */
export const SORT_OPTIONS = [
  { value: 'createdAt,desc', label: '최신순' },
  { value: 'createdAt,asc', label: '오래된순' },
  { value: 'dueDate,asc', label: '마감일순' },
  { value: 'title,asc', label: '제목순' },
] as const;

/** 기본 페이지 크기 */
export const DEFAULT_PAGE_SIZE = 10;

/** 기본 정렬 */
export const DEFAULT_SORT = 'createdAt,desc';
