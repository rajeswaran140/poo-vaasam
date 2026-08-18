'use client';

/**
 * Loads the AdSense library once, and only where ads are permitted.
 *
 * Renders nothing — and ships no script — when no publisher id is configured or
 * the current path is excluded ({@link adsAllowedOn}). That keeps `/admin`,
 * `/privacy` and the paid `/music-composition` page free of ad requests, and
 * keeps Raj's own admin pageviews out of the trial's numbers.
 *
 * ⚠️ AUTO ADS ARE DELIBERATELY NOT ENABLED. Auto ads let Google insert units
 * anywhere it likes, including mid-poem. Placement here is manual and explicit
 * via {@link AdSlot}, because the reading experience on a poetry site is the
 * product. Enabling auto ads in the AdSense console would override that — don't.
 */

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { ADSENSE_CLIENT, adsAllowedOn } from '@/lib/adsense';

export function AdSense() {
  const pathname = usePathname();
  if (!adsAllowedOn(pathname ?? '/')) return null;

  return (
    <Script
      id="adsense-lib"
      // `afterInteractive` matches GoogleAnalytics: the page paints first, then
      // the ad library loads. Never `beforeInteractive` — it would block the
      // first render on a third-party script and cost the Core Web Vitals that
      // the indexing work (6/70 → 55/71) just bought.
      strategy="afterInteractive"
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
    />
  );
}
