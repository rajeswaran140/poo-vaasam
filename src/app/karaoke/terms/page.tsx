/**
 * Karaoke Licence — /karaoke/terms
 *
 * ⚠️ DRAFT FOR LEGAL REVIEW. Not reviewed by a lawyer. Shipped `noindex` and
 * unlinked from the site so it can be read and marked up without being live
 * to buyers. Remove the noindex, link it from /karaoke, and reference it at
 * checkout only once a lawyer has signed it off.
 *
 * WHY EACH CLAUSE IS WHAT IT IS. Every decision below was a choice with an
 * alternative, and the reasoning is recorded beside it so a reviewer is
 * marking up a position rather than guessing at one. Search this file for
 * "DECISION" to find every point that can be changed without touching the rest.
 *
 * Two clauses exist for reasons specific to this catalogue and would be absent
 * from any template:
 *   - §7 Content ID. These recordings may be fingerprinted, so a buyer's own
 *     cover can be auto-claimed against a track they paid for. Silence here is
 *     how a paying customer ends up feeling cheated by a system neither party
 *     controls.
 *   - §2 the AI-production disclosure, and the open question in §10 about
 *     whether the generator's terms permit sub-licensing at all. That question
 *     gates whether this product can be sold, not merely how it is worded.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { alternatesFor } from '@/lib/seo';
import { KARAOKE_PRICE_LABEL } from '@/lib/karaoke';

const META_TITLE = 'Karaoke Licence';
const META_DESCRIPTION =
  'The licence that comes with a TamilAgaval karaoke track — what you may do with it, and what stays with us.';

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: alternatesFor('/karaoke/terms'),
  // DRAFT: keep out of the index until a lawyer has reviewed it.
  robots: { index: false, follow: false },
};

const LAST_UPDATED = '16 September 2026';

/** DECISION: non-exclusive, perpetual, worldwide. See §1. */
const CLAUSES: { n: string; h: string; body: React.ReactNode }[] = [
  {
    n: '1',
    h: 'What you are buying',
    body: (
      <>
        <p>
          You are buying a <strong>licence to use</strong> one karaoke recording — not the recording
          itself, and not the song. The licence is <strong>non-exclusive</strong>, meaning the same
          karaoke may be licensed to other people. It is worldwide and does not expire.
        </p>
        <p className="mt-3">
          {/* DECISION: non-exclusive. Exclusive would command a far higher price and
              would stop the same track ever being sold again — wrong at {KARAOKE_PRICE_LABEL}. */}
          A buyer who wants exclusivity should ask; it is a different product at a different price.
        </p>
      </>
    ),
  },
  {
    n: '2',
    h: 'What the recording is',
    body: (
      <p>
        An instrumental version of a TamilAgaval song, produced by removing the lead and backing
        vocals from the original production. Music production is{' '}
        <strong>AI-assisted</strong>, as stated on every TamilAgaval release. The lyrics and the
        composition are original work by Raj Thangarajah.
      </p>
    ),
  },
  {
    n: '3',
    h: 'What you may do',
    body: (
      <>
        {/* DECISION: publishing AND monetisation are allowed. Forbidding them would make the
            product close to worthless to the people who actually buy it — singers and
            creators — and would be unenforceable in practice. Allowing it, with attribution
            required, turns every cover into a credit. */}
        <ul className="ml-5 list-disc space-y-2">
          <li>Sing over it, privately or in public.</li>
          <li>Record your performance and publish it — YouTube, Instagram, streaming services.</li>
          <li><strong>Earn money from that performance</strong>, including advertising and streaming revenue.</li>
          <li>Perform it live, including at paid events.</li>
          <li>Change the key, tempo or length to suit your voice.</li>
        </ul>
      </>
    ),
  },
  {
    n: '4',
    h: 'What you may not do',
    body: (
      <ul className="ml-5 list-disc space-y-2">
        <li>Share, sell, or give away the audio file itself.</li>
        <li>Publish the instrumental on its own, without your performance on it.</li>
        <li>Claim ownership of the music, the lyrics, or the composition.</li>
        <li>Register the recording with any content-identification, distribution or rights service.</li>
        {/* DECISION: sync is excluded. Film, advertising and game use are worth more than
            {KARAOKE_PRICE_LABEL} and are negotiated individually. */}
        <li>Use it in a film, advertisement, game or other production — that is a separate licence; ask us.</li>
        <li>Use it to train a machine-learning model.</li>
      </ul>
    ),
  },
  {
    n: '5',
    h: 'Credit',
    body: (
      <>
        {/* DECISION: attribution required. It costs the buyer nothing and every published
            cover becomes a credit back to the channel. This is the clause that pays for
            allowing monetisation in §3. */}
        <p>
          Where you publish a performance using this track, please credit it in the description:
        </p>
        <p className="mt-3 rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 font-mono text-sm text-gray-200">
          Music: TamilAgaval — tamilagaval.com
        </p>
      </>
    ),
  },
  {
    n: '6',
    h: 'Delivery',
    body: (
      <p>
        The track is delivered as a private download link after payment clears. The link works for a
        limited number of downloads and expires. <strong>Save your file when you receive it.</strong>{' '}
        If a link expires before you have downloaded it, contact us and we will issue another.
      </p>
    ),
  },
  {
    n: '7',
    h: 'Copyright claims on your upload',
    body: (
      <>
        {/* DECISION: disclose rather than stay silent. These recordings may be fingerprinted,
            so a buyer's cover can be auto-claimed against a track they paid for. A buyer who
            discovers that unaided feels cheated; a buyer who was told, and who has a stated
            route to resolution, does not. */}
        <p>
          TamilAgaval recordings may be registered with automated copyright-identification systems.
          A video you publish using this track <strong>may receive an automatic claim</strong>, even
          though you are licensed to use it. This is a machine matching audio, not an accusation.
        </p>
        <p className="mt-3">
          If it happens, send us the link and we will release the claim. That is part of what you
          bought.
        </p>
      </>
    ),
  },
  {
    n: '8',
    h: 'Refunds',
    body: (
      <>
        {/* DECISION: no refund after download, because the goods cannot be returned — but an
            explicit exception where WE cannot deliver, which is the realistic failure given
            stems are located per order. Consumer-law waiver wording belongs at checkout, not
            only here; see the note in §10. */}
        <p>
          Because the track is delivered immediately and cannot be returned, a completed download is
          not refundable.
        </p>
        <p className="mt-3">
          If we cannot produce the karaoke after you have paid, or if the file is faulty, you get a{' '}
          <strong>full refund</strong>. Tell us and it will be issued.
        </p>
      </>
    ),
  },
  {
    n: '9',
    h: 'If the licence is broken',
    body: (
      <p>
        Using the track outside this licence ends it. We may ask for the material to be taken down.
        Nothing here limits rights you have under the law where you live.
      </p>
    ),
  },
];

