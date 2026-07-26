/**
 * 404 page for the public site.
 *
 * Server component — a not-found render has nothing to recover from, so it needs
 * no client-side state. Points visitors at the two places most likely to have
 * what they were looking for (songs and poems) rather than dead-ending them.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'பக்கம் கிடைக்கவில்லை · Page not found',
  // A 404 must never be indexed — it would compete with the real pages.
  robots: { index: false, follow: true },
};

const DESTINATIONS = [
  { href: '/songs', ta: 'பாடல்கள்', en: 'Songs' },
  { href: '/poems', ta: 'கவிதைகள்', en: 'Poems' },
  { href: '/videos', ta: 'காணொளிகள்', en: 'Videos' },
];

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#fdfaf5] px-4 py-16">
      <div className="w-full max-w-lg text-center">
        <p className="text-5xl mb-6" aria-hidden="true">
          🍃
        </p>

        <h1 className="font-tamil text-2xl sm:text-3xl font-semibold text-gray-900 mb-3">
          இந்தப் பக்கம் கிடைக்கவில்லை
        </h1>
        <p className="text-gray-600 mb-10">
          We couldn&apos;t find that page — it may have moved or never existed.
        </p>

        <div className="flex flex-wrap gap-3 justify-center mb-8">
          {DESTINATIONS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="px-5 py-3 rounded-lg bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
            >
              <span className="font-tamil">{d.ta}</span>
              <span className="text-gray-400"> · {d.en}</span>
            </Link>
          ))}
        </div>

        <Link
          href="/"
          className="inline-block px-6 py-3 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
        >
          <span className="font-tamil">முகப்புக்குச் செல்லுங்கள்</span>
          <span className="text-purple-200"> · Home</span>
        </Link>
      </div>
    </main>
  );
}
