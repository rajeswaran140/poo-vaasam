/**
 * AI-Powered Semantic Search Page
 */

import Link from 'next/link';
import { SemanticSearch } from '@/components/SemanticSearch';

export const metadata = {
  title: 'AI தேடல் | தமிழகவல்',
  description: 'செயற்கை நுண்ணறிவு இயக்கப்பட்ட தேடல் மூலம் தமிழ் உள்ளடக்கத்தை கண்டுபிடியுங்கள்',
};

export default function AISearchPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-white">
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-600 via-pink-600 to-purple-700 text-white py-16">
        <div className="container mx-auto px-4">
          <Link
            href="/"
            className="text-purple-100 hover:text-white mb-6 inline-flex items-center gap-2 font-tamil transition-colors group"
          >
            <span className="group-hover:-translate-x-1 transition-transform">←</span>
            <span>முகப்புக்குத் திரும்பு</span>
          </Link>
          <div className="flex items-center gap-4 mb-4">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold font-poem">
              🔍 AI தேடல்
            </h1>
          </div>
          <p className="text-xl text-purple-100 font-tamil leading-relaxed max-w-3xl">
            செயற்கை நுண்ணறிவு மூலம் உள்ளடக்கத்தை அர்த்தத்தின் அடிப்படையில் கண்டுபிடியுங்கள்
          </p>

          {/* Features */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-2xl mb-2">🧠</div>
              <p className="text-sm font-tamil">அர்த்தம் அடிப்படையிலான தேடல்</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-2xl mb-2">⚡</div>
              <p className="text-sm font-tamil">வேகமான முடிவுகள்</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-2xl mb-2">🎯</div>
              <p className="text-sm font-tamil">துல்லியமான பொருத்தம்</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <SemanticSearch />

        {/* Info Section */}
        <div className="mt-16 max-w-4xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-purple-100 p-8">
            <h2 className="text-2xl font-bold font-tamil text-gray-900 mb-4">
              AI தேடல் எப்படி வேலை செய்கிறது?
            </h2>
            <div className="space-y-4 text-gray-700 font-tamil">
              <p>
                பாரம்பரிய தேடல்கள் சரியான வார்த்தைகளை மட்டுமே தேடுகின்றன. ஆனால் AI தேடல் உங்கள் கேள்வியின் அர்த்தத்தை புரிந்துகொண்டு தொடர்புடைய உள்ளடக்கத்தை கண்டுபிடிக்கிறது.
              </p>
              <p>
                <strong>உதாரணம்:</strong> &ldquo;காதல் பற்றிய கவிதைகள்&rdquo; என்று தேடினால், &ldquo;காதல்&rdquo;, &ldquo;அன்பு&rdquo;, &ldquo;காதலன்&rdquo;, &ldquo;காதலி&rdquo; போன்ற சொற்கள் உள்ள அனைத்து கவிதைகளையும் கண்டுபிடிக்கும்.
              </p>
              <p className="text-sm text-gray-600">
                <strong>தொழில்நுட்பம்:</strong> OpenAI Embeddings API
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
