/**
 * Channel Health card on /admin/youtube — one 0–100 glance + the four
 * dimensions behind it. Server component: renders the score computed on the
 * page (lib/youtube-health-score) from already-fetched data. No fetch, no state.
 */

import type { ChannelHealth, HealthStatus } from '@/lib/youtube-health-score';

const STATUS_STYLE: Record<HealthStatus, { badge: string; ring: string }> = {
  strong: { badge: 'bg-green-500/15 text-green-700 dark:text-green-300', ring: 'text-green-500' },
  healthy: { badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', ring: 'text-blue-500' },
  watch: { badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', ring: 'text-amber-500' },
  concern: { badge: 'bg-red-500/15 text-red-700 dark:text-red-300', ring: 'text-red-500' },
};

function barColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 45) return 'bg-amber-500';
  return 'bg-red-400';
}

export function ChannelHealthCard({ health }: { health: ChannelHealth }) {
  const s = STATUS_STYLE[health.status];
  return (
    <section aria-labelledby="health-heading" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="health-heading" className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Channel health
        </h2>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${s.badge}`}>
          {health.status}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-baseline">
          <span className={`text-4xl font-bold tabular-nums ${s.ring}`}>{health.overall}</span>
          <span className="text-sm text-gray-400"> / 100</span>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">{health.headline}</p>
      </div>

      <ul className="mt-4 space-y-2">
        {health.dimensions.map((d) => (
          <li key={d.key} className="text-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium text-gray-700 dark:text-gray-300">{d.label}</span>
              <span className="tabular-nums text-gray-500 dark:text-gray-400">{d.score == null ? '—' : d.score}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              {d.score != null && <div className={`h-full rounded-full ${barColor(d.score)}`} style={{ width: `${d.score}%` }} />}
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">{d.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
