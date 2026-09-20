/**
 * Karaoke Service Page — /karaoke
 *
 * Sells instrumental (karaoke) versions of songs from THIS catalogue, to
 * singers who heard one and want to sing it themselves. The first real sale
 * (2026-09-12) took exactly that shape.
 *
 * SCOPED TO OUR OWN SONGS ON PURPOSE. Offering "any Tamil song" would be a
 * bigger market and a worse business: we do not own those recordings, and this
 * catalogue's clean IP position is worth more than the extra orders. Every song
 * offered here is one whose stems we can obtain.
 *
 * Stems are fetched per order rather than held for the whole catalogue, so this
 * is a REQUEST form, not an instant checkout — the copy promises a confirmation
 * and a payment link, never an immediate download.
 *
 * Modelled on /music-composition: same shell, same schema shape, same
 * scroll-to-form funnel. Pricing lives in lib/karaoke.ts so the card, the
 * schema Offer and the FAQ answer cannot drift apart — that drift was a real
 * audit finding on the composition page.
 */

export const revalidate = 300;

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { JsonLd } from '@/components/JsonLd';
import { KaraokeRequestForm } from '@/components/KaraokeRequestForm';
import { SITE_URL, SITE_NAME, alternatesFor, breadcrumbJsonLd } from '@/lib/seo';
import {
  KARAOKE_PRICE,
  KARAOKE_PRICE_CURRENCY,
  KARAOKE_PRICE_LABEL,
  KARAOKE_TURNAROUND_LABEL,
  KARAOKE_DELIVERABLE,
  KARAOKE_VERSIONS,
} from '@/lib/karaoke';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';

const META_TITLE = 'கராஓகே சேவை · Tamil Karaoke Tracks';
const META_DESCRIPTION =
  'தமிழகவல் பாடல்களின் கராஓகே (இசை மட்டும்) பதிப்புகள். Instrumental versions of Tamilagaval songs — sing them yourself.';

export const metadata: Metadata = {
  title: `${META_TITLE} | ${SITE_NAME}`,
  description: META_DESCRIPTION,
  alternates: alternatesFor('/karaoke'),
  openGraph: {
    title: `${META_TITLE} | ${SITE_NAME}`,
    description: META_DESCRIPTION,
    url: '/karaoke',
    type: 'website',
  },
};

const ORDER_HREF = '#request';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'விலை எவ்வளவு?',
    a: `ஒரு பாடலுக்கு ${KARAOKE_PRICE_LABEL}. Payment link is sent after we confirm the song is available.`,
  },
  {
    q: 'எவ்வளவு நேரம் ஆகும்?',
    a: `${KARAOKE_TURNAROUND_LABEL}. The karaoke is built from the song's own stems, so it matches the recording you know.`,
  },
  {
    q: 'எனக்கு என்ன கிடைக்கும்?',
    a: KARAOKE_DELIVERABLE.join(' · '),
  },
  {
    q: 'வேறு பாடல்களுக்கு செய்வீர்களா?',
    a: 'We make karaoke only for songs in this catalogue — those are the recordings we own. We cannot make karaoke from someone else’s record.',
  },
];

/**
 * Titles for the picker. Best-effort: a failure returns an empty list and the
 * form falls back to a free-text field, which is better than a broken page.
 */
async function getSongTitles(): Promise<string[]> {
  try {
    const repo = new ContentRepository();
    const result = await repo.findByType(ContentType.SONGS, {
      limit: 200,
      status: ContentStatus.PUBLISHED,
    });
    return result.items
      .map((i) => i.toObject().title)
      .filter((t): t is string => Boolean(t && t.trim()))
      .sort((a, b) => a.localeCompare(b, 'ta'));
  } catch {
    return [];
  }
}

