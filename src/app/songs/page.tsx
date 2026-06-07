/**
 * Songs Listing Page — Spotify-style music player.
 */

// MUST stay a build-time prerender. Songs come from DynamoDB, whose IAM
// credentials (APP_AWS_*) are only present at BUILD time (written to
// .env.production.local by amplify.yml); they are NOT inlined for the SSR
// runtime, so a `force-dynamic` render reads no creds and returns an empty
// list. The trade-off is that a newly published song only appears after the
// next deploy (Amplify doesn't run Next's ISR revalidation reliably either).
// To make this dynamic, first give the SSR runtime DB credentials — either
// inline APP_AWS_* in next.config.ts `env:` or grant the Amplify compute role
// DynamoDB read access. See HARDENING.md.
export const revalidate = 300;

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { SongCatalog } from '@/application/use-cases/SongCatalog';
import type { PublicSongDTO } from '@/domain/songs/PublicSong';
import { SongsPlaylist, type SongRow } from '@/components/music/SongsPlaylist';
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

/** Seconds → ISO-8601 duration (e.g. 185 → "PT3M5S") for schema.org. */
function isoDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `PT${m}M${s}S`;
}

/**
 * Published, playable songs as the shared public DTO. Goes through the same
 * SongCatalog use case + PublicSong projection that backs GET /api/songs, so
 * the page and the API can never disagree about what a song is.
 */
async function getSongs(): Promise<PublicSongDTO[]> {
  try {
    return await new SongCatalog(new ContentRepository()).listPublished(100);
  } catch (error) {
    console.error('Failed to fetch songs:', error);
    return [];
  }
}

export async function generateMetadata(): Promise<Metadata> {
  // Pick the first song's cover image if any has one set, otherwise fall back
  // to a static thumbnail so share previews are never blank.
  const songs = await getSongs();
  const firstCover = songs.map((s) => s.coverUrl).find((src): src is string => !!src);
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
  // Adapt the public DTO to the playlist UI's row shape (presentation only —
  // the domain rules already ran in SongCatalog/PublicSong).
  const tracks: SongRow[] = songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    src: s.audio.url,
    cover: s.coverUrl,
    duration: s.audio.durationSeconds,
    addedAt: Date.parse(s.publishedAt) || undefined,
    theme: s.theme,
    youtubeVideoId: s.youtubeVideoId,
  }));
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
