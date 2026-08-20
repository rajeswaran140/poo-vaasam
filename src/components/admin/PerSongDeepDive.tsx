'use client';

/**
 * Per-song deep dive — the FULL daily-trend / geography / search-terms panels,
 * collapsed by default.
 *
 * The Song Cockpit already summarizes these three dimensions at a glance, so
 * rendering the full panels inline duplicated them and made the dashboard a very
 * long scroll. Tucking them behind one <details> keeps the full detail on demand
 * without the redundancy. (Retention isn't summarized by the cockpit, so it
 * stays a standalone panel.)
 */

import { SongTrendPanel } from '@/components/admin/SongTrendPanel';
import { GeographyInsightPanel } from '@/components/admin/GeographyInsightPanel';
import { SearchTermsPanel } from '@/components/admin/SearchTermsPanel';
import { RevenueGeographyPanel } from '@/components/admin/RevenueGeographyPanel';

export function PerSongDeepDive({
  videos,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  ytaConfigured: boolean;
}) {
  return (
    <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
      <summary className="cursor-pointer text-lg font-semibold text-gray-900 dark:text-gray-100">
        Per-song deep dive
        <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
          full daily trend · geography · revenue by country · search terms
        </span>
      </summary>
      <div className="mt-6 space-y-8">
        <SongTrendPanel videos={videos} ytaConfigured={ytaConfigured} />
        <GeographyInsightPanel videos={videos} ytaConfigured={ytaConfigured} />
        {/* Revenue sits directly under geography on purpose: the two answer the
            same "where is the audience" question and disagree, which is the
            point. Views say India; revenue says the diaspora. */}
        <RevenueGeographyPanel videos={videos} ytaConfigured={ytaConfigured} />
        <SearchTermsPanel videos={videos} ytaConfigured={ytaConfigured} />
      </div>
    </details>
  );
}
