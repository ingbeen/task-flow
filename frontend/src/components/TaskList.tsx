import type { TaskResponse } from '../types/task';
import TaskCard from './TaskCard';

interface TaskListProps {
  tasks: TaskResponse[];
  loading: boolean;
  error: string | null;
  onTaskClick: (task: TaskResponse) => void;
  onTaskDelete: (id: number) => void;
  onRetry: () => void;
}

/**
 * Task 카드 목록.
 * 로딩, 에러, 빈 상태를 처리하고 TaskCard 그리드를 렌더링한다.
 */
export default function TaskList({ tasks, loading, error, onTaskClick, onTaskDelete, onRetry }: TaskListProps) {
  // 로딩 상태
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
          <p className="text-sm text-gray-500">불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="mb-3 text-sm text-red-600">{error}</p>
        <button
          onClick={onRetry}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // 빈 상태
  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-gray-500">등록된 태스크가 없습니다</p>
      </div>
    );
  }

  // 카드 그리드
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onClick={() => onTaskClick(task)}
          onDelete={() => onTaskDelete(task.id)}
        />
      ))}
    </div>
  );
}
