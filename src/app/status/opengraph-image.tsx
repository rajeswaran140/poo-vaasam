import { ImageResponse } from 'next/og';

// Social-share image for /status. The page sets no openGraph image (and the root
// card isn't inherited once a route is its own surface), so without this, sharing
// the Status-gallery link — ironically — yields a bare card. Latin-only text:
// Satori has no bundled Tamil glyphs, so Tamil would render as tofu.
export const alt = 'Share Tamil song clips to your WhatsApp Status · Tamilagaval';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function StatusOpengraphImage() {
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
          background: 'linear-gradient(135deg, #075E54 0%, #128C7E 60%, #25D366 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: -2 }}>WhatsApp Status Clips</div>
        <div style={{ fontSize: 38, marginTop: 14, opacity: 0.95 }}>Tamil song shorts · one-tap share</div>
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
          tamilagaval.com/status
        </div>
      </div>
    ),
    { ...size }
  );
}