export default function KaraokeTermsPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <div className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-200">
            <strong>Draft — not yet in force.</strong> This page is awaiting legal review and is not
            linked from the site or referenced at checkout.
          </p>
        </div>

        <h1 className="mb-3 font-kavivanar text-4xl font-extrabold text-white sm:text-5xl">
          Karaoke Licence
        </h1>
        <p className="mb-2 text-gray-300">
          What you may do with a karaoke track from TamilAgaval, and what stays with us.
          Plain language on purpose — if a clause is unclear, ask before you buy.
        </p>
        <p className="mb-10 text-sm text-gray-500">
          கடைசியாகப் புதுப்பிக்கப்பட்டது · Last updated: {LAST_UPDATED} · {KARAOKE_PRICE_LABEL} per song
        </p>

        <div className="space-y-10">
          {CLAUSES.map((c) => (
            <section key={c.n}>
              <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
                <span className="mr-2 text-orange-400">{c.n}.</span>
                {c.h}
              </h2>
              <div className="leading-relaxed text-gray-300">{c.body}</div>
            </section>
          ))}
        </div>

        <section className="mt-12 border-t border-gray-800 pt-8">
          <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">Contact</h2>
          <p className="text-gray-300">
            Questions about this licence, a copyright claim, or a use not covered here —{' '}
            <Link href="/contact" className="text-orange-400 underline hover:text-orange-300">
              get in touch
            </Link>
            .
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
