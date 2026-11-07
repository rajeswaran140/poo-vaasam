'use client';

/**
 * The "…" menu on a saved-master row.
 *
 * A row shows only what Raj does every time (play, render, YouTube); the rare
 * actions live here. Every item is a plain button (or a link), so it is
 * reachable by Tab as well as by the arrow keys; Escape closes the menu and
 * hands focus back to the "…" button.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type RowMenuItem =
  | { label: string; onSelect: () => void; disabled?: boolean; href?: undefined }
  | { label: string; href: string; onSelect?: undefined; disabled?: undefined };

export function RowActionsMenu({ forWhom, items }: { forWhom: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  // Focus the first item on open, so the keyboard lands inside the menu.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('button:not([disabled]), a')?.focus();
  }, [open]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = Array.from(list.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a') ?? []);
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
    all[next].focus();
  };

  const itemClass =
    'block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 focus:bg-gray-100 focus:outline-none disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800 dark:focus:bg-gray-800';

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`More actions for ${forWhom}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); close(true); } }}
        className="rounded border border-gray-300 px-2 py-0.5 text-xs font-semibold leading-4 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span aria-hidden="true">…</span>
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="group"
          aria-label={`Actions for ${forWhom}`}
          onKeyDown={onKeyDown}
          className="absolute right-0 z-20 mt-1 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {items.map((item) =>
            item.href !== undefined ? (
              <a key={item.label} href={item.href} className={itemClass} onClick={() => setOpen(false)}>
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                className={itemClass}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
