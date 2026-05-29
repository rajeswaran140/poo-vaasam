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
        <section className="w-full bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
          <div className="w-full px-6 pb-10 pt-24 sm:px-10 lg:px-16">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
              <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-700 shadow-2xl sm:h-52 sm:w-52">
                <span className="text-7xl">🎵</span>
              </div>
              <div className="min-w-0">
                <p className="mb-2 font-tamil text-xs font-semibold uppercase tracking-wide text-white/80">
                  தொகுப்பு
                </p>
                <h1 className="mb-4 font-kavivanar text-4xl font-extrabold leading-tight sm:text-6xl lg:text-7xl">
                  பாடல்கள்
                </h1>
                <p className="mb-2 font-tamil text-white/90">தமிழ் பாடல்கள் தொகுப்பு — என்றும் இலவசம்</p>
                {playableCount > 0 && (
                  <p className="font-tamil text-sm text-white/80">
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
