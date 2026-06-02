/**
 * Songs Listing Page — Spotify-style music player.
 */

// Render per-request rather than as a build-time prerender. Amplify's SSR
// compute doesn't run Next's time-based ISR revalidation reliably (its
// incremental cache isn't persisted across Lambda instances), so a `revalidate`
// route freezes at build time — newly published songs never appear until the
// next deploy. Dynamic rendering reads DynamoDB fresh on every request.
export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { SongsPlaylist, type SongRow } from '@/components/music/SongsPlaylist';
import { themeForSongWithOverride } from '@/config/song-themes';
import { JsonLd } from '@/components/JsonLd';
import { SITE_NAME, absoluteUrl } from '@/lib/seo';

// Crawler-facing title/description use romanised English so the page ranks for
// real queries (tamil songs / paadal varigal); the visible <h1> on the page
// stays "பாடல்கள்".
const META_TITLE = 'Tamil Songs & Paadal Varigal';
const META_DESCRIPTION =
  'Free Tamil songs and paadal varigal by Rajeswaran Thangarajah — listen, read the lyrics, share. Always free.';
const JSONLD_NAME = 'Tamil Songs & Paadal Varigal — Tamilagaval';

/**
 * Best available share image:
 * - First song's featuredImage if set
 * - Otherwise the top YouTube video's maxres thumbnail (real photo of the work)
 * Keeps WhatsApp/FB/X previews from being blank.
 */
const FALLBACK_OG_IMAGE =
  'https://i.ytimg.com/vi/gfywsN483lI/maxresdefault.jpg';

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

export async function generateMetadata(): Promise<Metadata> {
  // Pick the first song's cover image if any has one set, otherwise fall back
  // to a static thumbnail so share previews are never blank.
  const songs = await getSongs();
  const firstCover = songs
    .map((s: Record<string, unknown>) => (typeof s.featuredImage === 'string' ? s.featuredImage : ''))
    .find((src: string) => src.length > 0);
  const ogImage = firstCover || FALLBACK_OG_IMAGE;
  return {
    title: META_TITLE,
    description: META_DESCRIPTION,
    alternates: { canonical: '/songs' },
    openGraph: {
      title: `${META_TITLE} | ${SITE_NAME}`,
      description: META_DESCRIPTION,
      url: '/songs',
      type: 'music.playlist',
      siteName: SITE_NAME,
      images: [{ url: ogImage, width: 1280, height: 720 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${META_TITLE} | ${SITE_NAME}`,
      description: META_DESCRIPTION,
      images: [ogImage],
    },
  };
}

export default async function SongsPage() {
  const songs = await getSongs();
  const tracks: SongRow[] = songs.map((s: Record<string, unknown>) => {
    const id = String(s.id);
    return {
      id,
      title: String(s.title),
      artist: String(s.author || ''),
      src: typeof s.audioUrl === 'string' ? s.audioUrl : '',
      cover: typeof s.featuredImage === 'string' ? s.featuredImage : undefined,
      duration: typeof s.audioDuration === 'number' ? s.audioDuration : undefined,
      addedAt: toEpochMs(s.createdAt),
      theme: themeForSongWithOverride(id, s.theme),
      youtubeVideoId: typeof s.youtubeVideoId === 'string' ? s.youtubeVideoId : undefined,
    };
  });
  const playableCount = tracks.filter((t) => t.src).length;

  const firstCover = tracks.map((t) => t.cover).find((c) => !!c);
  const playlistImage = firstCover || FALLBACK_OG_IMAGE;

  const playlistJsonLd =
    playableCount > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'MusicPlaylist',
          name: JSONLD_NAME,
          description: META_DESCRIPTION,
          url: absoluteUrl('/songs'),
          inLanguage: 'ta',
          image: playlistImage,
          numTracks: playableCount,
          track: tracks
            .filter((t) => t.src)
            .map((t, i) => ({
              '@type': 'MusicRecording',
              position: i + 1,
              name: t.title,
              url: absoluteUrl(`/content/${t.id}`),
              inLanguage: 'ta',
              byArtist: { '@type': 'Person', name: t.artist },
              audio: { '@type': 'AudioObject', contentUrl: t.src },
              ...(t.duration ? { duration: isoDuration(t.duration) } : {}),
            })),
        }
      : null;

  return (
    <div className="min-h-screen flex flex-col">
      {playlistJsonLd && <JsonLd data={playlistJsonLd} />}
      <Header />
      <main className="flex-1">
        <SongsPlaylist tracks={tracks} />
      </main>
      <Footer />
    </div>
  );
}
