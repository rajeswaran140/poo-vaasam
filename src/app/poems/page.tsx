/**
 * Poems Listing Page - Enhanced with Search, Filters, and Advanced Features
 */

export const revalidate = 300;

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'கவிதைகள்',
  description: 'தமிழ் கவிதைகள் தொகுப்பு — இலவசமாகப் படித்து அனுபவியுங்கள்.',
  alternates: { canonical: '/poems' },
};

import { Suspense } from 'react';
import Header from '@/components/Header';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { PoemsGrid } from '@/components/PoemsGrid';
import { PoemsGridSkeleton } from '@/components/PoemCardSkeleton';

async function getPoems() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findByType(ContentType.POEMS, {
      limit: 100,
      status: ContentStatus.PUBLISHED,
    });
    return result.items.map((item) => item.toObject());
  } catch (error) {
    console.error('Failed to fetch poems:', error);
    return [];
  }
}

export default async function PoemsPage() {
  const poems = await getPoems();

  return (
    <div className="min-h-screen bg-gray-900">
      <Header />

      {/* Brand hero — orange-on-dark, matches the rest of the site. */}
      <section className="relative w-full overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_12%_-15%,rgba(255,255,255,0.35),transparent_55%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-gray-900" />

        <div className="relative container mx-auto px-6 py-20 sm:px-10">
          <span className="mb-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 font-tamil text-xs font-semibold uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-sm">
            தொகுப்பு
          </span>
          <h1 className="font-kavivanar text-5xl font-extrabold leading-tight drop-shadow-md sm:text-6xl lg:text-7xl">
            கவிதைகள்
          </h1>
          <p className="mt-3 font-tamil text-white/90 sm:text-lg">தமிழ் கவிதைகள் தொகுப்பு</p>
          <div className="mt-5 flex flex-wrap items-center gap-2 font-tamil text-sm">
            {poems.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white/90 ring-1 ring-white/20 backdrop-blur-sm">
                {poems.length} கவிதைகள்
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white/90 ring-1 ring-white/20 backdrop-blur-sm">
              என்றும் இலவசம்
            </span>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-12">
        {poems.length === 0 ? (
          <div className="py-20 text-center">
            <div className="mb-4 text-6xl">📝</div>
            <h2 className="mb-2 font-tamil text-2xl font-bold text-white">இன்னும் கவிதைகள் இல்லை</h2>
            <p className="font-tamil text-gray-400">புதிய உள்ளடக்கத்திற்காக பின்னர் சரிபார்க்கவும்</p>
          </div>
        ) : (
          <Suspense fallback={<PoemsGridSkeleton />}>
            <PoemsGrid poems={poems} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
