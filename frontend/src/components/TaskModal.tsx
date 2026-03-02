import { useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { createTask, updateTask } from '../api/taskApi';
import { ApiError } from '../api/apiClient';
import { STATUS_LABELS, PRIORITY_LABELS } from '../constants/task';
import type { TaskResponse, TaskStatus, TaskPriority } from '../types/task';

interface TaskModalProps {
  isOpen: boolean;
  task: TaskResponse | null;
  onClose: () => void;
  onSuccess: () => void;
}

/** 폼 데이터 */
interface FormData {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
}

/** 폼 필드별 에러 */
interface FormErrors {
  title?: string;
  [key: string]: string | undefined;
}

const INITIAL_FORM: FormData = {
  title: '',
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: '',
};

/**
 * Task 생성/수정 공용 모달.
 * Headless UI v2 Dialog 기반.
 *
 * 1. task가 null이면 생성 모드 (기본값: TODO/MEDIUM)
 * 2. task가 있으면 수정 모드 (기존값으로 채움)
 * 3. 제출 시 createTask/updateTask 호출
 * 4. 서버 fieldErrors를 폼에 표시
 */
export default function TaskModal({ isOpen, task, onClose, onSuccess }: TaskModalProps) {
  const isEditMode = task !== null;
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // task prop 변경 시 폼 초기값 재설정
  useEffect(() => {
    if (isOpen) {
      if (task) {
        setFormData({
          title: task.title,
          description: task.description ?? '',
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate ?? '',
        });
      } else {
        setFormData(INITIAL_FORM);
      }
      setErrors({});
      setServerError(null);
    }
  }, [isOpen, task]);

  /** 입력 필드 변경 핸들러 */
  const handleChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // 해당 필드 에러 초기화
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  /** 클라이언트 사이드 간단 검증 */
  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!formData.title.trim()) {
      newErrors.title = '제목을 입력해주세요';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /** 폼 제출 */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setServerError(null);

    try {
      const payload = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        status: formData.status,
        priority: formData.priority,
        dueDate: formData.dueDate || null,
      };

      if (isEditMode) {
        await updateTask(task.id, {
          title: payload.title,
          description: payload.description,
          status: payload.status,
          priority: payload.priority,
          dueDate: payload.dueDate,
        });
      } else {
        await createTask(payload);
      }

      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.errorResponse.fieldErrors) {
        // 서버 필드 에러를 폼에 매핑
        const fieldErrors: FormErrors = {};
        for (const fe of err.errorResponse.fieldErrors) {
          fieldErrors[fe.field] = fe.message;
        }
        setErrors(fieldErrors);
      } else {
        const message = err instanceof Error ? err.message : '저장에 실패했습니다';
        setServerError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      {/* 배경 오버레이 */}
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

      {/* 모달 컨테이너 */}
      <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
          <DialogTitle className="mb-4 text-lg font-semibold text-gray-900">
            {isEditMode ? '태스크 수정' : '새 태스크'}
          </DialogTitle>

          {/* 서버 에러 표시 */}
          {serverError && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 제목 */}
            <div>
              <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
                제목 <span className="text-red-500">*</span>
              </label>
              <input
                id="title"
                type="text"
                value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                maxLength={255}
                className={`w-full rounded-md border px-3 py-2 text-sm
                  focus:outline-none focus:ring-1
                  ${errors.title
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
                  }`}
                placeholder="태스크 제목을 입력하세요"
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-600">{errors.title}</p>
              )}
            </div>

            {/* 설명 */}
            <div>
              <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
                설명
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                  focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="태스크 설명을 입력하세요 (선택)"
              />
            </div>

            {/* 상태 + 우선순위 (가로 배치) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="status" className="mb-1 block text-sm font-medium text-gray-700">
                  상태
                </label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) => handleChange('status', e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                    focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="priority" className="mb-1 block text-sm font-medium text-gray-700">
                  우선순위
                </label>
                <select
                  id="priority"
                  value={formData.priority}
                  onChange={(e) => handleChange('priority', e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                    focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 마감일 */}
            <div>
              <label htmlFor="dueDate" className="mb-1 block text-sm font-medium text-gray-700">
                마감일
              </label>
              <input
                id="dueDate"
                type="date"
                value={formData.dueDate}
                onChange={(e) => handleChange('dueDate', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                  focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* 버튼 */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700
                  transition-colors hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white
                  transition-colors hover:bg-blue-600
                  disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {submitting ? '저장 중...' : '저장'}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
