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
import { useEffect } from 'react';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { gtag?: (...args: any[]) => void; dataLayer?: unknown[] }
}

export function GoogleAnalytics({ gaId }: { gaId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!gaId || typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    window.gtag('event', 'page_view', {
      page_path: window.location.pathname + window.location.search,
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
        gtag('config', '${gaId}', { anonymize_ip: true });
      `}</Script>
    </>
  );
}
