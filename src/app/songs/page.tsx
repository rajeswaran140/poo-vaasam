/**
 * Songs Listing Page
 */

import Link from 'next/link';

async function getSongs() {
  try {
    const response = await fetch('http://localhost:3000/api/test/content?action=by-type&type=SONGS', {
      cache: 'no-store'
    });
    const data = await response.json();
    return data.success ? data.data.items : [];
  } catch (error) {
    return [];
  }
}

export default async function SongsPage() {
  const songs = await getSongs();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-blue-700 text-white py-16">
        <div className="container mx-auto px-4">
          <Link href="/" className="text-blue-100 hover:text-white mb-4 inline-block">
            ← Back to Home
          </Link>
          <h1 className="text-5xl font-bold mb-4 font-tamil">🎵 பாடல்கள்</h1>
          <p className="text-xl text-blue-100">Tamil Songs Collection</p>
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto px-4 py-12">
        {songs.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🎵</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">No songs yet</h2>
            <p className="text-gray-600">Check back later for new content</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {songs.map((song: any) => (
              <ContentCard key={song.id} content={song} />
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
        <h3 className="text-2xl font-bold text-gray-900 font-tamil mb-3 group-hover:text-blue-600 transition-colors">
          {content._title}
        </h3>
        <p className="text-gray-600 font-tamil text-sm line-clamp-3 mb-4 leading-relaxed">
          {content._body}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 font-tamil">
            {content._author}
          </span>
          {content._audioUrl && (
            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
              🎵 Audio
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
