'use client';

/**
 * The link from tamilagaval.com to the Studio mastering pilot.
 *
 * Two variants, one component, so the copy and the tracking cannot drift apart:
 *   - `nav`   — a restrained entry in the header
 *   - `panel` — the stronger contextual block on music pages
 *
 * IMPRESSIONS ARE COUNTED ON VISIBILITY, NOT ON RENDER. A nav item that exists
 * in the DOM on every page would otherwise report an impression for every
 * pageview, and the impression → click rate would be meaningless. The
 * IntersectionObserver means an impression records only when the CTA was
 * actually on screen.
 *
 * Each step fires AT MOST ONCE per mount, for the same reason the pilot page
 * does it: one scroller must not look like ten visitors.
 */

import { useEffect, useRef } from 'react';
import {
  studioUrl,
  STUDIO_IMPRESSION,
  STUDIO_CLICK,
  STUDIO_EVENT_ENDPOINT,
  STUDIO_PRICE_CAD,
  type StudioPlacement,
} from '@/lib/studio-cta';

type GtagFn = (...args: unknown[]) => void;

/**
 * Fire-and-forget to the pilot's counter AND to GA4.
 *
 * ⚠️ The GA4 parameter is `cta_source`, never `source` — a reserved campaign
 * field that silently rewrites session attribution. See studio-cta.ts.
 */
function track(step: string, placement: StudioPlacement): void {
  try {
    fetch(STUDIO_EVENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: step }),
      keepalive: true,
      mode: 'cors',
    }).catch(() => {});
  } catch {
    /* analytics must never break the page */
  }
  if (typeof window !== 'undefined') {
    const g = (window as unknown as { gtag?: GtagFn }).gtag;
    if (typeof g === 'function') g('event', step, { cta_source: placement });
  }
}

interface Props {
  placement: StudioPlacement;
  variant?: 'nav' | 'panel';
  className?: string;
}

export function StudioCta({ placement, variant = 'nav', className = '' }: Props) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const seen = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen.current) return;
    // No IntersectionObserver (old browser, jsdom) — count it as seen rather
    // than losing the step entirely; an undercount would read as "nobody saw
    // it", which is the exact wrong conclusion.
    if (typeof IntersectionObserver === 'undefined') {
      seen.current = true;
      track(STUDIO_IMPRESSION, placement);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !seen.current) {
            seen.current = true;
            track(STUDIO_IMPRESSION, placement);
            io.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [placement]);

  const onClick = () => track(STUDIO_CLICK, placement);
  const href = studioUrl(placement);

  if (variant === 'nav') {
    return (
      <a
        ref={ref}
        href={href}
        onClick={onClick}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 font-tamil font-medium text-gray-300 transition-all hover:bg-gray-800/50 hover:text-white ${className}`}
      >
        Studio
        <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-400">
          new
        </span>
      </a>
    );
  }

  return (
    <aside
      className={`rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900/50 ${className}`}
    >
      <h2 className="font-tamil text-lg font-semibold text-gray-900 dark:text-gray-100">
        TamilAgaval Studio
      </h2>
      <p className="mt-1 font-tamil text-sm text-gray-600 dark:text-gray-400">
        உங்கள் பாடலை streaming-க்குத் தயார் செய்யுங்கள். முடிக்கப்பட்ட mix-ஐ அனுப்புங்கள் —
        streaming மற்றும் YouTube-க்கான master, முன்/பின் ஒப்பீட்டுடன் திரும்பக் கிடைக்கும்.
      </p>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        Introductory CAD ${STUDIO_PRICE_CAD} per song · mastering, not mixing
      </p>
      <a
        ref={ref}
        href={href}
        onClick={onClick}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
      >
        Request a master →
      </a>
    </aside>
  );
}
