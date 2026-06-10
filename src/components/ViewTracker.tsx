/**
 * ViewTracker — records one on-site view for a content page.
 *
 * The content pages are static (CDN-served), so the only way the DynamoDB
 * `viewCount` accrues is a client beacon. This fires once per browser session
 * per content id (sessionStorage dedupe) so re-renders, back-navigation, and
 * HMR don't inflate the count. Fire-and-forget: failures are ignored — a view
 * counter must never affect the reading experience.
 */

'use client';

import { useEffect } from 'react';

export function ViewTracker({ contentId }: { contentId: string }) {
  useEffect(() => {
    if (!contentId) return;

    const key = `vv:${contentId}`;
    try {
      if (sessionStorage.getItem(key)) return; // already counted this session
      sessionStorage.setItem(key, '1');
    } catch {
      // sessionStorage blocked (private mode, etc.) — proceed and count once.
    }

    fetch(`/api/content/${encodeURIComponent(contentId)}/view`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {
      // Best-effort beacon; ignore network/abort errors.
    });
  }, [contentId]);

  return null;
}
