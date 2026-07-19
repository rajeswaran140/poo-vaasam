/**
 * All Content Listing Page
 */

export const revalidate = 300;

import type { Metadata } from 'next';
import { alternatesFor, SITE_NAME, absoluteUrl, breadcrumbJsonLd } from '@/lib/seo';

// Romanised title/description so this page ranks for the same romanised queries
// the rest of the site targets (tamil songs / poems / kavithai), consistent
// with /songs and /poems. The visible UI below stays Tamil for readers.
const TITLE = 'All Tamil Poems, Songs, Stories & Essays';
const DESCRIPTION =
  'Browse every Tamil poem, song, story and essay on Tamilagaval by Raj — read and listen for free.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: alternatesFor('/all'),
  openGraph: {
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    url: absoluteUrl('/all'),
    type: 'website',
    siteName: SITE_NAME,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
  },
};

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { JsonLd } from '@/components/JsonLd';
import { collectionPageJsonLd, type CollectionItem } from '@/lib/collection-jsonld';
import { contentPath } from '@/config/vanity-paths';
import { WhatsAppShareButton } from '@/components/content/WhatsAppShareButton';

async function getAllContent() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findAll({
      limit: 100,
      status: ContentStatus.PUBLISHED
    });
    return result.items.map(item => item.toObject());
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return [];
  }
}

export default async function AllContentPage() {
  const content = await getAllContent();

  const breadcrumb = breadcrumbJsonLd([
    { name: 'முகப்பு', path: '/' },
    { name: 'அனைத்து உள்ளடக்கம்', path: '/all' },
  ]);
  const collection = collectionPageJsonLd(content as CollectionItem[], {
    name: `${TITLE} — ${SITE_NAME}`,
    description: DESCRIPTION,
    url: absoluteUrl('/all'),
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <JsonLd data={[breadcrumb, collection]} />
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-600 to-purple-700 text-white py-16">
        <div className="container mx-auto px-4">
          <Link href="/" className="text-purple-100 hover:text-white mb-4 inline-block font-tamil">
            ← முகப்புக்குத் திரும்புங்கள்
          </Link>
          <h1 className="text-3xl sm:text-5xl font-bold mb-4 font-tamil">📚 அனைத்து உள்ளடக்கம்</h1>
          <p className="text-xl text-purple-100 font-tamil">தமிழ் இலக்கிய தொகுப்பு</p>
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto px-4 py-12">
        {content.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📚</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 font-tamil">இன்னும் உள்ளடக்கம் இல்லை</h2>
            <p className="text-gray-600 font-tamil">புதிய உள்ளடக்கத்திற்காக பின்னர் சரிபார்க்கவும்</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.map((item: any) => (
              <ContentCard key={item.id} content={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContentCard({ content }: { content: any }) {
  const typeColors: Record<string, string> = {
    SONGS: 'bg-blue-100 text-blue-800',
    POEMS: 'bg-green-100 text-green-800',
    LYRICS: 'bg-yellow-100 text-yellow-800',
    STORIES: 'bg-pink-100 text-pink-800',
    ESSAYS: 'bg-purple-100 text-purple-800',
  };

  const typeNames: Record<string, string> = {
    SONGS: 'பாடல்',
    POEMS: 'கவிதை',
    LYRICS: 'வரிகள்',
    STORIES: 'கதை',
    ESSAYS: 'கட்டுரை',
  };

  return (
    <Link
      href={contentPath(content.id)}
      className="group bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-xl transition-all transform hover:scale-[1.02]"
    >
      <div className="p-6">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-2xl font-bold text-gray-900 font-tamil group-hover:text-purple-600 transition-colors flex-1">
            {content.title}
          </h3>
          <span className={`px-2 py-1 text-xs font-semibold rounded-full font-tamil ml-2 ${typeColors[content.type]}`}>
            {typeNames[content.type]}
          </span>
        </div>
        <p className="text-gray-600 font-tamil text-sm line-clamp-3 mb-4 leading-relaxed">
          {content.body}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-gray-500 font-tamil">
            {content.author}
          </span>
          <div className="flex items-center gap-1">
            <WhatsAppShareButton
              url={absoluteUrl(contentPath(content.id))}
              title={content.title}
              verb={content.type === 'SONGS' ? 'listen' : 'read'}
              asButton
            />
            <span className="text-purple-600 group-hover:text-purple-700 font-medium text-sm font-tamil">
              மேலும் படிக்க →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
