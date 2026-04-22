/**
 * Poems Listing Page
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';

async function getPoems() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findByType(ContentType.POEMS, {
      limit: 50,
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-green-600 to-green-700 text-white py-16">
        <div className="container mx-auto px-4">
          <Link href="/" className="text-green-100 hover:text-white mb-4 inline-block font-tamil">
            ← முகப்புக்குத் திரும்பு
          </Link>
          <h1 className="text-5xl font-bold mb-4 font-tamil">📝 கவிதைகள்</h1>
          <p className="text-xl text-green-100 font-tamil">தமிழ் கவிதைகள் தொகுப்பு</p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        {poems.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📝</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 font-tamil">இன்னும் கவிதைகள் இல்லை</h2>
            <p className="text-gray-600 font-tamil">புதிய உள்ளடக்கத்திற்காக பின்னர் சரிபார்க்கவும்</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {poems.map((poem: any) => (
              <Link
                key={poem.id}
                href={`/content/${poem.id}`}
                className="group flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-xl hover:border-green-300 transition-all duration-300 overflow-hidden"
              >
                {/* Featured Image or Placeholder */}
                <div className="relative w-full aspect-video bg-gradient-to-br from-green-50 to-green-100 overflow-hidden">
                  {poem.featuredImage ? (
                    <img
                      src={poem.featuredImage}
                      alt={poem.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-6xl mb-2">📝</div>
                        <p className="text-sm text-green-600 font-tamil">கவிதை</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col p-4 sm:p-6">
                  <h3 className="text-xl sm:text-2xl font-bold text-gray-900 font-tamil mb-3 group-hover:text-green-600 transition-colors line-clamp-2">
                    {poem.title}
                  </h3>

                  {/* Description or Body Preview */}
                  {poem.description ? (
                    <p className="text-sm sm:text-base text-gray-600 font-tamil mb-4 line-clamp-3">
                      {poem.description}
                    </p>
                  ) : (
                    <div className="text-sm sm:text-base text-gray-700 font-tamil mb-4 leading-relaxed line-clamp-4">
                      {poem.body.split('\n').slice(0, 3).join('\n')}
                      {poem.body.split('\n').length > 3 && '...'}
                    </div>
                  )}

                  {/* Author & Meta */}
                  <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-gray-500 font-tamil">
                      - {poem.author}
                    </span>
                    {poem.viewCount > 0 && (
                      <span className="text-xs text-gray-400">
                        👁️ {poem.viewCount}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
