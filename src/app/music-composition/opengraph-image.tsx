import { ImageResponse } from 'next/og';

export const alt = 'Tamilagaval — Custom Tamil Music Composition';
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
        <div style={{ fontSize: 120 }}>🎼</div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 8 }}>Music Composition</div>
        <div style={{ fontSize: 36, marginTop: 12, opacity: 0.95 }}>
          Custom Tamil music · Tamilagaval
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
          Affordable · Free quote · tamilagaval.com
        </div>
      </div>
    ),
    { ...size }
  );
}
