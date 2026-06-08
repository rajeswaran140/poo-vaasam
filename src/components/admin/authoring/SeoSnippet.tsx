'use client';

/**
 * Google-style search-result snippet preview. Falls back title→seoTitle and
 * description→seoDescription the same way the public pages do, so the writer
 * sees what searchers will actually see.
 */
import { generateSlug } from '@/lib/utils/slug';

export function SeoSnippet({
  title,
  description,
  seoTitle,
  seoDescription,
}: {
  title: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
}) {
  const displayTitle = (seoTitle || title || 'Untitled').trim();
  const displayDesc = (seoDescription || description || '').trim();
  const slug = generateSlug(title || '');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
      <p className="mb-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">Search preview</p>
      <p className="truncate text-xs text-[#006621] dark:text-green-500">
        tamilagaval.com › content › {slug || '…'}
      </p>
      <p className="truncate text-lg leading-tight text-[#1a0dab] dark:text-blue-400">{displayTitle}</p>
      <p className="mt-0.5 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
        {displayDesc || <span className="italic text-gray-400">No description — search engines will use page text.</span>}
      </p>
    </div>
  );
}
