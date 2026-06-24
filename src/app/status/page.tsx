/**
 * /status — "Share to WhatsApp Status" gallery.
 *
 * Surfaces the curated vertical clips (src/config/status-clips.ts) so the
 * audience can post them to WhatsApp Status in one tap — the biggest dark-social
 * surface for the diaspora-Tamil audience (project_tamilagaval_whatsapp). The
 * clip→song join is done here against the live Songs catalogue so titles never
 * go stale; a clip whose song is unpublished is silently dropped. The card poster
 * is the short's OWN thumbnail (posterForClip), not the song cover — see
 * src/config/status-clips.ts.
 */

export const revalidate = 300;

import type { Metadata } from 'next';
import Link from 'next/link';
import { alternatesFor, SITE_NAME, absoluteUrl, breadcrumbJsonLd } from '@/lib/seo';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { SongCatalog } from '@/application/use-cases/SongCatalog';
import { STATUS_CLIPS, posterForClip } from '@/config/status-clips';
import { contentPath } from '@/config/vanity-paths';
import { JsonLd } from '@/components/JsonLd';
import { StatusShareGallery, type StatusClipView } from '@/components/status/StatusShareGallery';

const TITLE = 'WhatsApp Status Clips — Tamil Song Shorts';
const DESCRIPTION =
  'Tamilagaval-இன் குறும்படங்களை ஒரே தட்டில் WhatsApp Status-இல் பகிருங்கள் — Share Tamil song clips to your WhatsApp Status.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor('/status'),
  openGraph: {
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    url: absoluteUrl('/status'),
    type: 'website',
    siteName: SITE_NAME,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | ${SITE_NAME}`, description: DESCRIPTION },
};

async function getClips(): Promise<StatusClipView[]> {
  try {
    const songs = await new SongCatalog(new ContentRepository()).listPublished(100);
    const byId = new Map(songs.map((s) => [s.id, s]));
    return STATUS_CLIPS.map(({ songId, clip }): StatusClipView | null => {
      const song = byId.get(songId);
      if (!song) return null;
      return {
        songId,
        title: song.title,
        path: contentPath(song.id),
        clip,
        cover: posterForClip(clip),
      };
    }).filter((c): c is StatusClipView => c !== null);
  } catch (error) {
    console.error('Failed to load status clips:', error);
    return [];
  }
}

export default async function StatusPage() {
  const clips = await getClips();

  const breadcrumb = breadcrumbJsonLd([
    { name: 'முகப்பு', path: '/' },
    { name: 'WhatsApp Status', path: '/status' },
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <JsonLd data={[breadcrumb]} />

      <header className="bg-gradient-to-r from-[#075E54] to-[#128C7E] py-14 text-white">
        <div className="container mx-auto px-4">
          <Link href="/" className="mb-4 inline-block font-tamil text-emerald-100 hover:text-white">
            ← முகப்புக்குத் திரும்புங்கள்
          </Link>
          <h1 className="mb-3 font-tamil text-3xl font-bold sm:text-5xl">📲 Status-இல் பகிருங்கள்</h1>
          <p className="max-w-2xl font-tamil text-lg text-emerald-50">
            தமிழகவல் பாடல்களின் குறும்படங்கள் — ஒரே தட்டில் உங்கள் WhatsApp Status-இல் பகிருங்கள். உங்கள்
            நண்பர்களும் கேட்கட்டும்! 🎶
          </p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-10">
        <p className="mb-6 font-tamil text-sm text-gray-600">
          📱 கைபேசியில்: <strong>“Status-இல் பகிர்”</strong> → WhatsApp → <em>My status</em>. கணினியில்:{' '}
          <strong>⬇️</strong> பதிவிறக்கி, கைபேசியில் Status-ஆகப் பதிவிடுங்கள்.
        </p>
        <StatusShareGallery clips={clips} />
      </div>
    </div>
  );
}
