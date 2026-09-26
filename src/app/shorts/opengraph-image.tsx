/**
 * Share card for /shorts.
 *
 * ⚠️ ADDED 2026-09-26. /shorts was the only route on the site serving no
 * og:image — the same defect /karaoke carried until PR #355, and the same
 * cause: declaring an `openGraph` block REPLACES the root layout's wholesale,
 * and this one has no `images`. /contact keeps the site card precisely because
 * it declares no openGraph at all.
 *
 * ⚠️ DELIBERATELY STATIC, unlike /videos. That page derives og:image from its
 * newest video's thumbnail, which is the nicer result for a feed — but /videos
 * and /shorts are both `force-dynamic`, so deriving it means a SECOND YouTube
 * feed fetch on every request, on a page whose cold render already costs ~4s.
 * A fixed card costs nothing at request time. Revisit if the page ever becomes
 * cacheable.
 */
import { ImageResponse } from 'next/og';

export const alt = 'Tamilagaval — Tamil Shorts by Raj';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
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
        }}
      >
        <div style={{ fontSize: 120 }}>🎬</div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 8 }}>Tamil Shorts</div>
        <div style={{ fontSize: 36, marginTop: 12, opacity: 0.95 }}>
          Songs and poetry in under three minutes
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
