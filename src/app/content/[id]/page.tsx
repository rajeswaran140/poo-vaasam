/**
 * Individual Content View Page
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';

async function getContent(id: string) {
  try {
    const repo = new ContentRepository();
    const content = await repo.findById(id);
    return content ? content.toObject() : null;
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return null;
  }
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContentPage({ params }: PageProps) {
  const { id } = await params;
  const content = await getContent(id);

  if (!content) {
    notFound();
  }

  const typeColors: Record<string, { bg: string; text: string; gradient: string }> = {
    SONGS: { bg: 'bg-blue-100', text: 'text-blue-800', gradient: 'from-blue-600 to-blue-700' },
    POEMS: { bg: 'bg-green-100', text: 'text-green-800', gradient: 'from-green-600 to-green-700' },
    LYRICS: { bg: 'bg-yellow-100', text: 'text-yellow-800', gradient: 'from-yellow-600 to-yellow-700' },
    STORIES: { bg: 'bg-pink-100', text: 'text-pink-800', gradient: 'from-pink-600 to-pink-700' },
    ESSAYS: { bg: 'bg-purple-100', text: 'text-purple-800', gradient: 'from-purple-600 to-purple-700' },
  };

  const typeNames: Record<string, string> = {
    SONGS: 'பாடல்',
    POEMS: 'கவிதை',
    LYRICS: 'வரிகள்',
    STORIES: 'கதை',
    ESSAYS: 'கட்டுரை',
  };

  const colors = typeColors[content.type] || typeColors.SONGS;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className={`bg-gradient-to-r ${colors.gradient} text-white py-12`}>
        <div className="container mx-auto px-4 max-w-4xl">
          <Link href="/" className="text-white/80 hover:text-white mb-4 inline-block font-tamil">
            ← முகப்புக்குத் திரும்பு
          </Link>
          <span className={`inline-block px-3 py-1 ${colors.bg} ${colors.text} rounded-full text-sm font-semibold mb-4 font-tamil`}>
            {typeNames[content.type]}
          </span>
          <h1 className="text-5xl font-bold mb-4 font-tamil leading-tight">
            {content.title}
          </h1>
          {content.description && (
            <p className="text-xl text-white/90 font-tamil">
              {content.description}
            </p>
          )}
          <div className="flex items-center gap-4 mt-6 text-white/80">
            <span className="font-tamil">
              ஆசிரியர்: {content.author}
            </span>
            <span>•</span>
            <span className="font-tamil">
              {content.viewCount || 0} பார்வைகள்
            </span>
            <span>•</span>
            <span>
              {new Date(content.publishedAt || content.createdAt).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
              })}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <article className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 md:p-12">
          {/* Audio Player */}
          {content.audioUrl && (
            <div className="mb-8 p-6 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">🎵</span>
                <span className="font-semibold text-gray-700 font-tamil">ஒலி கிடைக்கிறது</span>
              </div>
              <audio
                controls
                className="w-full"
                src={content.audioUrl}
              >
                உங்கள் உலாவி ஒலி இயக்கத்தை ஆதரிக்கவில்லை.
              </audio>
              {content.audioDuration && (
                <p className="text-sm text-gray-600 mt-2 font-tamil">
                  காலம்: {Math.floor(content.audioDuration / 60)}:{(content.audioDuration % 60).toString().padStart(2, '0')}
                </p>
              )}
            </div>
          )}

          {/* Featured Image */}
          {content.featuredImage && (
            <div className="mb-8">
              <img
                src={content.featuredImage}
                alt={content.title}
                className="w-full rounded-lg"
              />
            </div>
          )}

          {/* Main Content */}
          <div className="prose prose-lg max-w-none">
            <pre className="whitespace-pre-wrap font-tamil text-lg leading-relaxed text-gray-800">
              {content.body}
            </pre>
          </div>

          {/* Categories */}
          {content.categories && content.categories.length > 0 && (
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 font-tamil">வகைகள்</h3>
              <div className="flex flex-wrap gap-2">
                {content.categories.map((category: any) => (
                  <Link
                    key={category.id}
                    href={`/category/${category.slug}`}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 font-tamil transition-colors"
                  >
                    {category.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {content.tags && content.tags.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 font-tamil">குறிச்சொற்கள்</h3>
              <div className="flex flex-wrap gap-2">
                {content.tags.map((tag: any) => (
                  <Link
                    key={tag.id}
                    href={`/tag/${tag.slug}`}
                    className="px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-full text-sm font-tamil transition-colors"
                  >
                    #{tag.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Share */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 font-tamil">பகிர்தல்</h3>
            <div className="flex gap-3">
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-tamil">
                முகநூல்
              </button>
              <button className="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors font-tamil">
                ட்விட்டர்
              </button>
              <button className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-tamil">
                வாட்ஸ்அப்
              </button>
            </div>
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-8 text-center">
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium font-tamil"
          >
            ← முகப்புக்குத் திரும்பு
          </Link>
        </div>
      </article>
    </div>
  );
}
