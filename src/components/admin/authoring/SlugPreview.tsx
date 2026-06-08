'use client';

/** Live, read-only preview of the URL slug derived from the title (same fn the
 * server uses). A number is appended server-side only on a real collision. */
import { generateSlug } from '@/lib/utils/slug';

export function SlugPreview({ title }: { title: string }) {
  const slug = generateSlug(title || '');
  return (
    <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
      URL:{' '}
      <span className="font-mono text-gray-700 dark:text-gray-300">
        /content/{slug || <span className="text-gray-400">…</span>}
      </span>
      <span className="ml-1 text-gray-400">(auto · a number is added only if taken)</span>
    </p>
  );
}
