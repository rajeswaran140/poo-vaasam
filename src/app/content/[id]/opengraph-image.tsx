/**
 * Per-content Open Graph image.
 *
 * Gives every poem/song a branded share card so links dropped into Tamil
 * WhatsApp / Facebook groups (the #1 diaspora sharing channel) render with an
 * image instead of a bare URL. Used automatically by Next for /content/[id]
 * unless `generateMetadata` sets an explicit `openGraph.images` (i.e. when the
 * content has its own `featuredImage`).
 *
 * We try to render the real Tamil title using a subsetted Noto Sans Tamil font
 * fetched at render time. Satori has no Tamil glyphs of its own, so if the font
 * fetch fails we fall back to a Latin-only card (romanised type + author) —
 * never tofu.
 */

import { ImageResponse } from 'next/og';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ogCardLines, parseGoogleFontUrl } from '@/lib/seo';

export const alt = 'Tamilagaval — Free Tamil songs, poems and stories';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Fetch a Noto Sans Tamil TTF subsetted to just the glyphs in `text`. Returns
 * null on any failure so the caller degrades to the Latin card.
 */
async function loadTamilFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const api = `https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@700&text=${encodeURIComponent(text)}`;
    // An older User-Agent makes Google serve TTF (Satori can't parse woff2).
    const cssRes = await fetch(api, {
      headers: { 'User-Agent': 'Mozilla/4.0 (compatible; Tamilagaval OG)' },
    });
    if (!cssRes.ok) return null;
    const fontUrl = parseGoogleFontUrl(await cssRes.text());
    if (!fontUrl) return null;
    const fontRes = await fetch(fontUrl);
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: { id: string } }) {
  let content: { type?: string | null; author?: string | null; title?: string | null } = {};
  try {
    const repo = new ContentRepository();
    const found = await repo.findById(params.id);
    if (found) {
      const obj = found.toObject();
      content = { type: obj.type, author: obj.author, title: obj.title };
    }
  } catch {
    // Fall back to the generic brand card below.
  }

  const { kicker, title: romanisedType, subtitle, footer } = ogCardLines(content);

  // Clamp the Tamil title so it can't overflow the card, then try to load a
  // font that can render it.
  const tamilTitle = (content.title ?? '').trim().slice(0, 60);
  const fontData = tamilTitle ? await loadTamilFont(tamilTitle) : null;
  const showTamil = Boolean(fontData && tamilTitle);

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
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 6, opacity: 0.9 }}>
          {kicker}
        </div>

        {showTamil ? (
          <>
            <div
              style={{
                fontFamily: 'Noto Sans Tamil',
                fontSize: tamilTitle.length > 24 ? 72 : 96,
                fontWeight: 700,
                marginTop: 24,
                lineHeight: 1.25,
              }}
            >
              {tamilTitle}
            </div>
            <div style={{ fontSize: 34, marginTop: 16, opacity: 0.95 }}>
              {romanisedType} · {subtitle}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 96, fontWeight: 800, marginTop: 24, letterSpacing: -2 }}>
              {romanisedType}
            </div>
            <div style={{ fontSize: 40, marginTop: 12, opacity: 0.95 }}>{subtitle}</div>
          </>
        )}

        <div
          style={{
            display: 'flex',
            marginTop: 40,
            fontSize: 26,
            background: 'rgba(255,255,255,0.18)',
            padding: '12px 28px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.35)',
          }}
        >
          {footer}
        </div>
      </div>
    ),
    {
      ...size,
      ...(fontData
        ? { fonts: [{ name: 'Noto Sans Tamil', data: fontData, weight: 700 as const, style: 'normal' as const }] }
        : {}),
    }
  );
}
