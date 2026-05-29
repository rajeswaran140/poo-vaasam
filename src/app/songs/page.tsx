/**
 * Songs Listing Page — Spotify-style music player.
 */

export const revalidate = 300;

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { SongList } from '@/components/music/SongList';
import type { Track } from '@/components/music/MusicPlayerProvider';
import { JsonLd } from '@/components/JsonLd';
import { SITE_NAME, absoluteUrl } from '@/lib/seo';

const PAGE_TITLE = 'பாடல்கள்';
const PAGE_DESCRIPTION =
  'தமிழ் பாடல்கள் தொகுப்பு — இலவசமாகக் கேளுங்கள், படியுங்கள், பாருங்கள்.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/songs' },
  openGraph: {
    title: `${PAGE_TITLE} | ${SITE_NAME}`,
    description: PAGE_DESCRIPTION,
    url: '/songs',
    type: 'music.playlist',
    siteName: SITE_NAME,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PAGE_TITLE} | ${SITE_NAME}`,
    description: PAGE_DESCRIPTION,
  },
};

/** Seconds → ISO-8601 duration (e.g. 185 → "PT3M5S") for schema.org. */
function isoDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `PT${m}M${s}S`;
}

async function getSongs() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findByType(ContentType.SONGS, {
      limit: 100,
      status: ContentStatus.PUBLISHED,
    });
    return result.items.map((item) => item.toObject());
  } catch (error) {
    console.error('Failed to fetch songs:', error);
    return [];
  }
}

export default async function SongsPage() {
  const songs = await getSongs();
  const tracks: Track[] = songs.map((s: Record<string, unknown>) => ({
    id: String(s.id),
    title: String(s.title),
    artist: String(s.author || ''),
    src: typeof s.audioUrl === 'string' ? s.audioUrl : '',
    cover: typeof s.featuredImage === 'string' ? s.featuredImage : undefined,
    duration: typeof s.audioDuration === 'number' ? s.audioDuration : undefined,
  }));
  const playableCount = tracks.filter((t) => t.src).length;
  const totalMin = Math.round(tracks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60);

  const playlistJsonLd =
    playableCount > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'MusicPlaylist',
          name: PAGE_TITLE,
          description: PAGE_DESCRIPTION,
          url: absoluteUrl('/songs'),
          numTracks: playableCount,
          track: tracks
            .filter((t) => t.src)
            .map((t, i) => ({
              '@type': 'MusicRecording',
              position: i + 1,
              name: t.title,
              url: absoluteUrl(`/content/${t.id}`),
              byArtist: { '@type': 'Person', name: t.artist },
              audio: { '@type': 'AudioObject', contentUrl: t.src },
              ...(t.duration ? { duration: isoDuration(t.duration) } : {}),
            })),
        }
      : null;

  return (
    <div className="min-h-screen">
      {playlistJsonLd && <JsonLd data={playlistJsonLd} />}
      <Header />
      <main>
        {/* Full-width Spotify-style playlist header (fades into the dark page) */}
        <section className="relative w-full overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
          {/* soft top-corner highlight */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_12%_-15%,rgba(255,255,255,0.38),transparent_55%)]"
          />
          {/* fade into the dark page below */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-gray-900"
          />

          <div className="relative w-full px-6 pb-14 pt-24 sm:px-10 lg:px-16">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
              <div className="group flex h-40 w-40 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-700 shadow-2xl ring-1 ring-white/20 transition-transform duration-500 ease-out hover:scale-[1.03] animate-fade-in sm:h-52 sm:w-52">
                <span className="text-7xl drop-shadow-lg transition-transform duration-500 ease-out group-hover:scale-110">
                  🎵
                </span>
              </div>
              <div className="min-w-0 animate-fade-in-up">
                <span className="mb-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 font-tamil text-xs font-semibold uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-sm">
                  தொகுப்பு
                </span>
                <h1 className="mb-4 font-kavivanar text-5xl font-extrabold leading-tight drop-shadow-md sm:text-6xl lg:text-7xl">
                  பாடல்கள்
                </h1>
                <p className="mb-2 font-tamil text-white/90">தமிழ் பாடல்கள் தொகுப்பு — என்றும் இலவசம்</p>
                {playableCount > 0 && (
                  <p className="flex items-center gap-2 font-tamil text-sm text-white/85">
                    <span aria-hidden className="inline-flex h-1.5 w-1.5 rounded-full bg-white/80" />
                    {playableCount} பாடல்கள்{totalMin > 0 ? ` · ${totalMin} நிமிடம்` : ''}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="container mx-auto px-4 py-8">
          {tracks.length === 0 ? (
            <div className="py-20 text-center">
              <div className="mb-4 text-6xl">🎵</div>
              <h2 className="mb-2 font-tamil text-2xl font-bold text-white">இன்னும் பாடல்கள் இல்லை</h2>
              <p className="font-tamil text-gray-400">புதிய உள்ளடக்கத்திற்காகப் பின்னர் சரிபார்க்கவும்</p>
            </div>
          ) : (
            <SongList tracks={tracks} />
          )}
        </div>
      </main>
    </div>
  );
}
