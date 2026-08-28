import { ImageResponse } from 'next/og';

// Author-forward OG card for /about — Facebook / WhatsApp / LinkedIn shares
// of this URL were rendering with NO thumbnail (the parent openGraph metadata
// only set title/description/url, which overrides the site-default image).
// Latin-only copy because Satori (the OG renderer) doesn't ship a Tamil
// glyph set — Tamil script here renders as tofu; the rest of the site's OG
// images follow the same rule.
export const alt = 'About Raj — Tamil poet and lyricist behind Tamilagaval';
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
        <div style={{ fontSize: 44, opacity: 0.9, letterSpacing: 2 }}>ABOUT</div>
        <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -3, marginTop: 4 }}>Raj</div>
        <div style={{ fontSize: 40, marginTop: 20, opacity: 0.95 }}>
          Tamil poet &amp; lyricist
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 40,
            fontSize: 26,
            fontStyle: 'italic',
            background: 'rgba(255,255,255,0.18)',
            padding: '12px 28px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.35)',
          }}
        >
          Where Tamil Poetry Becomes Song · tamilagaval.com
        </div>
      </div>
    ),
    { ...size }
  );
}
