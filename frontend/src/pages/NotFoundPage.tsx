import { Link } from 'react-router';

/** 존재하지 않는 경로 접근 시 표시되는 404 페이지 */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300">404</h1>
        <p className="mt-4 text-lg text-gray-600">
          페이지를 찾을 수 없습니다.
        </p>
        <Link
          to="/tasks"
          className="mt-6 inline-block rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Task Board로 돌아가기
        </Link>
      </div>
    </div>
  );
}
