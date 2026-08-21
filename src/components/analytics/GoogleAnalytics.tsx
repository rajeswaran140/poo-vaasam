'use client';

/**
 * Google Analytics 4 — loads gtag.js once and re-fires `page_view` on every
 * client-side route change (the default GA SPA snippet only counts the first
 * page, so without this Next.js App Router visits look like one-page sessions).
 *
 * Renders nothing (and ships no scripts) when no GA ID is configured.
 */

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isProductionHostForAnalytics } from '@/lib/analytics';

declare global {
  interface Window { gtag?: (...args: unknown[]) => void; dataLayer?: unknown[] }
}

export function GoogleAnalytics({ gaId }: { gaId: string }) {
  const pathname = usePathname();

  // `gtag('config')` already sends the initial page_view, so fire manual ones
  // ONLY on subsequent client-side route changes — skip the first effect run so
  // the landing page isn't double-counted. (GA4 derives the path from
  // page_location; the old UA-style `page_path` param was ignored.)
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (!gaId || typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    // Same production-host gate applied at render (below) — a preview branch's
    // useEffect must not fire pageviews even when gtag was somehow initialised.
    if (!isProductionHostForAnalytics(window.location.hostname)) return;
    window.gtag('event', 'page_view', {
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, gaId]);

  if (!gaId) return null;

  // Production-host gate. Amplify preview branches (`*.amplifyapp.com`),
  // `localhost`, and any staging alias must NOT fire the production GA4
  // property — every dev iteration would otherwise pollute the real
  // dashboard. Checked inline (not useState/useEffect) because the useEffect
  // pattern induces an extra render cycle that our SPA-page_view test
  // struggles to disentangle from the enabled flip. Kept as `typeof window`
  // guard so SSR renders normally and the client short-circuits on preview.
  // (Hydration-mismatch warning on preview branches is intentional and cheap
  // — production branches match perfectly, and preview branches are dev-only
  // surfaces where we prefer the noise to the false analytics reads.)
  if (typeof window !== 'undefined' && !isProductionHostForAnalytics(window.location.hostname)) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', '${gaId}');
      `}</Script>
    </>
  );
}
