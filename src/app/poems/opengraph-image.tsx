import { ImageResponse } from 'next/og';

// Social-share image for /poems (the static metadata sets no image, and the
// root card isn't inherited once a route defines its own openGraph). Latin-only
// text — Satori has no bundled Tamil glyphs, so "கவிதைகள்" would render as tofu.
export const alt = 'Tamil Poems & Kavithai — Tamilagaval';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function PoemsOpengraphImage() {
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
        <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -2 }}>Tamil Poems</div>
        <div style={{ fontSize: 40, marginTop: 12, opacity: 0.95 }}>Kavithai · Tamilagaval</div>
        <div
          style={{
            display: 'flex',
            marginTop: 36,
            fontSize: 28,
            background: 'rgba(255,255,255,0.18)',
            padding: '12px 28px',
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
