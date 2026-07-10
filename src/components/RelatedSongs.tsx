/**
 * RelatedSongs — "இதே போன்ற பாடல்கள்" grid on a song's /content page.
 *
 * Server-rendered internal links (crawlable) to same-theme / recent songs, so
 * visitors keep exploring the catalogue on-site instead of bouncing, and the
 * song pages cross-link each other for SEO. Light card style to match the
 * /content article chrome. Presentational — hrefs are precomputed by the caller.
 */

import Link from 'next/link';
import Image from 'next/image';
import type { RelatedSongItem } from '@/lib/related-songs';

export function RelatedSongs({ songs }: { songs: RelatedSongItem[] }) {
  if (songs.length === 0) return null;

  return (
    <section
      aria-labelledby="related-songs-heading"
      className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="related-songs-heading" className="mb-4 font-tamil text-sm font-semibold uppercase tracking-wide text-gray-700">
        இதே போன்ற பாடல்கள்
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {songs.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="group flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5 transition-colors hover:border-orange-300 hover:bg-orange-50/40"
            >
              {s.coverUrl ? (
                <Image
                  src={s.coverUrl}
                  alt={s.title}
                  width={64}
                  height={64}
                  sizes="64px"
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-2xl" aria-hidden>
                  🎵
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-tamil font-semibold text-gray-900 group-hover:text-orange-600">
                  {s.title}
                </span>
                {s.artist ? <span className="truncate text-xs text-gray-500">{s.artist}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
