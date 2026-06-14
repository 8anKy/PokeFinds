"use client";

import { cn } from "@/lib/utils";
import { IconChevronLeft, IconChevronRight } from "@/components/ui/icons";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Bygger sidlista med ellipsis, t.ex. 1 … 4 5 6 … 12 */
function buildPages(page: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("ellipsis");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const buttonBase =
    "inline-flex h-9 min-w-[36px] items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-holo-cyan disabled:pointer-events-none disabled:opacity-40";

  return (
    <nav aria-label="Sidnavigering" className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Föregående sida"
        className={cn(buttonBase, "text-ink-muted hover:bg-surface-overlay hover:text-ink")}
      >
        <IconChevronLeft size={16} />
      </button>
      {buildPages(page, totalPages).map((p, i) =>
        p === "ellipsis" ? (
          <span key={`e-${i}`} className="px-1.5 text-ink-faint" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              buttonBase,
              p === page
                ? "bg-holo-cyan font-semibold text-surface"
                : "text-ink-muted hover:bg-surface-overlay hover:text-ink"
            )}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Nästa sida"
        className={cn(buttonBase, "text-ink-muted hover:bg-surface-overlay hover:text-ink")}
      >
        <IconChevronRight size={16} />
      </button>
    </nav>
  );
}
