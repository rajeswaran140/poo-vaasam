/**
 * /content/[id] — individual poem / song / story view.
 *
 * Outer page chrome is dark (matches the rest of the site); the article card
 * itself stays light for comfortable reading (Medium pattern). Crawler-facing
 * title and description lead with romanised English so the page ranks for
 * "tamil poem" / "tamil mother poem" / etc., while the visible UI stays Tamil.
 */

import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { ContentPageClient } from '@/components/ContentPageClient';
import { PoemReader } from '@/components/PoemReader';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { DetailAudioPlayer } from '@/components/music/DetailAudioPlayer';
import { JsonLd } from '@/components/JsonLd';
import { ShareRow } from '@/components/content/ShareRow';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import { isYouTubeUrl, getYouTubeWatchUrl, getYouTubeId } from '@/lib/utils/youtube';
import { SITE_URL, SITE_NAME, absoluteUrl, toDescription, alternatesFor } from '@/lib/seo';

// Fully static, regenerated only at build/deploy. We deliberately do NOT use
// time-based ISR (`revalidate`): the runtime has no DynamoDB creds, so a
// background revalidation would re-run getContent → null → notFound() and could
// replace the good build-time page with a 404. Content edits go live on redeploy.
export const revalidate = false;

// Prerender every published detail page at BUILD time. The Amplify SSR runtime
// has no DynamoDB credentials (they live only in the build's .env.production.local),
// so on-demand rendering of a non-prerendered id calls findById → no creds →
// notFound() → 404. Generating all published ids at build (where creds exist)
// fixes that; `dynamicParams = false` makes anything else 404 immediately
// instead of attempting a doomed runtime DB read. New content needs a redeploy
// to get its page — consistent with /songs. See HARDENING.md.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  try {
    const repo = new ContentRepository();
    const ids: { id: string }[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const page = await repo.findAll({
        status: ContentStatus.PUBLISHED,
        limit: 200,
        lastEvaluatedKey,
      });
      for (const item of page.items) ids.push({ id: item.id });
      lastEvaluatedKey = page.lastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);
    return ids;
  } catch (error) {
    console.error('generateStaticParams (content) failed:', error);
    return [];
  }
}

// cache() dedupes the DB read shared by generateMetadata and the page render.
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

/** Tamil section label shown on the page. */
const TYPE_LABELS: Record<string, string> = {
  SONGS: 'பாடல்',
  POEMS: 'கவிதை',
  LYRICS: 'பாடல் வரிகள்',
  STORIES: 'கதை',
  ESSAYS: 'கட்டுரை',
};

/** Romanised label used in <title>/<meta> + the visible SEO eyebrow. */
const TYPE_LABEL_EN: Record<string, string> = {
  SONGS: 'Tamil Song',
  POEMS: 'Tamil Poem',
  LYRICS: 'Tamil Lyrics',
  STORIES: 'Tamil Story',
  ESSAYS: 'Tamil Essay',
};

/** Schema.org type per content kind — sharper than always-CreativeWork. */
const SCHEMA_TYPE: Record<string, string | string[]> = {
  SONGS: ['CreativeWork', 'MusicComposition'],
  POEMS: ['CreativeWork', 'Poem'],
  LYRICS: ['CreativeWork', 'MusicComposition'],
  STORIES: ['CreativeWork', 'ShortStory'],
  ESSAYS: 'Article',
};

