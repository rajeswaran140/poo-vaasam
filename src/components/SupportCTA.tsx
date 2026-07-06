'use client';

/**
 * Support / fan-funding CTA — the site's conversion surface for the YouTube
 * Partner Program era. Turns engaged site visitors into channel subscribers
 * (the binding YPP gate) and fan-funders (Super Thanks).
 *
 * Placed at high-intent moments (e.g. right after a fan unlocks gated lyrics)
 * and on the /support page. Reuses SubscribeButton (fires the GA4
 * subscribe_click event with the call-site `source`). Renders nothing until a
 * real channel is configured, so it never ships a dead link.
 */

import { SITE, isYouTubeChannelConfigured } from '@/config/site';
import { SubscribeButton } from '@/components/SubscribeButton';

interface SupportCTAProps {
  /** UTM/analytics source key for the call site (e.g. "lyrics-unlock"). */
  source: string;
  className?: string;
}

export function SupportCTA({ source, className = '' }: SupportCTAProps) {
  if (!isYouTubeChannelConfigured()) return null;

  return (
    <section
      aria-label="Support Tamilagaval"
      className={`rounded-2xl border border-gray-800 bg-gray-900/60 p-5 text-center sm:p-6 ${className}`}
    >
      <h3 className="font-tamil text-lg font-bold text-white">
        💛 தமிழகவலை ஆதரியுங்கள் · Support Tamilagaval
      </h3>
      <p className="mx-auto mt-2 max-w-md font-tamil text-sm text-gray-400">
        இந்தத் தமிழ் இசைப் பயணத்தில் இணைந்திருங்கள். Subscribe செய்வதும், எந்தப் பாடலிலும்
        Super Thanks அளிப்பதும் பெரிய ஊக்கம். 🙏
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <SubscribeButton label="Subscribe" source={source} />
        <a
          href={SITE.youtube.channelUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Send a Super Thanks on YouTube"
          className="inline-flex items-center gap-2 rounded-full border border-orange-500/50 px-6 py-3 font-tamil font-semibold text-orange-300 transition-colors hover:bg-orange-500/10"
        >
          <span aria-hidden>💝</span>
          <span>Super Thanks</span>
        </a>
      </div>

      <p className="mt-3 font-tamil text-xs text-gray-500">
        எந்தப் பாடலின் கீழும் &ldquo;Thanks&rdquo; பொத்தானை அழுத்தி ஆதரிக்கலாம்.
      </p>
    </section>
  );
}
