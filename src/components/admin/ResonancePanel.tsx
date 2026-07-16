'use client';

/**
 * Resonance panel on /admin/youtube — ranks the catalogue by per-viewer ADVOCACY
 * (shares / likes / subscriber-conversion / comments per 1k views), NOT reach.
 * The complement to Catalogue Outliers: it surfaces the low-view-but-deeply-
 * resonant songs (the motivation lane) that a views-weighted score buries. Thin
 * presentation over GET /api/admin/youtube/resonance.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { SONG_THEME_LABELS, type SongTheme } from '@/config/song-themes';

interface Breakdown {
  key: string;
  value: number;
}
interface RankedSong {
  videoId: string;
  title: string;
  theme: string | null;
  score: number;
  rank: number;
  breakdown: Breakdown[];
}
interface ThemeSummary {
  theme: string;
  count: number;
  meanScore: number;
}
interface ResonanceResponse {
  success: boolean;
  window: number;
  channel: { ranked: number };
  songs: RankedSong[];
  themeSummary: ThemeSummary[];
  caveats: string[];
}

const sig = (o: RankedSong, key: string): number | null => o.breakdown.find((b) => b.key === key)?.value ?? null;
const fmt1 = (n: number | null) => (n == null ? '—' : n.toFixed(1));
const fmtScore = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
const themeLabel = (t: string | null): string =>
  !t || t === '(untagged)' ? 'untagged' : SONG_THEME_LABELS[t as SongTheme] ?? t;

export function ResonancePanel({ ytaConfigured }: { ytaConfigured: boolean }) {
  const [data, setData] = useState<ResonanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/resonance');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setData(json as ResonanceResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ytaConfigured) load();
  }, [ytaConfigured, load]);

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="resonance-heading" className="space-y-2">
        <h2 id="resonance-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Resonance</h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to rank songs by per-viewer advocacy.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="resonance-heading" className="space-y-3">
      <h2 id="resonance-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Resonance</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Which songs move people <strong>per viewer</strong> — shares, likes, subscriber-conversion and comments per
        1,000 views — <strong>not</strong> reach. This is where the deeply-resonant, lower-view songs (the motivation
        lane) show their real worth: a song can reach few but be shared by a large share of those it reaches.
      </p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">{error}</p>}
      {loading && !data && <p className="text-sm text-gray-500">Loading…</p>}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Song</th>
                  <th className="px-3 py-2 text-left">Theme</th>
                  <th className="px-3 py-2 text-right">Resonance</th>
                  <th className="px-3 py-2 text-right">Shares/1k</th>
                  <th className="px-3 py-2 text-right">Likes/1k</th>
                  <th className="px-3 py-2 text-right">Subs/1k</th>
                  <th className="px-3 py-2 text-right">Cmnts/1k</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.songs.map((o) => (
                  <tr key={o.videoId}>
                    <td className="px-3 py-2 tabular-nums text-gray-400">{o.rank}</td>
                    <td className="px-3 py-2 font-tamil text-gray-900 dark:text-gray-100"><span className="line-clamp-1 max-w-[16rem]">{o.title}</span></td>
                    <td className="px-3 py-2">
                      <span className="inline-block rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 font-tamil text-xs text-gray-600 dark:text-gray-300">{themeLabel(o.theme)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">{fmtScore(o.score)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-700 dark:text-gray-300">{fmt1(sig(o, 'sharesPer1k'))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt1(sig(o, 'likesPer1k'))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt1(sig(o, 'subsPer1k'))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt1(sig(o, 'engagement'))}</td>
                  </tr>
                ))}
                {data.songs.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No songs to rank yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {data.themeSummary.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Most resonant themes (mean advocacy)
              </p>
              <div className="flex flex-wrap gap-2">
                {data.themeSummary.map((t) => (
                  <div key={t.theme} className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
                    <p className="font-tamil text-sm text-gray-900 dark:text-gray-100">{themeLabel(t.theme)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      <span className="font-medium tabular-nums text-gray-700 dark:text-gray-300">{fmtScore(t.meanScore)}</span> · {t.count} song{t.count === 1 ? '' : 's'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1 text-xs text-gray-400">
            {data.caveats.map((c) => <p key={c}>· {c}</p>)}
          </div>
        </>
      )}
    </section>
  );
}
