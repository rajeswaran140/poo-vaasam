import { ImageResponse } from 'next/og';

// Default social-share image, applied site-wide unless a page overrides it.
export const alt = 'Tamilagaval — Free Tamil literature: songs, poems, stories';
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
        <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: -2 }}>Tamilagaval</div>
        <div style={{ fontSize: 40, marginTop: 16, opacity: 0.95 }}>
          Tamil Songs · Poems · Stories
        </div>
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
