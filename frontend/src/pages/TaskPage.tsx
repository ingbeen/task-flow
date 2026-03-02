import { useState, useCallback } from 'react';
import { useTasks } from '../hooks/useTasks';
import { deleteTask } from '../api/taskApi';
import TaskToolbar from '../components/TaskToolbar';
import TaskList from '../components/TaskList';
import Pagination from '../components/Pagination';
import TaskModal from '../components/TaskModal';
import type { TaskResponse } from '../types/task';

/** 모달 상태: null이면 생성 모드, TaskResponse이면 수정 모드 */
interface ModalState {
  isOpen: boolean;
  task: TaskResponse | null;
}

/**
 * /tasks 경로의 메인 페이지.
 * useTasks 훅으로 데이터를 관리하고, 자식 컴포넌트에 props를 전달한다.
 */
export default function TaskPage() {
  const {
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
  } = useTasks();

  const [modal, setModal] = useState<ModalState>({ isOpen: false, task: null });

  /** 새 태스크 버튼 → 생성 모달 */
  const handleNewTask = useCallback(() => {
    setModal({ isOpen: true, task: null });
  }, []);

  /** 카드 클릭 → 수정 모달 */
  const handleTaskClick = useCallback((task: TaskResponse) => {
    setModal({ isOpen: true, task });
  }, []);

  /** 모달 닫기 */
  const handleModalClose = useCallback(() => {
    setModal({ isOpen: false, task: null });
  }, []);

  /** 모달 성공 (생성/수정) → 목록 갱신 */
  const handleModalSuccess = useCallback(() => {
    refresh();
  }, [refresh]);

  /** 태스크 삭제 → 목록 갱신 */
  const handleTaskDelete = useCallback(async (id: number) => {
    try {
      await deleteTask(id);
      refresh();
    } catch {
      alert('삭제에 실패했습니다');
    }
  }, [refresh]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* 헤더 */}
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Task Board</h1>
        </header>

        {/* 도구 모음 */}
        <TaskToolbar
          filters={filters}
          totalElements={totalElements}
          onFiltersChange={setFilters}
          onNewTask={handleNewTask}
        />

        {/* 카드 목록 */}
        <div className="mb-6">
          <TaskList
            tasks={tasks}
            loading={loading}
            error={error}
            onTaskClick={handleTaskClick}
            onTaskDelete={handleTaskDelete}
            onRetry={refresh}
          />
        </div>

        {/* 페이지네이션 */}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />

        {/* 생성/수정 모달 */}
        <TaskModal
          isOpen={modal.isOpen}
          task={modal.task}
          onClose={handleModalClose}
          onSuccess={handleModalSuccess}
        />
      </div>
    </div>
  );
}
