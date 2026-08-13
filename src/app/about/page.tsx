/**
 * /about — who is behind தமிழகவல். Personal positioning: this is one creator's
 * (Raj's) showcase of his poems, songs and channel — not a generic
 * Tamil-literature archive. The Person JSON-LD here mirrors the home page so
 * search engines see the site as authored work, not a directory.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { JsonLd } from '@/components/JsonLd';
import { isYouTubeChannelConfigured, youtubeSubscribeUrl, isYouTubeVideosConfigured, socialProfileUrls } from '@/config/site';
import { TrackedYouTubeAnchor } from '@/components/TrackedYouTubeAnchor';
import { SITE_URL, alternatesFor, breadcrumbJsonLd } from '@/lib/seo';

// Crawler-facing metadata is romanised English; the visible UI on /about
// stays Tamil. Real queries here are "rajeswaran thangarajah" /
// "tamilagaval about".
const META_TITLE = 'About Raj';
const META_DESCRIPTION =
  'Tamilagaval is the personal home of Tamil writer and lyricist Raj — Tamil poems, songs and YouTube videos, always free.';

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: alternatesFor('/about'),
  openGraph: {
    title: META_TITLE,
    description: META_DESCRIPTION,
    url: '/about',
    type: 'profile',
  },
  twitter: { card: 'summary_large_image', title: META_TITLE, description: META_DESCRIPTION },
};

// YouTube + Facebook + Instagram (each only when configured) — one source of
// truth so /, /about and the footer always agree.
const personSameAs = socialProfileUrls();

const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Raj',
  alternateName: 'இராஜ்',
  url: `${SITE_URL}/about`,
  jobTitle: 'Tamil poet and lyricist',
  description: 'Tamil writer and lyricist publishing original poems, songs and videos at tamilagaval.com. Tamil kavithai and paadal varigal — always free.',
  ...(personSameAs.length > 0 ? { sameAs: personSameAs } : {}),
};

// Home › About breadcrumb so search engines show the page's place in the
// hierarchy; emitted alongside the Person node in one structured-data block.
const aboutJsonLd = [
  breadcrumbJsonLd([
    { name: 'Tamilagaval', path: '/' },
    { name: 'About', path: '/about' },
  ]),
  personJsonLd,
];

const PILLARS = [
  { icon: '📝', label: 'கவிதைகள்', desc: 'இராஜின் சொந்தக் கவிதைகள் — காதல், இயற்கை, வாழ்க்கை மற்றும் மனித உணர்வுகள்.', href: '/poems' },
  { icon: '🎵', label: 'பாடல்கள்', desc: 'சொந்தப் பாடல் வரிகளும் அவற்றின் இசை வடிவங்களும் — கேட்கவும், ரசிக்கவும், பகிரவும்.', href: '/songs' },
  { icon: '🎬', label: 'காணொளிகள்', desc: 'தமிழகவல் YouTube சேனலில் வெளியாகும் பாடல்கள் மற்றும் காணொளிகள்.', href: '/videos' },
] as const;

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <JsonLd data={aboutJsonLd} />
      <Header />

      {/* Brand hero — solid orange brand band, matching the home hero so the
          white badge + heading read as intended (the parent is dark gray). */}
      <section className="relative w-full overflow-hidden bg-orange-600 text-white">

        {/* pt-32 (not py-20) clears the fixed 80px header so the "பற்றி" badge
            isn't flush against it; pb-20 keeps the generous bottom spacing. */}
        <div className="relative container mx-auto px-6 pt-32 pb-20 sm:px-10">
          <span className="mb-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 font-tamil text-xs font-semibold uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-sm">
            பற்றி
          </span>
          <h1 className="font-kavivanar text-5xl font-extrabold leading-tight drop-shadow-md sm:text-6xl lg:text-7xl">
            தமிழகவல்
          </h1>
          <p className="mt-4 max-w-2xl font-tamil text-lg text-white/90 sm:text-xl">
            இராஜின் சொந்தக் கவிதைகளும் பாடல்களும் — ஒரே இடத்தில், என்றும் இலவசம்.
          </p>
          <p className="mt-3 max-w-2xl text-base italic text-white/90 sm:text-lg">
            Where Tamil Poetry Becomes Song
          </p>
          <p className="mt-2 text-sm font-semibold uppercase tracking-wider text-white/80">
            An AI-Assisted Musical Platform
          </p>
        </div>
      </section>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* What this site is */}
        <section className="mb-10">
          <h2 className="mb-4 font-kavivanar text-3xl font-bold text-white sm:text-4xl">இந்த தளம் என்ன?</h2>
          <div className="space-y-4 font-tamil leading-relaxed text-gray-300">
            <p>
              <strong className="text-white">தமிழகவல்</strong> என்பது இராஜின் சொந்தக் கவிதைகள், பாடல்கள் மற்றும் படைப்புகளை ஒரே இடத்தில் கொண்டுவரும் ஒரு தமிழ்ப் படைப்புத் தளம்.
            </p>
            <p>
              இது ஒரு பொது தமிழ் இலக்கியத் தொகுப்பு அல்ல — ஒரு எழுத்தாளரின் சொந்தப் படைப்புகளை வாசகர்களுக்கும் இசை ரசிகர்களுக்கும் நேரடியாகக் கொண்டுசேர்க்கும் முயற்சி.
            </p>
            <p>
              கவிதைகளைப் படிக்கலாம், பாடல்களைக் கேட்கலாம், YouTube சேனலின் காணொளிகளைப் பார்க்கலாம் — அனைத்தும் இங்கேயே. பதிவு செய்யத் தேவையில்லை. கட்டணம் இல்லை.
            </p>
          </div>
        </section>

        {/* Three pillars */}
        <section className="mb-10">
          <h2 className="mb-6 font-kavivanar text-3xl font-bold text-white sm:text-4xl">இங்கே என்ன கிடைக்கும்?</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {PILLARS.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition-all hover:-translate-y-0.5 hover:border-orange-400/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
              >
                <div className="mb-3 text-3xl" aria-hidden>{p.icon}</div>
                <h3 className="mb-1 font-kavivanar text-xl font-bold text-white">{p.label}</h3>
                <p className="font-tamil text-sm text-gray-400">{p.desc}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* About the author */}
        <section className="mb-10">
          <h2 className="mb-4 font-kavivanar text-3xl font-bold text-white sm:text-4xl">யார் இதை உருவாக்குகிறார்?</h2>
          <div className="space-y-4 font-tamil leading-relaxed text-gray-300">
            <p>
              <strong className="text-white">இராஜ்</strong> — தமிழ் எழுத்தாளரும் பாடலாசிரியரும்.
            </p>
            <p>
              வாழ்க்கை, காதல், இயற்கை, நினைவுகள் மற்றும் மனித உணர்வுகளை கவிதைகளாகவும் பாடல்களாகவும் எழுதுகிறார்.
            </p>
            <p>
              புதிய படைப்புகள் தமிழகவல் தளத்திலும் YouTube சேனலிலும் தொடர்ந்து வெளியாகின்றன.
            </p>
          </div>
        </section>

        {/* The platform — how the music is made (AI transparency) */}
        <section className="mb-10">
          <h2 className="mb-4 font-kavivanar text-3xl font-bold text-white sm:text-4xl">இசை உருவாக்கம்</h2>
          <div className="space-y-4 font-tamil leading-relaxed text-gray-300">
            <p>
              தமிழகவலில் வெளியாகும் பாடல்களின் <strong className="text-white">பாடல் வரிகள் இராஜின் சொந்தப் படைப்புகள்</strong>.
            </p>
            <p>
              இசை மற்றும் குரல் உருவாக்கத்தில் <strong className="text-white">AI-assisted music production</strong> தொழில்நுட்பங்கள் பயன்படுத்தப்படுகின்றன.
            </p>
            {/* Credits + rights, mirroring the block Raj puts on every YouTube
                description so the site and the channel state the same thing. */}
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 not-italic">
              <p className="font-semibold text-white">Lyrics: Raj</p>
              <p className="font-semibold text-white">Music Production &amp; Creative Direction: TamilAgaval.com</p>
              <p className="font-semibold text-white">AI-Assisted Music Production</p>
              <p className="mt-2 text-sm text-gray-400">© 2026 TamilAgaval / Raj. All rights reserved.</p>
            </div>
          </div>
        </section>

        {/* Connect */}
        <section className="rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/10 to-orange-700/5 p-6 text-center sm:p-8">
          <h2 className="mb-2 font-kavivanar text-2xl font-bold text-white sm:text-3xl">தொடர்பில் இருங்கள்</h2>
          <p className="mx-auto mb-6 max-w-md font-tamil text-gray-300">
            புதிய கவிதைகள், பாடல்கள், காணொளிகள் — எதையும் தவறவிடாதீர்கள்.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {isYouTubeChannelConfigured() && (
              <TrackedYouTubeAnchor
                href={youtubeSubscribeUrl('about')}
                source="about"
                className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-6 py-3 font-tamil text-sm font-bold text-white shadow-lg transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
                <span>YouTube சந்தா</span>
              </TrackedYouTubeAnchor>
            )}
            {isYouTubeVideosConfigured() && (
              <Link
                href="/videos"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 font-tamil text-sm font-bold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
              >
                காணொளிகள் பாருங்கள்
              </Link>
            )}
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 font-tamil text-sm font-bold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
            >
              தொடர்பு கொள்ளுங்கள்
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
