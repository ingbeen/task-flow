import type { TaskResponse } from '../types/task';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  PRIORITY_BORDER_COLORS,
} from '../constants/task';

interface TaskCardProps {
  task: TaskResponse;
  onClick: () => void;
  onDelete: () => void;
}

/**
 * 개별 Task 카드.
 * title, status/priority 배지, dueDate, description 미리보기를 표시한다.
 * 카드 클릭 시 수정 모달, 삭제 버튼 클릭 시 삭제 처리.
 */
export default function TaskCard({ task, onClick, onDelete }: TaskCardProps) {
  /** 마감일 표시 색상 결정 */
  const getDueDateColor = (dueDate: string): string => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + 'T00:00:00');

    if (due < today) return 'text-red-600 font-semibold';
    if (due.getTime() === today.getTime()) return 'text-orange-600';
    return 'text-gray-500';
  };

  /** 삭제 버튼 클릭 (이벤트 버블링 방지) */
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('정말 삭제하시겠습니까?')) {
      onDelete();
    }
  };

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm
        border-l-4 ${PRIORITY_BORDER_COLORS[task.priority]}
        transition-shadow hover:shadow-md`}
    >
      {/* 상단: title + 삭제 버튼 */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900 line-clamp-1">{task.title}</h3>
        <button
          onClick={handleDelete}
          className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
          aria-label="삭제"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* 배지: status + priority */}
      <div className="mb-2 flex gap-2">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[task.status]}`}>
          {STATUS_LABELS[task.status]}
        </span>
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[task.priority]}`}>
          {PRIORITY_LABELS[task.priority]}
        </span>
      </div>

      {/* description 미리보기 */}
      {task.description && (
        <p className="mb-2 text-sm text-gray-600 line-clamp-2">{task.description}</p>
      )}

      {/* 마감일 */}
      {task.dueDate && (
        <p className={`text-xs ${getDueDateColor(task.dueDate)}`}>
          마감: {task.dueDate}
        </p>
      )}
    </div>
  );
}
