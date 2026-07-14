'use client';

/**
 * The WhatsApp REFERRAL COEFFICIENT on /admin/youtube — the return leg of the
 * share loop, and the KPI the whole WhatsApp strategy hangs on.
 *
 * Every other share panel counts outbound intent. This one answers: when someone
 * forwards a song, does anyone actually come back? Baseline measured 2026-07-14
 * was ~12 WhatsApp-referred views per 1,000 channel views, flat across weeks in
 * which channel views nearly tripled — WhatsApp is an echo of reach, not yet a
 * source of it. Moving that number is the goal; watching it is the point.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/client-auth';

interface ReferralSource {
  source: string;
  views: number;
  estimatedMinutesWatched: number;
  isWhatsApp: boolean;
}

interface Coefficient {
  windowDays: number;
  channelViews: number;
  whatsappViews: number;
  externalViews: number;
  whatsappPer1k: number;
  whatsappShareOfExternal: number;
  sources: ReferralSource[];
}

const numberFmt = new Intl.NumberFormat('en-US');

export function ReferralCoefficientPanel({ ytaConfigured }: { ytaConfigured: boolean }) {
  const [data, setData] = useState<Coefficient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(28);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/youtube/referrals?days=${d}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setData(json as Coefficient);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ytaConfigured) load(days);
  }, [ytaConfigured, days, load]);

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="referrals-heading" className="space-y-2">
        <h2 id="referrals-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          WhatsApp referral coefficient
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to measure referral traffic.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="referrals-heading" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 id="referrals-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          WhatsApp referral coefficient{' '}
          <span className="text-sm font-normal text-gray-400">({days}d)</span>
        </h2>
        <div className="flex gap-2 text-xs">
          {[7, 28, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={d === days ? 'font-semibold text-orange-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        WhatsApp-referred views coming <strong>back</strong> to the channel, per 1,000 channel views. This is the
        only metric that shows whether sharing actually <em>works</em> — the rest measure outbound clicks. A
        self-sustaining loop needs 1,000+/1k; anything far below means WhatsApp is echoing reach, not creating it.
      </p>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">{error}</p>
      )}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <div className="text-2xl font-semibold tabular-nums text-orange-600">{data.whatsappPer1k}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">WhatsApp views / 1k</div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{numberFmt.format(data.whatsappViews)}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">WhatsApp-referred views</div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{data.whatsappShareOfExternal}%</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">of all external traffic</div>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <div className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">{numberFmt.format(data.channelViews)}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">channel views (denominator)</div>
            </div>
          </div>

          {data.sources.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left">External source</th>
                    <th className="px-3 py-2 text-right">Views</th>
                    <th className="px-3 py-2 text-right">Watch-min</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.sources.map((s) => (
                    <tr key={s.source} className={s.isWhatsApp ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : undefined}>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                        {s.source}
                        {s.isWhatsApp && (
                          <span
                            title="Counted toward the WhatsApp coefficient"
                            className="ml-2 rounded bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                          >
                            counted
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{numberFmt.format(s.views)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{numberFmt.format(s.estimatedMinutesWatched)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No external referrals recorded in this window.</p>
          )}
          <p className="text-xs text-gray-400">
            WhatsApp is counted across all the labels YouTube reports it under (WhatsApp, whatsapp.com,
            WhatsApp Business) — counting only one undercounts it by ~40%.
          </p>
        </>
      )}
    </section>
  );
}
