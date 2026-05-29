/**
 * Songs Listing Page — Spotify-style music player.
 */

export const revalidate = 300;

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { SongsPlaylist, type SongRow } from '@/components/music/SongsPlaylist';
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

/** Normalise a createdAt value (Date | ISO string | epoch) to epoch ms. */
function toEpochMs(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

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
  const tracks: SongRow[] = songs.map((s: Record<string, unknown>) => ({
    id: String(s.id),
    title: String(s.title),
    artist: String(s.author || ''),
    src: typeof s.audioUrl === 'string' ? s.audioUrl : '',
    cover: typeof s.featuredImage === 'string' ? s.featuredImage : undefined,
    duration: typeof s.audioDuration === 'number' ? s.audioDuration : undefined,
    addedAt: toEpochMs(s.createdAt),
  }));
  const playableCount = tracks.filter((t) => t.src).length;

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
        <SongsPlaylist tracks={tracks} />
      </main>
    </div>
  );
}
