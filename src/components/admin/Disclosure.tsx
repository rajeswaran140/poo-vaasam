'use client';

/**
 * A one-line toggle that shows or hides the controls under it.
 *
 * ⚠️ THE CONTENT IS HIDDEN, NEVER UNMOUNTED. Several of the controls this wraps
 * hold state that matters while they are closed: the trim panel pushes its
 * region up on mount (a remount would re-master the song UNTRIMMED), the
 * background picker reports an upload in flight, the short window keeps what
 * was typed. Closing a disclosure must never reset any of that.
 *
 * The wrapper is a bare <div hidden>: a display utility (`flex`, `grid`) on the
 * same element would beat Tailwind's `[hidden]` rule and show it anyway.
 *
 * Open state is never remembered across page loads — Raj's page starts tidy.
 */

import { useId, useState, type ReactNode } from 'react';

export function Disclosure({
  label,
  summary,
  open: controlledOpen,
  onOpenChange,
  children,
  className = '',
  buttonClassName,
}: {
  /** What the toggle is, e.g. "Settings". */
  label: ReactNode;
  /** The current choice in one line, e.g. "1440p · still". */
  summary?: ReactNode;
  /** Controlled when given; otherwise the disclosure owns its state (closed). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const id = useId();
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className={
          buttonClassName ??
          'inline-flex max-w-full items-center gap-1.5 rounded text-xs text-gray-600 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 dark:text-gray-300 dark:hover:text-gray-100'
        }
      >
        <span className="font-medium">{label}</span>
        {summary !== undefined && (
          <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">{summary}</span>
        )}
        <span aria-hidden="true" className="text-gray-400">{open ? '▾' : '▸'}</span>
        {!open && <span className="text-orange-700 underline dark:text-orange-400">change</span>}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
