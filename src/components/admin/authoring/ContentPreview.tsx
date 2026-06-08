'use client';

/**
 * Toggleable preview of the title + body exactly as they'll render — poem font
 * for POEMS, preserved line breaks for all. Body is rendered as plain text
 * (whitespace-pre-wrap), never HTML, so there's no injection surface.
 */
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function ContentPreview({ title, body, isPoem }: { title: string; body: string; isPoem: boolean }) {
  const [open, setOpen] = useState(false);
  const empty = !title.trim() && !body.trim();
  const font = isPoem ? 'font-poem' : 'font-tamil';

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      >
        {open ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {open ? 'Hide preview' : 'Preview'}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950/40">
          {empty ? (
            <p className="text-sm text-gray-400">Nothing to preview yet — start writing above.</p>
          ) : (
            <>
              {title.trim() && (
                <h3 className={`mb-3 text-2xl font-bold text-gray-900 dark:text-gray-100 ${font}`}>{title}</h3>
              )}
              <div className={`whitespace-pre-wrap leading-relaxed text-gray-800 dark:text-gray-200 ${font}`}>
                {body}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
