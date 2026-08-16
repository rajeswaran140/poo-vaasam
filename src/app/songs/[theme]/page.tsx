/**
 * /songs/[theme] — SEO collection landing page per theme (Tamil Mother Songs,
 * Tamil Love Songs, …). Targets broad category searches and internally links
 * to the individual song pages. No lyrics — original descriptive copy only.
 *
 * Build-time prerender (like /songs): DynamoDB creds exist only at build, so
 * the song list is fetched there. `dynamicParams = false` 404s any theme that
 * doesn't have a generated page (i.e. fewer than MIN_SONGS_FOR_COLLECTION).
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { SongCatalog } from '@/application/use-cases/SongCatalog';
import type { PublicSongDTO } from '@/domain/songs/PublicSong';
import { JsonLd } from '@/components/JsonLd';
import { SubscribeButton } from '@/components/SubscribeButton';
import { WhatsAppShareButton } from '@/components/content/WhatsAppShareButton';
import { SITE_NAME, SITE_URL, absoluteUrl, alternatesFor, breadcrumbJsonLd, toDescription } from '@/lib/seo';
import { contentPath } from '@/config/vanity-paths';
import { SONG_THEME_LABELS } from '@/config/song-themes';
import {
  SONG_COLLECTIONS,
  eligibleCollectionThemes,
  isCollectionTheme,
  MIN_SONGS_FOR_COLLECTION,
} from '@/config/song-collections';

export const revalidate = 300;
export const dynamicParams = false;

async function getSongs(): Promise<PublicSongDTO[]> {
  try {
    return await new SongCatalog(new ContentRepository()).listPublished(100);
  } catch (error) {
    console.error('[songs/theme] getSongs failed:', error);
    return [];
  }
}

export async function generateStaticParams(): Promise<{ theme: string }[]> {
  const songs = await getSongs();
  // Unclassified songs count toward no collection.
  return eligibleCollectionThemes(songs.map((s) => s.theme).filter((t): t is string => !!t)).map((theme) => ({ theme }));
}

interface PageProps {
  params: Promise<{ theme: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { theme } = await params;
  if (!isCollectionTheme(theme)) return { title: 'பாடல்கள் கிடைக்கவில்லை' };
  const c = SONG_COLLECTIONS[theme];
  const title = `${c.englishTitle} — ${c.tamilTitle} by Raj`;
  const description = toDescription(c.metaDescription);
  return {
    title,
    description,
    alternates: alternatesFor(`/songs/${theme}`),
    openGraph: {
      title: `${title} | ${SITE_NAME}`,
      description,
      url: `/songs/${theme}`,
      type: 'website',
      siteName: SITE_NAME,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function SongCollectionPage({ params }: PageProps) {
  const { theme } = await params;
  if (!isCollectionTheme(theme)) notFound();

  const c = SONG_COLLECTIONS[theme];
  const all = await getSongs();
  const songs = all.filter((s) => s.theme === theme);
  if (songs.length < MIN_SONGS_FOR_COLLECTION) notFound();

  const others = eligibleCollectionThemes(all.map((s) => s.theme).filter((t): t is string => !!t)).filter((t) => t !== theme);

  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${c.englishTitle} — ${c.tamilTitle}`,
    description: c.metaDescription,
    url: absoluteUrl(`/songs/${theme}`),
    inLanguage: 'ta',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: songs.length,
      itemListElement: songs.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absoluteUrl(contentPath(s.id)),
        name: s.title,
      })),
    },
  };
  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'முகப்பு', path: '/' },
    { name: 'பாடல்கள்', path: '/songs' },
    { name: c.tamilTitle, path: `/songs/${theme}` },
  ]);

  return (
    <div className="min-h-screen flex flex-col text-gray-100">
      <JsonLd data={[collectionJsonLd, breadcrumbLd]} />
      <Header />
      <main id="main" className="flex-1">
        <section className="w-full px-6 pb-8 pt-24 sm:px-10 lg:px-16">
          <nav className="mb-4 text-sm text-gray-400" aria-label="Breadcrumb">
            <Link href="/songs" className="hover:text-orange-400">பாடல்கள்</Link>
            <span className="mx-1.5" aria-hidden>·</span>
            <span>{c.tamilTitle}</span>
          </nav>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-orange-500">{c.englishTitle}</p>
          <h1 className="mb-4 font-kavivanar text-4xl font-extrabold leading-tight sm:text-5xl">{c.tamilTitle}</h1>
          <p className="max-w-2xl font-tamil text-base leading-relaxed text-gray-300 sm:text-lg">{c.intro}</p>
        </section>

        <section className="container mx-auto max-w-6xl px-4 pb-12 sm:px-6">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {songs.map((s) => (
              // The theme pages are the SEO landing surface for a theme, and they
              // were the one browse surface with no share control at all. The
              // button is a SIBLING of the card link (not nested inside it) —
              // interactive content inside an <a> is invalid HTML.
              <li
                key={s.id}
                className="group flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-800/50 p-3 transition-colors hover:border-orange-500/50"
              >
                <Link href={contentPath(s.id)} className="flex min-w-0 flex-1 items-center gap-4">
                  {s.coverUrl ? (
                    <Image
                      src={s.coverUrl}
                      alt={s.title}
                      width={80}
                      height={80}
                      sizes="80px"
                      className="h-20 w-20 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-gray-700 text-2xl" aria-hidden>🎵</span>
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-tamil font-semibold text-gray-100 group-hover:text-orange-400">{s.title}</span>
                    <span className="truncate text-xs text-gray-400">{s.artist}</span>
                  </span>
                </Link>
                <WhatsAppShareButton
                  url={absoluteUrl(contentPath(s.id))}
                  title={s.title}
                  verb="listen"
                  songId={s.id}
                  compact
                />
              </li>
            ))}
          </ul>

          {others.length > 0 && (
            <nav className="mt-10 flex flex-wrap items-center gap-2 text-sm" aria-label="Other song themes">
              <span className="font-tamil text-gray-400">மேலும்:</span>
              {others.map((t) => (
                <Link
                  key={t}
                  href={`/songs/${t}`}
                  className="rounded-full border border-gray-700 px-3 py-1 font-tamil text-gray-300 transition-colors hover:border-orange-500/50 hover:text-orange-400"
                >
                  {SONG_THEME_LABELS[t]}
                </Link>
              ))}
              <Link
                href="/songs"
                className="rounded-full border border-gray-700 px-3 py-1 font-tamil text-gray-300 transition-colors hover:border-orange-500/50 hover:text-orange-400"
              >
                அனைத்து பாடல்கள்
              </Link>
            </nav>
          )}

          <div className="mt-10 text-center">
            <SubscribeButton
              label="YouTube"
              source={`collection_${theme}`}
              className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-7 py-3.5 font-tamil font-bold text-white shadow-lg transition-colors hover:bg-orange-700"
            />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
