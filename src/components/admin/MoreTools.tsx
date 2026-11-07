'use client';

/**
 * "More tools" — the rarely used controls, kept off the five-step path.
 *
 * CLOSED ON EVERY PAGE LOAD, by design: the open state is deliberately not
 * remembered, so the page Raj lands on is always the uncluttered one.
 *
 * ⚠️ Hidden, never unmounted — see Disclosure. The trim panel inside must stay
 * mounted while a source is loaded, or a remount would push an empty edit up
 * and the next master would come out untrimmed.
 */

import { useId, useState, type ReactNode } from 'react';

export function MoreTools({ children, open: controlledOpen, onOpenChange }: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const id = useId();
  const toggle = () => {
    if (controlledOpen === undefined) setOwnOpen(!open);
    onOpenChange?.(!open);
  };
  return (
    <section className="rounded-xl border border-dashed border-gray-300 bg-white/60 p-4 dark:border-gray-700 dark:bg-gray-900/60">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="flex w-full flex-wrap items-baseline gap-x-2 text-left text-sm font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white"
      >
        <span aria-hidden="true" className="text-gray-400">{open ? '▾' : '▸'}</span>
        More tools
        <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
          Trim · Join two parts · Compare · Slideshow · Whole-song vertical · Repair marks
        </span>
      </button>
      <div id={id} hidden={!open}>
        <div className="mt-3 space-y-4">{children}</div>
      </div>
    </section>
  );
}

/** One tool's block inside More tools. */
export function ToolBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
