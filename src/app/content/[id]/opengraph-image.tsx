/**
 * Per-content Open Graph image.
 *
 * Gives every poem/song a branded share card so links dropped into Tamil
 * WhatsApp / Facebook groups (the #1 diaspora sharing channel) render with an
 * image instead of a bare URL. Used automatically by Next for /content/[id]
 * unless `generateMetadata` sets an explicit `openGraph.images` (i.e. when the
 * content has its own `featuredImage`).
 *
 * Latin-only by design — see `ogCardLines` for why we don't render the Tamil
 * title here.
 */

import { ImageResponse } from 'next/og';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ogCardLines } from '@/lib/seo';

export const alt = 'Tamilagaval — Free Tamil songs, poems and stories';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: { id: string } }) {
  let content: { type?: string | null; author?: string | null } = {};
  try {
    const repo = new ContentRepository();
    const found = await repo.findById(params.id);
    if (found) {
      const obj = found.toObject();
      content = { type: obj.type, author: obj.author };
    }
  } catch {
    // Fall back to the generic brand card below.
  }

  const { kicker, title, subtitle, footer } = ogCardLines(content);

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
        <div style={{ fontSize: 96, fontWeight: 800, marginTop: 24, letterSpacing: -2 }}>
          {title}
        </div>
        <div style={{ fontSize: 40, marginTop: 12, opacity: 0.95 }}>{subtitle}</div>
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
    { ...size }
  );
}
