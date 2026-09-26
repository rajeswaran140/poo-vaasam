/**
 * Share card for /songs/<theme>.
 *
 * ⚠️ ADDED 2026-09-26. All four theme routes — love, mother, nature, homeland —
 * served no og:image, for the same reason /shorts and /karaoke did: the route's
 * `generateMetadata` declares an `openGraph` block, which REPLACES the root
 * layout's wholesale, and it carries no `images`.
 *
 * Unlike a fixed card this one is per-theme: the segment is dynamic, so the
 * card receives `params` and names the collection a sharer is actually linking
 * to. The English title carries the search intent, the Tamil title is what the
 * reader recognises, so both appear.
 *
 * The four titles come from SONG_COLLECTIONS, the same registry the page, the
 * sitemap and generateStaticParams read — its header notes that is exactly so
 * they can never disagree. Do not retype them here.
 */
import { ImageResponse } from 'next/og';
import { SONG_COLLECTIONS, isCollectionTheme } from '@/config/song-collections';

export const alt = 'Tamilagaval — Tamil songs by Raj';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage({ params }: { params: Promise<{ theme: string }> }) {
  const { theme } = await params;
  // An unknown theme 404s on the page itself; the card must still render
  // something rather than throw inside the image pipeline.
  const c = isCollectionTheme(theme) ? SONG_COLLECTIONS[theme] : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #f97316 0%, #ea580c 60%, #c2410c 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
          padding: '0 80px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 100 }}>🎵</div>
        <div style={{ fontSize: 68, fontWeight: 800, marginTop: 8 }}>
          {c ? c.tamilTitle : 'பாடல்கள்'}
        </div>
        {/* ⚠️ ONE child, not two. satori refuses any <div> with more than one
            child unless it declares display:flex — and `{expr} · by Raj` is an
            expression plus a text node. Rendering this card for real is what
            caught it; tsc cannot. */}
        <div style={{ fontSize: 38, marginTop: 14, opacity: 0.95 }}>
          {`${c ? c.englishTitle : 'Tamil Songs'} · by Raj`}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 32,
            fontSize: 26,
            background: 'rgba(255,255,255,0.18)',
            padding: '10px 26px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.35)',
          }}
        >
          Always free · tamilagaval.com
        </div>
      </div>
    ),
    { ...size }
  );
}
