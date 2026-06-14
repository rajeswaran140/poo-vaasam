'use client';

/**
 * Netflix-style horizontal rail: a scroll-snapping row with chevron controls
 * that fade in only when there's more to see (desktop), translucent gradient
 * cues at the scrollable edges, and a hidden scrollbar. On touch devices the
 * chevrons stay hidden and users swipe — same markup, no JS scroll needed.
 *
 * Renders the scrollable `<ul aria-label={label}>` itself; pass `<li>` children.
 */

import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function MediaRail({ label, children }: { label?: string; children: ReactNode }) {
  const scroller = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const sync = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    // `atEnd` is also true when there's nothing to scroll (max <= 0) → both
    // chevrons hidden for a short rail.
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    sync();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync]);

  const nudge = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(280, el.clientWidth * 0.85), behavior: 'smooth' });
  };

  return (
    <div className="group/rail relative">
      <ul
        ref={scroller}
        aria-label={label}
        className="flex gap-4 overflow-x-auto pb-3 snap-x scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>

      {/* Left control + edge cue — hidden at the start and on touch layouts. */}
      <div
        className={`pointer-events-none absolute inset-y-0 left-0 hidden items-center bg-gradient-to-r from-black/60 to-transparent pr-8 transition-opacity md:flex ${
          atStart ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="முந்தைய"
          tabIndex={atStart ? -1 : 0}
          className="pointer-events-auto ml-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      </div>

      {/* Right control + edge cue. */}
      <div
        className={`pointer-events-none absolute inset-y-0 right-0 hidden items-center justify-end bg-gradient-to-l from-black/60 to-transparent pl-8 transition-opacity md:flex ${
          atEnd ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="அடுத்தது"
          tabIndex={atEnd ? -1 : 0}
          className="pointer-events-auto mr-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
