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
import Image from 'next/image';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { getSongHero } from '@/config/song-heroes';
import { contentPath } from '@/config/vanity-paths';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus, ContentType } from '@/types/content';
import { CONTENT_SECTIONS } from '@/config/site';
import { contentJsonLd, type ContentJsonLdInput } from '@/lib/content-jsonld';
import { themeForSongWithOverride } from '@/config/song-themes';
import { themeSongLabelEn } from '@/config/song-collections';
import { ContentPageClient } from '@/components/ContentPageClient';
import { PoemReader } from '@/components/PoemReader';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { DetailAudioPlayer } from '@/components/music/DetailAudioPlayer';
import { JsonLd } from '@/components/JsonLd';
import { ShareRow } from '@/components/content/ShareRow';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import { isYouTubeUrl, getYouTubeWatchUrl, getYouTubeId } from '@/lib/utils/youtube';
import { SITE_URL, SITE_NAME, absoluteUrl, toDescription, alternatesFor, actionVerb, crawlerAuthor } from '@/lib/seo';
import { isoDuration } from '@/lib/iso-duration';

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

/** Tamil section label by section href — the canonical names used on the
 *  section pages' own breadcrumbs (keeps /content's parent crumb in sync). */
const SECTION_LABEL_BY_HREF: Record<string, string> = Object.fromEntries(
  CONTENT_SECTIONS.map((s) => [s.href, s.label])
);

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
    `${content.title} — ${enType} by ${crawlerAuthor(content.author)}`;

  // Description prefers an explicit seoDescription; otherwise build a romanised
  // sentence that's useful as a SERP snippet. The verb matches the medium —
  // songs are "listen free", text is "read for free". For songs we theme the
  // type label (e.g. "Tamil Homeland Song") so the snippet carries the themed
  // keyword instead of a generic "Tamil Song".
  const descType =
    content.type === ContentType.SONGS
      ? themeSongLabelEn(themeForSongWithOverride(content.id, content.theme))
      : enType;
  const description =
    content.seoDescription ||
    `${descType} "${content.title}" by ${crawlerAuthor(content.author)} on Tamilagaval — ${actionVerb(content.type)} for free.`;

  const url = absoluteUrl(contentPath(content.id));
  // Share image: we deliberately DON'T point og:image at the raw cover — the
  // covers are ~3MB squares that WhatsApp's scraper skips or shrinks to a tiny
  // thumbnail. Instead we let the co-located opengraph-image.tsx render a
  // 1200×630 card (correct ratio + small PNG + auto og:image:width/height) that
  // *embeds* the cover. Next auto-injects it for both OG and Twitter.

  return {
    title,
    description: toDescription(description),
    alternates: alternatesFor(contentPath(content.id)),
    openGraph: {
      title,
      description: toDescription(description),
      url,
      // A song is `music.song` (richer music cards); everything else is an article.
      type: content.type === ContentType.SONGS ? 'music.song' : 'article',
      siteName: SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: toDescription(description),
    },
  };
}

export default async function ContentPage({ params }: PageProps) {
  const { id } = await params;
  const content = await getContent(id);

  if (!content) {
    notFound();
  }

  const pageUrl = absoluteUrl(contentPath(content.id));
  const ytId = getYouTubeId(content.videoUrl);
  const enType = TYPE_LABEL_EN[content.type] || 'Tamil Poetry';
  const browseTo = BROWSE_HREF[content.type] || { href: '/all', label: 'அனைத்து உள்ளடக்கம்' };
  // Bespoke full-bleed hero for select songs (e.g. தாயகம்). When present it
  // provides the page's <h1>, so the in-card title/eyebrow are suppressed below.
  const hero = getSongHero(content.id);

  // Designed hero art (if any) is the canonical share/structured-data image.
  const structuredImage = hero?.image || content.featuredImage;
  const audioDurationIso =
    typeof content.audioDuration === 'number' && content.audioDuration > 0
      ? isoDuration(content.audioDuration)
      : undefined;

  // Breadcrumb parent = the browse destination, labelled with the section's own
  // Tamil name (so it matches that section page's breadcrumb) — or "all content"
  // for the /all aggregate.
  const parentLabel = SECTION_LABEL_BY_HREF[browseTo.href] ?? 'அனைத்து உள்ளடக்கம்';
  const jsonLd = contentJsonLd(content as ContentJsonLdInput, {
    canonicalUrl: pageUrl,
    image: structuredImage,
    audioDurationIso,
    parent: { name: parentLabel, url: `${SITE_URL}${browseTo.href}` },
    youtubeId: ytId,
    videoDescription: toDescription(content.description || content.body),
  });

  return (
    <ContentPageClient
      contentId={content.id}
      contentType={content.type}
      contentTitle={content.title}
    >
      <div className="min-h-screen bg-gray-50">
        <JsonLd data={jsonLd} />
        <Header />

        {/* Bespoke image hero (select songs only). The artwork carries its own
            text, so we show it clean and in FULL — no crop, no overlay, no
            rendered heading. Responsive: full-bleed on mobile, framed within the
            content width on larger screens; the image keeps its natural ratio.
            The page heading is provided to SEO / screen-readers via sr-only h1. */}
        {hero && (
          <section className="w-full bg-gray-50">
            <div className="mx-auto max-w-7xl sm:px-6 sm:pt-6">
              <Image
                src={hero.image}
                alt={`${hero.heading} — ${content.title}, ${enType} by ${crawlerAuthor(content.author)}`}
                width={1672}
                height={941}
                priority
                sizes="(max-width: 1280px) 100vw, 1216px"
                className="h-auto w-full sm:rounded-xl"
              />
            </div>
            <h1 className="sr-only">{content.title}</h1>
          </section>
        )}

        <article className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
          {/* Romanised SEO eyebrow — visible to readers and indexed by crawlers.
              Suppressed when the hero already shows it. */}
          {!hero && (
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-orange-600 sm:text-sm">
              {enType} · by {content.author || 'Rajeswaran Thangarajah'}
            </p>
          )}

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
                {/* The hero already provides the page <h1>; avoid a duplicate. */}
                {!hero && (
                  <>
                    <h1 className="mb-2 font-tamil text-3xl font-bold text-gray-900 sm:text-4xl">
                      {content.title}
                    </h1>
                    <p className="mb-6 font-tamil text-gray-500">
                      {TYPE_LABELS[content.type] || ''}{content.author ? ` · ${content.author}` : ''}
                    </p>
                  </>
                )}
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
            <ShareRow url={pageUrl} title={content.title} verb={actionVerb(content.type)} />
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
