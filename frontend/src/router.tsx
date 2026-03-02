import { createBrowserRouter, Navigate } from 'react-router';
import TaskPage from './pages/TaskPage';
import NotFoundPage from './pages/NotFoundPage';

/** 라우터 정의: / → /tasks 리다이렉트, /tasks → 메인 페이지, * → 404 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/tasks" replace />,
  },
  {
    path: '/tasks',
    element: <TaskPage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
