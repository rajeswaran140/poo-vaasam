/**
 * Lyrics Listing Page
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';

async function getLyrics() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findByType(ContentType.LYRICS, {
      limit: 50,
      status: ContentStatus.PUBLISHED
    });
    return result.items.map(item => item.toObject());
  } catch (error) {
    console.error('Failed to fetch lyrics:', error);
    return [];
  }
}

export default async function LyricsPage() {
  const lyrics = await getLyrics();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-yellow-600 to-yellow-700 text-white py-16">
        <div className="container mx-auto px-4">
          <Link href="/" className="text-yellow-100 hover:text-white mb-4 inline-block font-tamil">
            ← முகப்புக்குத் திரும்பு
          </Link>
          <h1 className="text-5xl font-bold mb-4 font-tamil">🎤 பாடல் வரிகள்</h1>
          <p className="text-xl text-yellow-100 font-tamil">தமிழ் பாடல் வரிகள் தொகுப்பு</p>
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto px-4 py-12">
        {lyrics.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🎤</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 font-tamil">இன்னும் பாடல் வரிகள் இல்லை</h2>
            <p className="text-gray-600 font-tamil">புதிய உள்ளடக்கத்திற்காக பின்னர் சரிபார்க்கவும்</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {lyrics.map((lyric: any) => (
              <ContentCard key={lyric.id} content={lyric} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContentCard({ content }: { content: any }) {
  return (
    <Link
      href={`/content/${content.id}`}
      className="group bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-xl transition-all transform hover:scale-[1.02]"
    >
      <div className="p-6">
        <h3 className="text-2xl font-bold text-gray-900 font-tamil mb-3 group-hover:text-yellow-600 transition-colors">
          {content.title}
        </h3>
        <p className="text-gray-600 font-tamil text-sm line-clamp-3 mb-4 leading-relaxed">
          {content.body}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 font-tamil">
            {content.author}
          </span>
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full font-tamil">
            🎤 வரிகள்
          </span>
        </div>
      </div>
    </Link>
  );
}
