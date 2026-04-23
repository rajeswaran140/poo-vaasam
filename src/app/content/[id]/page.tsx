/**
 * Individual Content View Page
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentPageClient } from '@/components/ContentPageClient';

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
    <ContentPageClient
      contentId={content.id}
      contentType={content.type}
      contentTitle={content.title}
    >
      <div className="min-h-screen bg-gray-50">
        {/* Back Navigation - Fixed at top */}
      <div className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3 max-w-5xl">
          <Link href="/" className="text-gray-600 hover:text-gray-900 inline-flex items-center gap-2 font-tamil">
            <span>←</span>
            <span>முகப்புக்குத் திரும்பு</span>
          </Link>
        </div>
      </div>

      {/* Hero Section - Image and Title Overlay */}
      <div className="relative w-full">
        {content.featuredImage ? (
          <div className="relative w-full h-[300px] sm:h-[400px] md:h-[500px] lg:h-[600px] overflow-hidden">
            {/* Featured Image */}
            <img
              src={content.featuredImage}
              alt={content.title}
              className="w-full h-full object-cover"
            />
            {/* Dark Overlay for Text Readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>

            {/* Title Overlay */}
            <div className="absolute inset-0 flex flex-col justify-end">
              <div className="container mx-auto px-4 sm:px-6 pb-8 sm:pb-12 max-w-5xl">
                <span className={`inline-block px-3 py-1 ${colors.bg} ${colors.text} rounded-full text-xs sm:text-sm font-semibold mb-3 sm:mb-4 font-tamil`}>
                  {typeNames[content.type]}
                </span>
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white font-tamil leading-tight mb-2 sm:mb-3 drop-shadow-lg">
                  {content.title}
                </h1>
                {content.description && (
                  <p className="text-base sm:text-lg md:text-xl text-white/95 font-tamil max-w-3xl drop-shadow-md">
                    {content.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          // Fallback gradient header when no image
          <div className={`relative w-full bg-gradient-to-br ${colors.gradient} py-16 sm:py-20 md:py-24`}>
            <div className="container mx-auto px-4 sm:px-6 max-w-5xl">
              <span className={`inline-block px-3 py-1 bg-white/20 text-white rounded-full text-xs sm:text-sm font-semibold mb-3 sm:mb-4 font-tamil`}>
                {typeNames[content.type]}
              </span>
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white font-tamil leading-tight mb-2 sm:mb-3">
                {content.title}
              </h1>
              {content.description && (
                <p className="text-base sm:text-lg md:text-xl text-white/95 font-tamil max-w-3xl">
                  {content.description}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <article className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 max-w-5xl">
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          {/* Audio Player */}
          {content.audioUrl && (
            <div className="p-6 sm:p-8 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-200">
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

          {/* Main Content - Poem Body */}
          <div className="p-6 sm:p-8 md:p-12">
            <div className="prose prose-lg max-w-none">
              <pre className="whitespace-pre-wrap font-tamil text-base sm:text-lg md:text-xl leading-relaxed text-gray-800 mb-0">
                {content.body}
              </pre>
            </div>
          </div>

          {/* Author and Date Section - Below the Poem */}
          <div className="px-6 sm:px-8 md:px-12 pb-6 sm:pb-8 md:pb-12 border-t border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 pt-6">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 font-tamil text-sm">ஆசிரியர்:</span>
                <span className="text-lg sm:text-xl font-bold text-gray-900 font-tamil">
                  {content.author}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <span className="font-tamil">📅</span>
                  <span>
                    {new Date(content.publishedAt || content.createdAt).toLocaleDateString('ta-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-2">
                  <span>👁️</span>
                  <span className="font-tamil">
                    {content.viewCount || 0} பார்வைகள்
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Categories */}
          {content.categories && content.categories.length > 0 && (
            <div className="px-6 sm:px-8 md:px-12 py-6 border-t border-gray-200">
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
            <div className="px-6 sm:px-8 md:px-12 py-6 border-t border-gray-200">
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
          <div className="px-6 sm:px-8 md:px-12 py-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 font-tamil">பகிர்தல்</h3>
            <div className="flex flex-wrap gap-3">
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-tamil text-sm">
                முகநூல்
              </button>
              <button className="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors font-tamil text-sm">
                ட்விட்டர்
              </button>
              <button className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-tamil text-sm">
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
    </ContentPageClient>
  );
}
