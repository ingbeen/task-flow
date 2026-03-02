interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * 페이지 네비게이션.
 * 이전/다음 버튼 + 페이지 번호 표시.
 * 표시: 1-based / 내부: 0-based 변환.
 */
export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  // 1페이지 이하면 표시하지 않음
  if (totalPages <= 1) return null;

  /**
   * 표시할 페이지 번호 목록 계산.
   * 현재 페이지 주변 최대 5개 + 처음/마지막 페이지.
   */
  const getPageNumbers = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      // 페이지가 적으면 전부 표시
      for (let i = 0; i < totalPages; i++) pages.push(i);
    } else {
      // 항상 첫 페이지 포함
      pages.push(0);

      const start = Math.max(1, page - 1);
      const end = Math.min(totalPages - 2, page + 1);

      if (start > 1) pages.push('...');
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages - 2) pages.push('...');

      // 항상 마지막 페이지 포함
      pages.push(totalPages - 1);
    }

    return pages;
  };

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="페이지 네비게이션">
      {/* 이전 버튼 */}
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors
          enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
      >
        이전
      </button>

      {/* 페이지 번호 */}
      {getPageNumbers().map((p, index) =>
        p === '...' ? (
          <span key={`ellipsis-${index}`} className="px-2 py-2 text-sm text-gray-400">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`min-w-[36px] rounded-md px-3 py-2 text-sm font-medium transition-colors
              ${p === page
                ? 'bg-blue-500 text-white'
                : 'text-gray-700 hover:bg-gray-100'
              }`}
          >
            {p + 1}
          </button>
        ),
      )}

      {/* 다음 버튼 */}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages - 1}
        className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors
          enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
      >
        다음
      </button>
    </nav>
  );
}
