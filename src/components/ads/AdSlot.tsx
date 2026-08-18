'use client';

/**
 * One explicitly-placed ad unit.
 *
 * ⚠️ RESERVES ITS HEIGHT BEFORE THE AD ARRIVES. An ad unit that expands after
 * load pushes the text down under the reader's eye — that is a Cumulative
 * Layout Shift, it is the single most common way ads wreck Core Web Vitals, and
 * on a page of poetry it is worse than the lost revenue. `minHeight` holds the
 * space from first paint.
 *
 * Renders nothing where ads are not permitted, so a slot can be dropped into a
 * shared layout without it leaking onto /admin or the paid pages.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ADSENSE_CLIENT, adsAllowedOn } from '@/lib/adsense';

declare global {
  interface Window { adsbygoogle?: unknown[] }
}

interface Props {
  /** Ad unit id from the AdSense console (data-ad-slot). */
  slot: string;
  /** Reserved height in px — must match the unit's real size to avoid shift. */
  minHeight?: number;
  className?: string;
}

export function AdSlot({ slot, minHeight = 280, className = '' }: Props) {
  const pathname = usePathname();
  const pushed = useRef(false);
  const allowed = adsAllowedOn(pathname ?? '/');

  useEffect(() => {
    if (!allowed || !slot || pushed.current) return;
    // React 18 StrictMode runs effects twice in dev; a second push on the same
    // <ins> throws "All 'ins' elements already have ads in them".
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // A blocked or failed ad must never break the page around it.
    }
  }, [allowed, slot]);

  // No unit id yet (account approved but unit not created) → render nothing
  // rather than an empty reserved box.
  if (!allowed || !slot) return null;

  return (
    <div className={`my-8 ${className}`} style={{ minHeight }} aria-hidden="true">
      {/* Labelled for the reader — an unmarked ad on an author's own page reads
          as an endorsement. Small, muted, above the unit. */}
      <p className="mb-1 text-center text-[11px] uppercase tracking-wide text-gray-400">
        விளம்பரம் · Advertisement
      </p>
      <ins
        className="adsbygoogle block"
        style={{ display: 'block', minHeight }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
