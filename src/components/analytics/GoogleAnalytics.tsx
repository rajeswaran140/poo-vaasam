'use client';

/**
 * Google Analytics 4 — loads gtag.js once and re-fires `page_view` on every
 * client-side route change (the default GA SPA snippet only counts the first
 * page, so without this Next.js App Router visits look like one-page sessions).
 *
 * Renders nothing (and ships no scripts) when no GA ID is configured, on a
 * non-production host, or on an operator surface (/admin, /login, /debug-auth).
 */

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isProductionHostForAnalytics, isAnalyticsExcludedPath } from '@/lib/analytics';

declare global {
  interface Window { gtag?: (...args: unknown[]) => void; dataLayer?: unknown[] }
}

export function GoogleAnalytics({ gaId }: { gaId: string }) {
  const pathname = usePathname();

  // Operator surfaces are not audience surfaces. See isAnalyticsExcludedPath —
  // the 2026-09-12 audit measured 51% of all page views as the operator's own
  // /admin and /login sessions, which inflated every headline metric.
  const excluded = isAnalyticsExcludedPath(pathname);

  // Latches true on the first non-excluded path. Once the scripts are mounted
  // they STAY mounted, even while the operator is inside /admin: unmounting
  // them would re-run `gtag('config')` on the way back out, which sends its own
  // automatic page_view on top of the one the effect below sends.
  const [loaded, setLoaded] = useState(false);

  // The path `gtag('config')` already covered with its automatic page_view.
  // Skipping exactly that one path is what prevents a double-count on the
  // render where the scripts first mount — whether that is the landing page or
  // the first public page after an admin detour.
  const configPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!gaId || typeof window === 'undefined') return;
    // Same production-host gate applied at render (below) — a preview branch's
    // useEffect must not fire pageviews even when gtag was somehow initialised.
    if (!isProductionHostForAnalytics(window.location.hostname)) return;
    if (excluded) return;

    if (!loaded) {
      configPathRef.current = pathname;
      setLoaded(true);
      return;
    }
    if (configPathRef.current === pathname) return;
    if (typeof window.gtag !== 'function') return;

    // GA4 derives the path from page_location; the old UA-style `page_path`
    // param was ignored.
    window.gtag('event', 'page_view', {
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, gaId, excluded, loaded]);

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

  // Never load on an admin landing. `pathname` is known during SSR too, so the
  // server and the client agree here and no hydration mismatch is introduced.
  if (excluded && !loaded) return null;

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
