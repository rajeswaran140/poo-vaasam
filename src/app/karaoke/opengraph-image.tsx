/**
 * Share card for /karaoke.
 *
 * ⚠️ ADDED 2026-09-25. This page was the ONLY route on the site serving no
 * og:image at all — and it is the page that gets sold over WhatsApp, whose
 * scraper is exactly what these cards exist for (see content-metadata.test.ts).
 *
 * The cause was subtle: declaring an `openGraph` block in page metadata
 * REPLACES the root layout's wholesale, and that block carries no `images`.
 * /contact keeps the site card precisely because it declares no openGraph at
 * all; /music-composition survives the same override only because it ships a
 * co-located card like this one.
 *
 * Price and turnaround are IMPORTED, never retyped — lib/karaoke.ts warns that
 * three hand-maintained copies of a number will drift, and a card baked into a
 * PNG is the worst possible fourth copy to discover is stale.
 */
import { ImageResponse } from 'next/og';
import { KARAOKE_PRICE_LABEL, KARAOKE_TURNAROUND_LABEL } from '@/lib/karaoke';

export const alt = 'Tamilagaval — Tamil Karaoke Tracks';
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
        <div style={{ fontSize: 120 }}>🎤</div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 8 }}>Karaoke Tracks</div>
        <div style={{ fontSize: 36, marginTop: 12, opacity: 0.95 }}>
          Sing our songs yourself · Tamilagaval
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
          {KARAOKE_PRICE_LABEL} per song · {KARAOKE_TURNAROUND_LABEL}
        </div>
      </div>
    ),
    { ...size }
  );
}
