/**
 * Poems Listing Page - Enhanced with Search, Filters, and Advanced Features
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { Suspense } from 'react';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { PoemsGrid } from '@/components/PoemsGrid';
import { PoemsGridSkeleton } from '@/components/PoemCardSkeleton';

async function getPoems() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findByType(ContentType.POEMS, {
      limit: 100, // Increased limit for better filtering
      status: ContentStatus.PUBLISHED
    });
    return result.items.map(item => item.toObject());
  } catch (error) {
    console.error('Failed to fetch poems:', error);
    return [];
  }
}

export default async function PoemsPage() {
  const poems = await getPoems();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-green-50/30">
      {/* Enhanced Header with Gradient and Animation */}
      <header className="relative bg-gradient-to-r from-green-600 via-green-700 to-emerald-700 text-white py-20 overflow-hidden">
        {/* Decorative Background Elements */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-white rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-white rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        <div className="container mx-auto px-4 relative z-10">
          <Link href="/" className="text-green-100 hover:text-white mb-6 inline-flex items-center gap-2 font-tamil transition-colors group">
            <span className="group-hover:-translate-x-1 transition-transform">←</span>
            <span>முகப்புக்குத் திரும்புங்கள்</span>
          </Link>
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold mb-4 font-poem leading-tight animate-fade-in-down">
            📝 கவிதைகள்
          </h1>
          <p className="text-lg sm:text-xl md:text-2xl text-green-100 font-poem leading-relaxed mb-6 animate-fade-in-up">
            தமிழ் கவிதைகள் தொகுப்பு
          </p>
          <div className="flex flex-wrap gap-3 text-sm md:text-base">
            <div className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full font-tamil">
              {poems.length} கவிதைகள்
            </div>
            <div className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full font-tamil">
              தேடல் மற்றும் வடிகட்டி
            </div>
            <div className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full font-tamil">
              பலவிதமான வரிசைகள்
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        {poems.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4 animate-bounce">📝</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 font-tamil">இன்னும் கவிதைகள் இல்லை</h2>
            <p className="text-gray-600 font-tamil">புதிய உள்ளடக்கத்திற்காக பின்னர் சரிபார்க்கவும்</p>
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