/** Browse destination for the "more like this" CTA at the bottom of the page. */
const BROWSE_HREF: Record<string, { href: string; label: string }> = {
  SONGS: { href: '/songs', label: 'மேலும் பாடல்கள்' },
  POEMS: { href: '/poems', label: 'மேலும் கவிதைகள்' },
  LYRICS: { href: '/songs', label: 'மேலும் பாடல்கள்' },
  STORIES: { href: '/all', label: 'அனைத்து உள்ளடக்கம்' },
  ESSAYS: { href: '/all', label: 'அனைத்து உள்ளடக்கம்' },
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

  const enType = TYPE_LABEL_EN[content.type] || 'Tamil Poetry';
  // Compose: "{Tamil title} — Tamil Poem by Rajeswaran Thangarajah".
  // seoTitle (if set in admin) wins outright — bypasses both the Tamil title
  // and the romanised suffix.
  const title =
    content.seoTitle ||
    `${content.title} — ${enType} by ${content.author || 'Rajeswaran Thangarajah'}`;

  // Description prefers an explicit seoDescription; otherwise build a romanised
  // sentence that's useful as a SERP snippet (Google currently pulls the raw
  // first line of the poem, which reads as fragmented art rather than a
  // recognisable description).
  const description =
    content.seoDescription ||
    `${enType} "${content.title}" by ${content.author || 'Rajeswaran Thangarajah'} on Tamilagaval — read for free.`;

  const url = absoluteUrl(`/content/${content.id}`);
  const hasImage = Boolean(content.featuredImage);

  return {
    title,
    description: toDescription(description),
    alternates: alternatesFor(`/content/${content.id}`),
    openGraph: {
      title,
      description: toDescription(description),
      url,
      type: 'article',
      siteName: SITE_NAME,
      // When the content has its own image, use it; otherwise the co-located
      // opengraph-image.tsx generates a branded card automatically.
      ...(hasImage ? { images: [content.featuredImage] } : {}),
    },
    twitter: {
      // There's always a large image now (featuredImage or the generated card).
      card: 'summary_large_image',
      title,
      description: toDescription(description),
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
  const enType = TYPE_LABEL_EN[content.type] || 'Tamil Poetry';
  const browseTo = BROWSE_HREF[content.type] || { href: '/all', label: 'அனைத்து உள்ளடக்கம்' };

  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': SCHEMA_TYPE[content.type] || 'CreativeWork',
      name: content.title,
      headline: content.title,
      inLanguage: 'ta',
      author: { '@type': 'Person', name: content.author || 'Rajeswaran Thangarajah' },
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
        { '@type': 'ListItem', position: 2, name: enType, item: `${SITE_URL}${browseTo.href}` },
        { '@type': 'ListItem', position: 3, name: content.title, item: pageUrl },
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
        <Header />

        <article className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
          {/* Romanised SEO eyebrow — visible to readers and indexed by crawlers. */}
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-orange-600 sm:text-sm">
            {enType} · by {content.author || 'Rajeswaran Thangarajah'}
          </p>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">

            {/* Preview Video — short clip uploaded to the site */}
            {content.previewVideoUrl && (
              <div className="border-b border-gray-200 bg-gradient-to-r from-orange-50 to-orange-100 p-6 sm:p-8">
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-2xl">🎬</span>
                  <span className="font-tamil font-semibold text-gray-700">முன்னோட்டக் காணொளி</span>
                </div>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full max-h-[480px] rounded-lg bg-black"
                  src={content.previewVideoUrl}
                >
                  உங்கள் உலாவி காணொளி இயக்கத்தை ஆதரிக்கவில்லை.
                </video>
                {content.videoUrl && isYouTubeUrl(content.videoUrl) && (
                  <TrackedYouTubeOpen
                    href={getYouTubeWatchUrl(content.videoUrl) || content.videoUrl}
                    destination={ytId ? `video:${ytId}` : 'video'}
                    source="content_preview_cta"
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-orange-600 px-5 py-2.5 font-tamil text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700"
                  >
                    <span>▶️</span>
                    <span>முழு காணொளியை YouTube-ல் பார்க்கவும்</span>
                  </TrackedYouTubeOpen>
                )}
              </div>
            )}

            {/* YouTube Video */}
            {content.videoUrl && isYouTubeUrl(content.videoUrl) && (
              <div className="border-b border-gray-200 bg-gradient-to-r from-orange-50 to-orange-100 p-6 sm:p-8">
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-2xl">▶️</span>
                  <span className="font-tamil font-semibold text-gray-700">காணொளி</span>
                </div>
                <YouTubeEmbed url={content.videoUrl} title={content.title} />
                <TrackedYouTubeOpen
                  href={getYouTubeWatchUrl(content.videoUrl) || content.videoUrl}
                  destination={ytId ? `video:${ytId}` : 'video'}
                  source="content_video_cta"
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-orange-600 px-5 py-2.5 font-tamil text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700"
                >
                  <span>▶️</span>
                  <span>YouTube-ல் பார்</span>
                </TrackedYouTubeOpen>
              </div>
            )}

            {/* Audio — driven through the global player (single audio element) */}
            {content.audioUrl && (
              <div className="border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50 p-6 sm:p-8">
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-2xl">🎵</span>
                  <span className="font-tamil font-semibold text-gray-700">ஒலி கிடைக்கிறது</span>
                </div>
                <DetailAudioPlayer
                  track={{
                    id: content.id,
                    title: content.title,
                    artist: content.author || '',
                    src: content.audioUrl,
                    cover: content.featuredImage || undefined,
                    duration:
                      typeof content.audioDuration === 'number' ? content.audioDuration : undefined,
                  }}
                />
              </div>
            )}

            {/* Main Content - Enhanced Poem Reader for Poems */}
            {content.type === 'POEMS' ? (
              <PoemReader content={content} />
            ) : (
              <div className="p-6 sm:p-8 md:p-12">
                <h1 className="mb-2 font-tamil text-3xl font-bold text-gray-900 sm:text-4xl">
                  {content.title}
                </h1>
                <p className="mb-6 font-tamil text-gray-500">
                  {TYPE_LABELS[content.type] || ''}{content.author ? ` · ${content.author}` : ''}
                </p>
                <div className="prose prose-lg max-w-none">
                  <pre
                    className="mb-0 whitespace-pre-wrap font-poem text-lg leading-loose text-gray-800 sm:text-xl"
                    style={{ lineHeight: '2.2', letterSpacing: '0.5px' }}
                  >
                    {content.body}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Share row — sits below the article card on the light page chrome. */}
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="mb-3 font-tamil text-sm font-semibold uppercase tracking-wide text-gray-700">
              பகிர்தல்
            </h3>
            <ShareRow url={pageUrl} title={content.title} />
          </div>

          {/* Forward-looking CTA: send the reader to more of the same kind, not "back". */}
          <div className="mt-8 text-center">
            <Link
              href={browseTo.href}
              className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-6 py-3 font-tamil font-medium text-white shadow-lg transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
            >
              <span>{browseTo.label}</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </article>
      </div>
    </ContentPageClient>
  );
}
