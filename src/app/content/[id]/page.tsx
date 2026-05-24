/**
 * Individual Content View Page
 */

import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentPageClient } from '@/components/ContentPageClient';
import { PoemReader } from '@/components/PoemReader';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { JsonLd } from '@/components/JsonLd';
import { isYouTubeUrl, getYouTubeWatchUrl, getYouTubeId } from '@/lib/utils/youtube';
import { SITE_URL, SITE_NAME, absoluteUrl, toDescription } from '@/lib/seo';

// cache() dedupes the DB read shared by generateMetadata and the page render
const getContent = cache(async (id: string) => {
  try {
    const repo = new ContentRepository();
    const content = await repo.findById(id);
    return content ? content.toObject() : null;
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return null;
  }
});

const TYPE_LABELS: Record<string, string> = {
  SONGS: 'பாடல்',
  POEMS: 'கவிதை',
  LYRICS: 'பாடல் வரிகள்',
  STORIES: 'கதை',
  ESSAYS: 'கட்டுரை',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const content = await getContent(id);

  if (!content) {
    return { title: 'உள்ளடக்கம் கிடைக்கவில்லை' };
  }

  const title = content.seoTitle || content.title;
  const description = toDescription(content.seoDescription || content.description || content.body);
  const url = absoluteUrl(`/content/${content.id}`);
  const hasImage = Boolean(content.featuredImage);

  return {
    title,
    description,
    alternates: { canonical: `/content/${content.id}` },
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      siteName: SITE_NAME,
      ...(hasImage ? { images: [content.featuredImage] } : {}),
    },
    twitter: {
      card: hasImage ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(hasImage ? { images: [content.featuredImage] } : {}),
    },
  };
}

export default async function ContentPage({ params }: PageProps) {
  const { id } = await params;
  const content = await getContent(id);

  if (!content) {
    notFound();
  }

  const pageUrl = absoluteUrl(`/content/${content.id}`);
  const ytId = getYouTubeId(content.videoUrl);
  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: content.title,
      headline: content.title,
      inLanguage: 'ta',
      author: { '@type': 'Person', name: content.author },
      datePublished: content.publishedAt || content.createdAt,
      dateModified: content.updatedAt || content.createdAt,
      url: pageUrl,
      ...(content.featuredImage ? { image: content.featuredImage } : {}),
      ...(content.description ? { description: content.description } : {}),
      publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'முகப்பு', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: content.title, item: pageUrl },
      ],
    },
  ];
  if (ytId) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: content.title,
      description: toDescription(content.description || content.body),
      thumbnailUrl: [`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`],
      uploadDate: content.publishedAt || content.createdAt,
      embedUrl: `https://www.youtube.com/embed/${ytId}`,
      contentUrl: `https://www.youtube.com/watch?v=${ytId}`,
    });
  }

  return (
    <ContentPageClient
      contentId={content.id}
      contentType={content.type}
      contentTitle={content.title}
    >
      <div className="min-h-screen bg-gray-50">
        <JsonLd data={jsonLd} />
        {/* Back Navigation - Fixed at top */}
      <div className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3 max-w-7xl">
          <Link href="/" className="text-gray-600 hover:text-gray-900 inline-flex items-center gap-2 font-tamil transition-colors">
            <span>←</span>
            <span>முகப்புக்குத் திரும்புங்கள்</span>
          </Link>
        </div>
      </div>

      {/* Content */}
      <article className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 max-w-7xl">
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          {/* YouTube Video */}
          {content.videoUrl && isYouTubeUrl(content.videoUrl) && (
            <div className="p-6 sm:p-8 bg-gradient-to-r from-red-50 to-orange-50 border-b border-gray-200">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">▶️</span>
                <span className="font-semibold text-gray-700 font-tamil">காணொளி</span>
              </div>
              <YouTubeEmbed url={content.videoUrl} title={content.title} />
              <a
                href={getYouTubeWatchUrl(content.videoUrl) || content.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-full font-medium hover:bg-red-700 transition-colors font-tamil text-sm shadow-sm"
              >
                <span>▶️</span>
                <span>Watch on YouTube</span>
              </a>
            </div>
          )}

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
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 font-tamil mb-2">
                {content.title}
              </h1>
              <p className="text-gray-500 font-tamil mb-6">
                {TYPE_LABELS[content.type] || ''}{content.author ? ` · ${content.author}` : ''}
              </p>
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
    </div>
    </ContentPageClient>
  );
}
