/**
 * Individual Content View Page
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentPageClient } from '@/components/ContentPageClient';
import { PoemReader } from '@/components/PoemReader';
import { PoetryGuideChat } from '@/components/PoetryGuideChat';

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
            <span>முகப்புக்குத் திரும்புங்கள்</span>
          </Link>
        </div>
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

          {/* Main Content - Enhanced Poem Reader for Poems */}
          {content.type === 'POEMS' ? (
            <PoemReader content={content} />
          ) : (
            <div className="p-6 sm:p-8 md:p-12">
              <div className="prose prose-lg max-w-none">
                <pre className="whitespace-pre-wrap font-poem text-lg sm:text-xl leading-loose text-gray-800 mb-0" style={{ lineHeight: '2.2', letterSpacing: '0.5px' }}>
                  {content.body}
                </pre>
              </div>
            </div>
          )}


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
            ← முகப்புக்குத் திரும்புங்கள்
          </Link>
        </div>
      </article>

      {/* AI Poetry Guide Chat - Floating Button */}
      <PoetryGuideChat
        poemId={content.id}
        poemTitle={content.title}
        poemAuthor={content.author}
      />
    </div>
    </ContentPageClient>
  );
}