const jsonLd = [
  breadcrumbJsonLd([
    { name: 'Tamilagaval', path: '/' },
    { name: 'Karaoke', path: '/karaoke' },
  ]),
  {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Tamil Karaoke Tracks',
    serviceType: 'Karaoke production',
    inLanguage: 'ta',
    url: `${SITE_URL}/karaoke`,
    provider: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    areaServed: 'Worldwide',
    description: META_DESCRIPTION,
    // A flat per-song price, unlike composition's "starting from" floor — so a
    // plain Offer is the honest model here, not an AggregateOffer.
    offers: {
      '@type': 'Offer',
      priceCurrency: KARAOKE_PRICE_CURRENCY,
      price: KARAOKE_PRICE,
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/karaoke${ORDER_HREF}`,
    },
    potentialAction: { '@type': 'OrderAction', target: `${SITE_URL}/karaoke${ORDER_HREF}` },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  },
];

export default async function KaraokePage() {
  const songs = await getSongTitles();

  return (
    <div className="min-h-screen bg-gray-900">
      <Header />
      <JsonLd data={jsonLd} />

      <main className="mx-auto max-w-5xl px-4 pb-12 pt-28 sm:pb-16">
        <section className="text-center">
          <h1 className="mb-4 font-tamil text-4xl font-bold text-white sm:text-5xl">கராஓகே சேவை</h1>
          <p className="mx-auto mb-2 max-w-2xl font-tamil text-lg text-gray-300">
            தமிழகவல் பாடல்களின் இசை மட்டும் பதிப்புகள் — நீங்களே பாடுங்கள்.
          </p>
          <p className="mx-auto mb-8 max-w-2xl text-gray-400">
            Instrumental versions of songs from this catalogue, built from the original stems so they
            match the recording you know.
          </p>
          <Link
            href={ORDER_HREF}
            className="inline-flex items-center justify-center rounded-full bg-orange-600 px-8 py-4 font-tamil text-lg font-bold text-white shadow-lg transition-colors hover:bg-orange-700"
          >
            கராஓகே கேளுங்கள் · Request a karaoke
          </Link>

          {/*
            The three facts a buyer needs before they will scroll: what it
            costs, how long it takes, and whether their song is even eligible.
            All three were below the fold, and the song count was invisible
            until the form loaded — so the page asked for a request before
            answering "can you even do mine?".
          */}
          <dl className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="font-tamil text-gray-400">விலை</dt>
              <dd className="font-semibold text-orange-400">{KARAOKE_PRICE_LABEL}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="font-tamil text-gray-400">நேரம்</dt>
              <dd className="font-semibold text-gray-200">{KARAOKE_TURNAROUND_LABEL}</dd>
            </div>
            {songs.length > 0 && (
              <div className="flex items-baseline gap-2">
                <dt className="font-tamil text-gray-400">பாடல்கள்</dt>
                <dd className="font-semibold text-gray-200">{songs.length} available</dd>
              </div>
            )}
          </dl>
        </section>

        {/*
          HOW IT WORKS. The single biggest source of hesitation on this page was
          that it looks like a shop but is not one: stems are fetched per order,
          so nothing downloads on click. Saying so in three steps is kinder than
          leaving a buyer to discover it after pressing the button.
        */}
        <section className="mt-14">
          <h2 className="mb-6 text-center font-tamil text-2xl font-bold text-white">
            எப்படி வேலை செய்கிறது · How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              { n: '1', ta: 'பாடலைத் தேர்வு செய்யுங்கள்', en: 'Tell us which song. No payment yet.' },
              { n: '2', ta: 'நாங்கள் உறுதி செய்கிறோம்', en: 'We confirm the song can be made, then send a payment link.' },
              { n: '3', ta: 'தனிப்பட்ட இணைப்பு', en: `Your private download link — both versions, ${KARAOKE_TURNAROUND_LABEL}.` },
            ].map((step) => (
              <li key={step.n} className="rounded-2xl border border-gray-700 bg-gray-800/60 p-5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 font-bold text-white">
                  {step.n}
                </span>
                <p className="mt-3 font-tamil font-semibold text-white">{step.ta}</p>
                <p className="mt-1 text-sm text-gray-400">{step.en}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-700 bg-gray-800/60 p-6">
            <h2 className="mb-3 font-tamil text-2xl font-bold text-white">விலை · Price</h2>
            <p className="mb-1 text-4xl font-bold text-orange-400">{KARAOKE_PRICE_LABEL}</p>
            <p className="font-tamil text-gray-400">ஒரு பாடலுக்கு · per song</p>
            <p className="mt-3 text-sm text-gray-400">{KARAOKE_TURNAROUND_LABEL}</p>
          </div>
          <div className="rounded-2xl border border-gray-700 bg-gray-800/60 p-6">
            <h2 className="mb-3 font-tamil text-2xl font-bold text-white">உங்களுக்கு கிடைப்பது · What you get</h2>
            <ul className="space-y-2">
              {KARAOKE_DELIVERABLE.map((d) => (
                <li key={d} className="flex items-start gap-2 text-gray-300">
                  <span aria-hidden className="mt-0.5 text-green-400">✓</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/*
          THE TWO VERSIONS. Both have shipped with every order since the first
          one, and this page mentioned neither — so a buyer could not know they
          were getting a choice, and Anton was told the wrong one for his room
          because the distinction lived only in an email.
        */}
        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          {KARAOKE_VERSIONS.map((v) => (
            <div key={v.name} className="rounded-2xl border border-gray-700 bg-gray-800/40 p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xl font-bold text-white">{v.name}</h3>
                <span className="rounded-full bg-orange-600/15 px-3 py-1 text-xs font-semibold text-orange-300">
                  {v.forWhat}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-300">{v.why}</p>
            </div>
          ))}
          <p className="sm:col-span-2 text-center text-sm text-gray-500">
            Both are included in the same price — you do not choose at checkout.
          </p>
        </section>

        <section id="request" className="mt-14 scroll-mt-20">
          <h2 className="mb-6 text-center font-tamil text-3xl font-bold text-white">
            கோரிக்கை · Request a karaoke
          </h2>
          <KaraokeRequestForm songs={songs} />
        </section>

        <section className="mt-16">
          <h2 className="mb-6 text-center font-tamil text-3xl font-bold text-white">
            அடிக்கடி கேட்கப்படும் கேள்விகள் · FAQ
          </h2>
          <div className="mx-auto max-w-3xl space-y-4">
            {FAQ.map((f) => (
              <details key={f.q} className="rounded-xl border border-gray-700 bg-gray-800/60 p-5">
                <summary className="cursor-pointer font-tamil text-lg font-semibold text-white">{f.q}</summary>
                <p className="mt-3 text-gray-300">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-16 text-center">
          <p className="font-tamil text-gray-400">உங்கள் சொந்த வரிகளுக்கு புதிய பாடல் வேண்டுமா?</p>
          {/*
            inline-flex + min-h-11 (44px), not an inline <a> inside the sentence.
            A mobile audit on 2026-09-16 measured the inline version at 186x20 —
            under the 44px minimum a thumb needs. Wrapping it in the sentence
            made it a 20px-tall target; giving it its own line and real padding
            makes it a real one.
          */}
          <Link
            href="/music-composition"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-gray-700 px-5 py-2.5 font-tamil text-orange-400 transition-colors hover:border-orange-500 hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            இசையமைப்பு சேவை →
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  );
}
