'use client';

/**
 * Tracked YouTube link — renders an arbitrary `<a>` (any children, any
 * className) that fires the GA4 `subscribe_click` event before letting
 * the click proceed to YouTube. Use for hand-styled Subscribe links
 * (e.g. icon-only footer button) that can't reuse SubscribeButton's
 * fixed icon + label layout.
 */

import type { ReactNode } from 'react';
import { trackSubscribeClick } from '@/lib/analytics-events';

interface Props {
  href: string;
  source: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}

export function TrackedYouTubeAnchor({ href, source, className, ariaLabel, children }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className={className}
      onClick={() => trackSubscribeClick(source)}
    >
      {children}
    </a>
  );
}
