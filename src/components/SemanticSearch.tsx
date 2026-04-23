'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MagnifyingGlassIcon, SparklesIcon } from '@heroicons/react/24/outline';

interface SearchResult {
  id: string;
  title: string;
  author: string;
  description?: string;
  type: string;
  similarity: number;
  excerpt: string;
}

export function SemanticSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!query.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 10 }),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setResults(data.results || []);
    } catch (err) {
      setError('தேடல் தோல்வியுற்றது. மீண்டும் முயற்சிக்கவும்.');
      console.error('Search error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const typeEmojis: Record<string, string> = {
    POEMS: '📝',
    SONGS: '🎵',
    STORIES: '📖',
    LYRICS: '🎤',
    ESSAYS: '✍️',
  };

  const typeColors: Record<string, string> = {
    POEMS: 'bg-green-100 text-green-700',
    SONGS: 'bg-blue-100 text-blue-700',
    STORIES: 'bg-pink-100 text-pink-700',
    LYRICS: 'bg-yellow-100 text-yellow-700',
    ESSAYS: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Search Form */}
      <form onSubmit={handleSearch} className="relative mb-8">
        <div className="relative">
          <SparklesIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-purple-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="உங்கள் கேள்வியை கேளுங்கள்... (உதா: காதல் பற்றிய கவிதைகள்)"
            className="w-full pl-12 pr-32 py-4 text-lg border-2 border-purple-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil"
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors font-tamil flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="animate-spin">⏳</span>
                தேடுகிறது...
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="w-5 h-5" />
                தேடு
              </>
            )}
          </button>
        </div>

        {/* AI Badge */}
        <div className="absolute -top-3 left-4 px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs rounded-full font-bold">
          AI-இயக்கப்பட்ட தேடல்
        </div>
      </form>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700 font-tamil">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold font-tamil text-gray-900">
            {results.length} முடிவுகள் கிடைத்தன
          </h2>

          {results.map((result) => (
            <Link
              key={result.id}
              href={`/content/${result.id}`}
              className="block p-6 bg-white border border-gray-200 rounded-xl hover:shadow-lg hover:border-purple-300 transition-all"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${typeColors[result.type]}`}>
                      {typeEmojis[result.type]} {result.type}
                    </span>
                    <span className="text-xs text-purple-600 font-semibold">
                      {Math.round(result.similarity * 100)}% பொருத்தம்
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 font-tamil mb-2">
                    {result.title}
                  </h3>
                  <p className="text-sm text-gray-600 font-tamil mb-2">
                    - {result.author}
                  </p>
                </div>
              </div>

              {result.description && (
                <p className="text-gray-700 font-tamil mb-3 line-clamp-2">
                  {result.description}
                </p>
              )}

              <p className="text-gray-600 font-tamil text-sm line-clamp-3 leading-relaxed">
                {result.excerpt}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && results.length === 0 && query && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔍</div>
          <p className="text-gray-600 font-tamil">முடிவுகள் எதுவும் கிடைக்கவில்லை</p>
        </div>
      )}

      {/* Suggestions */}
      {!query && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 font-tamil">முயற்சி செய்யுங்கள்:</h3>
          <div className="flex flex-wrap gap-2">
            {[
              'காதல் பற்றிய கவிதைகள்',
              'இயற்கை பற்றிய பாடல்கள்',
              'சோகமான கதைகள்',
              'தாய் பற்றிய கவிதைகள்',
              'நட்பு பற்றிய உள்ளடக்கம்',
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setQuery(suggestion)}
                className="px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-tamil hover:bg-purple-200 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
