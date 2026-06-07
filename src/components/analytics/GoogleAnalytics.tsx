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
    window.gtag('event', 'page_view', {
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, gaId]);

  if (!gaId) return null;

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
