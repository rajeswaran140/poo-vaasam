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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {poems.map((poem: any) => (
              <Link
                key={poem.id}
                href={`/content/${poem.id}`}
                className="group bg-white rounded-xl shadow-sm border border-gray-200 p-8 hover:shadow-xl transition-all"
              >
                <h3 className="text-2xl font-bold text-gray-900 font-tamil mb-4 group-hover:text-green-600 transition-colors">
                  {poem.title}
                </h3>
                <pre className="text-gray-700 font-tamil whitespace-pre-wrap leading-relaxed">
                  {poem.body.split('\n').slice(0, 4).join('\n')}
                  {poem.body.split('\n').length > 4 && '\n...'}
                </pre>
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <span className="text-sm text-gray-500 font-tamil">
                    - {poem.author}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
