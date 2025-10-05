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
  <div className="pagination-controls">
    <button
      onClick={onPrevPage}
      disabled={currentPage === 1}
      className="btn btn-secondary"
    >
      Previous
    </button>
    <div className="page-numbers">
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        const pageNum =
          currentPage <= 3 ? i + 1 : totalPages - 4 + i + 1;
        return (
          <button
            key={pageNum}
            onClick={() => onGoToPage(pageNum)}
            className={`btn ${
              pageNum === currentPage ? 'btn-primary' : 'btn-outline-primary'
            }`}
          >
            {pageNum}
          </button>
        );
      })}
      {totalPages > 5 && (
        <>
          <span>...</span>
          <button
            onClick={() => onGoToPage(totalPages)}
            className="btn btn-outline-primary"
          >
            {totalPages}
          </button>
        </>
      )}
    </div>
    <button
      onClick={onNextPage}
      disabled={currentPage === totalPages || !nextCursor}
      className="btn btn-secondary"
    >
      Next
    </button>
  </div>
);