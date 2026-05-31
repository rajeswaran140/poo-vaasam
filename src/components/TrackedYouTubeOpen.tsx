'use client';

/**
 * Tracked outbound YouTube link — wraps an arbitrary <a> and fires the GA4
 * `youtube_open` event before letting the click proceed. Use this for any
 * non-Subscribe YouTube link (channel home, specific video, /videos
 * thumbnail, content-page "Watch on YouTube" button) so the admin dashboard
 * can break down outbound clicks by destination and source surface.
 *
 * Subscribe links stay on the separate `subscribe_click` event via
 * TrackedYouTubeAnchor — different intent, different report.
 */

import type { ReactNode } from 'react';
import { trackYouTubeOpen } from '@/lib/analytics-events';

interface Props {
  href: string;
  /** Stable key for the click target: "channel", "video:<id>", "subscribe-confirmation", etc. */
  destination: string;
  /** Optional surface that drove the click ("home", "videos-page", "content-page", "header"). */
  source?: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}

export function TrackedYouTubeOpen({
  href,
  destination,
  source,
  className,
  ariaLabel,
  children,
}: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className={className}
      onClick={() => trackYouTubeOpen(destination, source)}
    >
      {children}
    </a>
  );
}
