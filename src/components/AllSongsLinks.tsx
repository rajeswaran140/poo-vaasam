/**
 * AllSongsLinks — an always-server-rendered list of internal links to every
 * published song's on-site page (/content/[id]).
 *
 * WHY it exists: the /videos gallery server-renders only its first 9 cards (the
 * rest reveal client-side via "Load more"), so most of the card → /content
 * links live only in post-JS DOM — a weak, unreliable internal-link signal for
 * crawlers. This section puts a plain <a> for EVERY song directly in the SSR
 * HTML, with the Tamil song title as anchor text, so search engines see the
 * whole catalogue's internal links without executing JS. Negligible page weight.
 *
 * Pure/presentational (hrefs are precomputed by the caller) so it's trivially
 * testable and carries no data-fetching concerns.
 */

import Link from 'next/link';

export interface SongLink {
  /** Visible + anchor text — the Tamil song title. */
  title: string;
  /** Root-relative on-site path, e.g. /content/cnt_… */
  href: string;
}

export function AllSongsLinks({ songs }: { songs: SongLink[] }) {
  if (songs.length === 0) return null;

  return (
    <section aria-labelledby="all-songs-heading" className="mt-12 border-t border-gray-800 pt-8">
      <h2 id="all-songs-heading" className="mb-1 font-kavivanar text-2xl text-white">
        எல்லா பாடல்களும் · All songs
      </h2>
      <p className="mb-5 font-tamil text-sm text-gray-400">
        ஒவ்வொரு பாடலின் பக்கத்திற்கும் நேரடி இணைப்பு.
      </p>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {songs.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="font-tamil text-sm leading-snug text-gray-300 transition-colors hover:text-orange-400 focus-visible:text-orange-400 focus-visible:outline-none"
            >
              {s.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
