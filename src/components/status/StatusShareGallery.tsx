'use client';

/**
 * "Share to WhatsApp Status" gallery — turns the curated vertical clips
 * (see src/config/status-clips.ts) into a one-tap distribution surface for the
 * audience's #1 dark-social channel (WhatsApp Status; see
 * project_tamilagaval_whatsapp).
 *
 * The share button hands the *actual video file* to `navigator.share({files})`
 * on mobile → the user picks WhatsApp → posts to Status (or a chat). The file is
 * same-origin (/clips/…) so the fetch isn't CORS-blocked. Desktop / unsupported
 * browsers fall back to sharing the song LINK via wa.me, and a Download button
 * always lets you grab the clip to post manually. Every share is recorded
 * first-party via trackShare so this dark-social channel stays measurable.
 */

import { useState } from 'react';
import Link from 'next/link';
import { whatsappShareText, whatsappShareUrl } from '@/lib/whatsapp-share';
import { trackShare } from '@/lib/analytics-events';
import { absoluteUrl } from '@/lib/seo';
import { WhatsAppGlyph } from '@/components/content/WhatsAppShareButton';

export interface StatusClipView {
  songId: string;
  title: string;
  /** Root-relative song path (in-site navigation + base for the absolute share URL). */
  path: string;
  /** Same-origin clip file under /public (CORS-free for share/download). */
  clip: string;
  /** Poster image — the short's OWN thumbnail (same-origin <slug>-short.jpg). */
  cover?: string;
}

export function StatusShareCard({ songId, title, path, clip, cover }: StatusClipView) {
  const [busy, setBusy] = useState(false);
  const contentUrl = absoluteUrl(path);
  const fileName = clip.split('/').pop() || 'tamilagaval.mp4';
  // Stable per-asset id (the clip's file stem) — ready for A/B variants later.
  const assetId = fileName.replace(/\.mp4$/, '') || undefined;
  // Status-specific attribution: distinct medium + campaign, and utm_content =
  // the source song so an inbound landing traces back to the exact song shared.
  const statusUtm = {
    utm_medium: 'whatsapp_status',
    utm_campaign: 'status_share',
    utm_content: songId,
  };

  async function handleShare() {
    trackShare('whatsapp_status', { songId, assetId });
    const caption = whatsappShareText({ title, url: contentUrl, verb: 'listen', utm: statusUtm });

    // Preferred path (mobile): share the real video file so the user can post it
    // straight to WhatsApp Status. canShare({files}) gates it — false on desktop.
    try {
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
      if (typeof nav.canShare === 'function' && typeof nav.share === 'function') {
        setBusy(true);
        const res = await fetch(clip);
        const blob = await res.blob();
        const file = new File([blob], fileName, { type: blob.type || 'video/mp4' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], text: caption, title });
          return;
        }
      }
    } catch (err) {
      // User dismissed the share sheet → done (not an error).
      if ((err as { name?: string })?.name === 'AbortError') return;
      // No file support / fetch failure → fall through to the link share.
    } finally {
      setBusy(false);
    }

    // Fallback: share the song link (text) via wa.me.
    window.open(
      whatsappShareUrl({ title, url: contentUrl, verb: 'listen', utm: statusUtm }),
      '_blank',
      'noopener,noreferrer'
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-lg">
      <video
        src={clip}
        poster={cover}
        controls
        playsInline
        preload="metadata"
        className="aspect-[9/16] w-full bg-black object-cover"
        aria-label={`${title} — குறும்படம்`}
      />
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <h3 className="line-clamp-2 font-tamil text-base font-bold text-gray-900 sm:text-lg">{title}</h3>
        <div className="mt-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
            aria-label={`${title} — WhatsApp Status-இல் பகிருங்கள்`}
            // #0b7a5b (not the lighter brand #25D366): white-on-green here is
            // 5.3:1 → passes WCAG AA for this small text, while staying WhatsApp green.
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#0b7a5b] px-3 py-2 font-tamil text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0a6e52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b7a5b]/60 disabled:opacity-60"
          >
            <WhatsAppGlyph className="h-4 w-4" />
            {busy ? 'தயாராகிறது…' : 'Status-இல் பகிருங்கள்'}
          </button>
          <a
            href={clip}
            download={fileName}
            aria-label={`${title} — குறும்படத்தைச் சேமி`}
            title="சேமி"
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
          >
            ⬇️
          </a>
        </div>
        <Link
          href={path}
          className="text-center font-tamil text-sm text-purple-600 transition-colors hover:text-purple-700"
        >
          முழுப் பாடல் →
        </Link>
      </div>
    </div>
  );
}

export function StatusShareGallery({ clips }: { clips: StatusClipView[] }) {
  if (clips.length === 0) {
    return (
      <p className="py-16 text-center font-tamil text-gray-500">
        இன்னும் குறும்படங்கள் இல்லை — விரைவில் வரும்.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {clips.map((c) => (
        <StatusShareCard key={c.songId} {...c} />
      ))}
    </div>
  );
}
