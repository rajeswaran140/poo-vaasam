/**
 * `/ads.txt` — the IAB authorised-sellers file AdSense requires.
 *
 * Served from a route rather than `public/ads.txt` so the publisher id comes
 * from the environment like every other Google id, instead of being hardcoded
 * in the repo and going stale.
 *
 * ⚠️ WITHOUT THIS FILE, ADSENSE EVENTUALLY STOPS PAYING. Google flags the site
 * "Earnings at risk — one or more of your sites does not have an ads.txt file"
 * and can restrict demand. It is a one-line file and the most common reason a
 * new publisher's revenue quietly stays at zero.
 *
 * Returns 404 while unconfigured, so an unconfigured deploy serves no misleading
 * empty file.
 */

import { ADSENSE_CLIENT, isAdSenseConfigured } from '@/lib/adsense';

export const dynamic = 'force-static';

export function GET(): Response {
  if (!isAdSenseConfigured()) {
    return new Response('Not found', { status: 404 });
  }
  // pub id WITHOUT the "ca-" prefix, per the ads.txt spec.
  const pub = ADSENSE_CLIENT.replace(/^ca-/, '');
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
