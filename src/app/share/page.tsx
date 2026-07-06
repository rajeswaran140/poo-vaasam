/**
 * Share Your Story page — a warm invitation for Tamil fans to share a memory
 * tied to a song theme (mother / homeland / love / roots). Submissions land in
 * the admin inbox and, with an email, grow the newsletter list.
 */

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import StoryForm from '@/components/StoryForm';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'உங்கள் கதை பகிருங்கள்',
  description:
    'ஒரு பாடல் உங்களுக்குள் எழுப்பிய நினைவை — அம்மா, தாயகம், காதல், வேர்கள் — எங்களுடன் பகிருங்கள்.',
  alternates: alternatesFor('/share'),
  robots: { index: true, follow: true },
};

export default function SharePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main" className="flex-1">
        {/* Hero — matches the site's dark/orange brand */}
        <section className="relative bg-gray-900 text-white py-16">
          <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-500/70 to-transparent" />
          <div className="container mx-auto px-4">
            <h1 className="text-3xl sm:text-5xl font-bold mb-3 font-kavivanar">உங்கள் கதை</h1>
            <p className="text-xl text-gray-300 font-tamil">
              ஒரு பாடல் உங்களுக்குள் எழுப்பிய நினைவைப் பகிருங்கள்
            </p>
          </div>
        </section>

        {/* Content */}
        <div className="bg-gray-50 py-12">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto">
              {/* Intro */}
              <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4 font-tamil">
                  உங்கள் நினைவே அடுத்த பாடல்
                </h2>
                <div className="space-y-4 text-gray-700 font-tamil text-lg">
                  <p>
                    ஒவ்வொரு பாடலுக்குப் பின்னும் ஒரு நினைவு இருக்கிறது — அம்மாவின் குரல்,
                    தாயகத்தின் மண், முதல் காதல், அல்லது உங்கள் வேர்களின் கதை. அந்த நினைவை
                    எங்களுடன் பகிருங்கள்.
                  </p>
                  <p className="text-base text-gray-500">
                    Share a memory tied to a song theme. The most touching stories may
                    inspire a future song — and, if you leave your email, you&apos;ll hear
                    about new songs first.
                  </p>
                </div>
              </section>

              {/* Form */}
              <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6 font-tamil">
                  உங்கள் கதையைப் பகிருங்கள்
                </h2>
                <StoryForm />
              </section>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
