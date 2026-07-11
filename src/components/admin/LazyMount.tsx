'use client';

/**
 * Defer mounting `children` until the placeholder scrolls near the viewport.
 *
 * Used to wrap heavy auto-loading panels (e.g. the Viewer Funnel, which fires
 * ~6 Analytics reports on mount) so opening /admin/youtube doesn't pay for them
 * unless the admin actually scrolls down to look. Reserves `minHeight` so the
 * layout doesn't jump when the real panel mounts.
 *
 * Fallback: where IntersectionObserver isn't available (SSR / jsdom), it mounts
 * eagerly — correctness over laziness, so nothing silently fails to render.
 */

import { useState, useRef, useEffect, type ReactNode } from 'react';

export function LazyMount({
  children,
  rootMargin = '250px',
  minHeight = 140,
}: {
  children: ReactNode;
  rootMargin?: string;
  minHeight?: number;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true); // no IO support → render eagerly (safe)
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} style={visible ? undefined : { minHeight }}>
      {visible ? children : null}
    </div>
  );
}
