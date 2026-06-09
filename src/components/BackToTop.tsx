'use client';

import { useEffect, useState } from 'react';
import { useMusicPlayer } from '@/components/music/MusicPlayerProvider';

/**
 * Floating "back to top" button. Appears after the user scrolls down past a
 * threshold and smooth-scrolls to the top of the page when clicked.
 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false);
  // Lift clear of the fixed player bar (~6rem) when a track is loaded so the
  // button never sits behind the transport controls.
  const { current } = useMusicPlayer();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll(); // set initial state in case the page loads already scrolled
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      className={`fixed right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg transition-all duration-300 hover:bg-orange-600 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 ${
        current ? 'bottom-40' : 'bottom-24'
      } ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
      }`}
    >
      <svg
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    </button>
  );
}
