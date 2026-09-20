'use client';

/**
 * The full Shorts catalogue as a responsive 9:16 grid — the /shorts page.
 *
 * A grid rather than the rail used on /videos: a rail is a teaser that shows
 * three cards and hides the rest behind a swipe, which is exactly the
 * discoverability problem this page exists to fix. Everything is on screen and
 * reachable by scrolling.
 *
 * Cards come from ShortCard, shared with the rail, so both surfaces chain into
 * the same playlist and show the same badge.
 */

import { useState, useRef, useEffect } from 'react';
import { ShortCard } from '@/components/ShortCard';
import type { ChannelVideo } from '@/lib/youtube-feed';

export function ShortsGrid({ shorts, now = Date.now() }: { shorts: ChannelVideo[]; now?: number }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const embedRef = useRef<HTMLDivElement>(null);
  const activeTitle = shorts.find((s) => s.id === activeId)?.title ?? '';

  useEffect(() => {
    if (activeId) embedRef.current?.focus();
  }, [activeId]);

  if (!shorts.length) {
    return (
      <p className="font-tamil text-gray-400">
        இப்போதைக்கு ஷார்ட்ஸ் எதுவும் இல்லை.
      </p>
    );
  }

  return (
    <>
      <div aria-live="polite" className="sr-only">{activeTitle ? `Now playing: ${activeTitle}` : ''}</div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {shorts.map((short) => (
          <li key={short.id}>
            <ShortCard
              short={short}
              now={now}
              isActive={activeId === short.id}
              onPlay={() => setActiveId(short.id)}
              embedRef={activeId === short.id ? embedRef : undefined}
              source="shorts_page"
            />
          </li>
        ))}
      </ul>
    </>
  );
}
