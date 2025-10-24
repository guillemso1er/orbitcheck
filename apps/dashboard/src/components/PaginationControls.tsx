import React from 'react';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  nextCursor: string | null;
  onPrevPage: () => void;
  onNextPage: () => void;
  onGoToPage: (page: number) => void;
  limit: number;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  nextCursor,
  onPrevPage,
  onNextPage,
  onGoToPage,
}) => (
  <div className="flex items-center gap-2">
    <button
      onClick={onPrevPage}
      disabled={currentPage === 1}
      className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      Previous
    </button>
    <div className="flex items-center gap-1">
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        const pageNum =
          currentPage <= 3 ? i + 1 : totalPages - 4 + i + 1;
        return (
          <button
            key={pageNum}
            onClick={() => onGoToPage(pageNum)}
            className={`px-3 py-1 border rounded-md transition-colors ${
              pageNum === currentPage
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
          >
            {pageNum}
          </button>
        );
      })}
      {totalPages > 5 && (
        <>
          <span className="px-2 text-gray-500">...</span>
          <button
            onClick={() => onGoToPage(totalPages)}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            {totalPages}
          </button>
        </>
      )}
    </div>
    <button
      onClick={onNextPage}
      disabled={currentPage === totalPages || !nextCursor}
      className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      Next
    </button>
  </div>
);