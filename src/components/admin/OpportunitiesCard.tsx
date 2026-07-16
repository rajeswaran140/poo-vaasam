/**
 * Today's Opportunities card on /admin/youtube — a short ranked list of concrete
 * next actions (lib/youtube-opportunities), each with a priority + rationale.
 * Server component: renders actions computed on the page. No fetch, no state.
 */

import type { Opportunity, OpportunityKind } from '@/lib/youtube-opportunities';

const KIND_DOT: Record<OpportunityKind, string> = {
  publish: 'bg-green-500',
  amplify: 'bg-blue-500',
  'fix-retention': 'bg-amber-500',
  hold: 'bg-red-400',
};

const stars = (n: number): string => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n));

export function OpportunitiesCard({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <section aria-labelledby="opps-heading" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <h2 id="opps-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Today&apos;s opportunities
      </h2>
      {opportunities.length === 0 ? (
        <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
          Nothing pressing — you&apos;re on track. Keep to the Friday cadence.
        </p>
      ) : (
        <ul className="space-y-3">
          {opportunities.map((o, i) => (
            <li key={`${o.kind}-${o.videoId ?? i}`} className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[o.kind]}`} aria-hidden />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{o.title}</p>
                  <span className="text-[10px] tracking-tight text-amber-500" aria-label={`priority ${o.priority} of 5`}>{stars(o.priority)}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{o.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
