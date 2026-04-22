/**
 * முகப்பு பக்கம் - பொது
 * தமிழ் உள்ளடக்கத்துடன் அம்சமான தரவு பக்கம்
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus, ContentType } from '@/types/content';

async function getFeaturedContent() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findAll({
      limit: 6,
      status: ContentStatus.PUBLISHED
    });
    return result.items.map(item => item.toObject());
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return [];
  }
}

async function getStats() {
  try {
    const repo = new ContentRepository();
    const [songs, poems, lyrics, stories, essays, published] = await Promise.all([
      repo.countByType(ContentType.SONGS),
      repo.countByType(ContentType.POEMS),
      repo.countByType(ContentType.LYRICS),
      repo.countByType(ContentType.STORIES),
      repo.countByType(ContentType.ESSAYS),
      repo.countByStatus(ContentStatus.PUBLISHED),
    ]);

    return {
      songs,
      poems,
      lyrics,
      stories,
      essays,
      published,
    };
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return null;
  }
}

export default async function HomePage() {
  const [featuredContent, stats] = await Promise.all([
    getFeaturedContent(),
    getStats()
  ]);

  const totalContent = (stats?.published || 0);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section - Audible Style */}
      <section className="relative overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
            backgroundSize: '32px 32px'
          }}></div>
        </div>

        <div className="container mx-auto px-4 sm:px-6 py-16 sm:py-20 lg:py-24 relative z-10">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              {/* Left Content */}
              <div className="text-center lg:text-left">
                <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mb-6">
                  <span className="text-2xl">✨</span>
                  <span className="font-semibold font-tamil">முற்றிலும் இலவசம்</span>
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 font-kavivanar leading-tight">
                  தமிழகவல்
                </h1>

                <p className="text-xl sm:text-2xl mb-4 text-orange-50 font-tamil leading-relaxed">
                  படியுங்கள். கேளுங்கள். அனுபவியுங்கள்.
                </p>

                <p className="text-base sm:text-lg mb-8 text-orange-100 font-tamil leading-relaxed max-w-xl">
                  தமிழ் இலக்கியத்தின் எல்லையற்ற உலகத்தை இலவசமாக அனுபவியுங்கள். பாடல்கள், கவிதைகள், கதைகள் - எல்லாமே இலவசம்.
                </p>

                {/* Free Features */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                  <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-lg p-4">
                    <span className="text-3xl">📖</span>
                    <div className="text-left">
                      <div className="font-bold font-tamil">இலவச வாசிப்பு</div>
                      <div className="text-sm text-orange-100 font-tamil">வரம்பற்ற அணுகல்</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-lg p-4">
                    <span className="text-3xl">🎧</span>
                    <div className="text-left">
                      <div className="font-bold font-tamil">இலவச கேட்டல்</div>
                      <div className="text-sm text-orange-100 font-tamil">ஆடியோ உள்ளடக்கம்</div>
                    </div>
                  </div>
                </div>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row justify-center lg:justify-start gap-4">
                  <Link
                    href="/poems"
                    className="group px-8 py-4 bg-white text-orange-600 rounded-full font-bold hover:bg-orange-50 transition-all shadow-2xl hover:shadow-3xl transform hover:scale-105 font-tamil inline-flex items-center justify-center gap-2"
                  >
                    <span>📝</span>
                    <span>கவிதைகளை ஆரம்பிக்கவும்</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </Link>
                  <Link
                    href="/songs"
                    className="px-8 py-4 bg-orange-500/30 backdrop-blur-sm text-white border-2 border-white/50 rounded-full font-bold hover:bg-white/20 transition-all hover:border-white transform hover:scale-105 font-tamil inline-flex items-center justify-center gap-2"
                  >
                    <span>🎵</span>
                    <span>பாடல்களை கண்டறியவும்</span>
                  </Link>
                </div>

                {/* Free Badge */}
                <div className="mt-8 inline-flex items-center gap-2 text-orange-100">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="font-tamil text-sm">கிரெடிட் கார்டு தேவையில்லை • எந்த கட்டணமும் இல்லை • எப்போதும் இலவசம்</span>
                </div>
              </div>

              {/* Right Content - Stats & Visual */}
              <div className="hidden lg:block">
                <div className="relative">
                  {/* Stats Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl transform hover:scale-105 transition-transform">
                      <div className="text-5xl mb-2">📚</div>
                      <div className="text-4xl font-bold text-orange-600">{totalContent}</div>
                      <div className="text-gray-600 font-tamil text-sm">மொத்த உள்ளடக்கம்</div>
                    </div>
                    <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl transform hover:scale-105 transition-transform">
                      <div className="text-5xl mb-2">🎵</div>
                      <div className="text-4xl font-bold text-blue-600">{stats?.songs || 0}</div>
                      <div className="text-gray-600 font-tamil text-sm">பாடல்கள்</div>
                    </div>
                    <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl transform hover:scale-105 transition-transform">
                      <div className="text-5xl mb-2">📝</div>
                      <div className="text-4xl font-bold text-green-600">{stats?.poems || 0}</div>
                      <div className="text-gray-600 font-tamil text-sm">கவிதைகள்</div>
                    </div>
                    <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl transform hover:scale-105 transition-transform">
                      <div className="text-5xl mb-2">📖</div>
                      <div className="text-4xl font-bold text-pink-600">{stats?.stories || 0}</div>
                      <div className="text-gray-600 font-tamil text-sm">கதைகள்</div>
                    </div>
                  </div>

                  {/* Floating Badge */}
                  <div className="absolute -top-4 -right-4 bg-gradient-to-br from-yellow-400 to-orange-500 text-white px-6 py-3 rounded-full shadow-2xl transform rotate-12 animate-pulse">
                    <div className="font-bold text-lg font-tamil">100% இலவசம்!</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Wave Separator */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0L60 10C120 20 240 40 360 46.7C480 53 600 47 720 43.3C840 40 960 40 1080 46.7C1200 53 1320 67 1380 73.3L1440 80V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0V0Z" fill="white"/>
          </svg>
        </div>
      </section>

      {/* Why Choose Section - Free Features */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 font-tamil">
              ஏன் தமிழகவல்?
            </h2>
            <p className="text-lg text-gray-600 font-tamil max-w-2xl mx-auto">
              முற்றிலும் இலவசமாக தமிழ் இலக்கியத்தை படிக்கவும், கேட்கவும் ஆரம்பிக்கவும்
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            {/* Feature 1: Free Reading */}
            <div className="text-center p-8 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl hover:shadow-xl transition-shadow">
              <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <span className="text-4xl">📖</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3 font-tamil">
                வரம்பற்ற வாசிப்பு
              </h3>
              <p className="text-gray-600 font-tamil leading-relaxed">
                எல்லா உள்ளடக்கங்களையும் இலவசமாக படியுங்கள். எந்த வரம்பும் இல்லை, எந்த கட்டணமும் இல்லை.
              </p>
            </div>

            {/* Feature 2: Free Audio */}
            <div className="text-center p-8 bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl hover:shadow-xl transition-shadow">
              <div className="w-20 h-20 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <span className="text-4xl">🎧</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3 font-tamil">
                இலவச ஆடியோ
              </h3>
              <p className="text-gray-600 font-tamil leading-relaxed">
                உங்கள் பிடித்த கவிதைகளையும் பாடல்களையும் கேளுங்கள். எங்கு வேண்டுமானாலும், எப்போது வேண்டுமானாலும்.
              </p>
            </div>

            {/* Feature 3: No Ads */}
            <div className="text-center p-8 bg-gradient-to-br from-green-50 to-green-100 rounded-2xl hover:shadow-xl transition-shadow">
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <span className="text-4xl">✨</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3 font-tamil">
                விளம்பரங்கள் இல்லை
              </h3>
              <p className="text-gray-600 font-tamil leading-relaxed">
                தடையற்ற அனுபவம். விளம்பரங்கள் இல்லாமல், உங்கள் வாசிப்பில் கவனம் செலுத்துங்கள்.
              </p>
            </div>
          </div>

          {/* Additional Benefits */}
          <div className="bg-gradient-to-r from-purple-100 to-pink-100 rounded-2xl p-8 md:p-12">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil">எந்த பதிவும் தேவையில்லை</h4>
                  <p className="text-gray-700 text-sm font-tamil">உடனடியாக படிக்க ஆரம்பியுங்கள்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil">மொபைல் நட்பு</h4>
                  <p className="text-gray-700 text-sm font-tamil">எந்த சாதனத்திலும் படிக்கவும் கேட்கவும்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil">தரமான உள்ளடக்கம்</h4>
                  <p className="text-gray-700 text-sm font-tamil">கவனமாக தேர்ந்தெடுக்கப்பட்ட இலக்கியம்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil">தொடர்ச்சியான புதுப்பிப்புகள்</h4>
                  <p className="text-gray-700 text-sm font-tamil">வாரம் தோறும் புதிய உள்ளடக்கம்</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* உள்ளடக்க வகைகள் பகுதி */}
      <section className="container mx-auto px-4 py-16 bg-gray-50">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-gray-900 mb-4 font-tamil">
          உள்ளடக்க தொகுப்புகள்
        </h2>
        <p className="text-center text-gray-600 font-tamil mb-12 max-w-2xl mx-auto">
          எல்லா வகையான தமிழ் இலக்கியங்களையும் கண்டறியுங்கள்
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 max-w-6xl mx-auto">
          <ContentTypeCard
            icon="🎵"
            title="பாடல்கள்"
            count={stats?.songs || 0}
            href="/songs"
            color="from-blue-500 to-blue-600"
          />
          <ContentTypeCard
            icon="📝"
            title="கவிதைகள்"
            count={stats?.poems || 0}
            href="/poems"
            color="from-green-500 to-green-600"
          />
          <ContentTypeCard
            icon="🎤"
            title="பாடல் வரிகள்"
            count={stats?.lyrics || 0}
            href="/lyrics"
            color="from-yellow-500 to-yellow-600"
          />
          <ContentTypeCard
            icon="📖"
            title="கதைகள்"
            count={stats?.stories || 0}
            href="/stories"
            color="from-pink-500 to-pink-600"
          />
          <ContentTypeCard
            icon="✍️"
            title="கட்டுரைகள்"
            count={stats?.essays || 0}
            href="/essays"
            color="from-purple-500 to-purple-600"
          />
        </div>
      </section>

      {/* சமீபத்திய உள்ளடக்கம் */}
      {featuredContent.length > 0 && (
        <section className="container mx-auto px-4 py-20 bg-white">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 font-tamil">
                சமீபத்திய உள்ளடக்கம்
              </h2>
              <p className="text-lg text-gray-600 font-tamil">
                புதிதாக சேர்க்கப்பட்ட கவிதைகள், பாடல்கள் மற்றும் கதைகள்
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {featuredContent.map((content: any) => (
                <ContentCard key={content.id} content={content} />
              ))}
            </div>
            <div className="text-center">
              <Link
                href="/all"
                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-full font-bold hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 font-tamil"
              >
                <span>எல்லா உள்ளடக்கத்தையும் காண்க</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* அடிக்குறிப்பு */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-2xl font-bold mb-4 font-kavivanar">தமிழகவல்</h3>
              <p className="text-gray-400 font-tamil">
                தமிழ் இலக்கியத்தை பாதுகாக்கும் மற்றும் பரப்பும் தளம்
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4 font-tamil">விரைவு இணைப்புகள்</h4>
              <ul className="space-y-2 text-gray-400">
                <li><Link href="/songs" className="hover:text-white font-tamil">பாடல்கள்</Link></li>
                <li><Link href="/poems" className="hover:text-white font-tamil">கவிதைகள்</Link></li>
                <li><Link href="/stories" className="hover:text-white font-tamil">கதைகள்</Link></li>
                <li><Link href="/all" className="hover:text-white font-tamil">அனைத்து உள்ளடக்கம்</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 font-tamil">பற்றி</h4>
              <ul className="space-y-2 text-gray-400">
                <li><Link href="/about" className="hover:text-white font-tamil">எங்களை பற்றி</Link></li>
                <li><Link href="/contact" className="hover:text-white font-tamil">தொடர்பு</Link></li>
                <li><Link href="/admin" className="hover:text-white font-tamil">நிர்வாகம்</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p className="font-tamil">© 2026 தமிழகவல். தமிழ் இலக்கியத்திற்காக அன்புடன் உருவாக்கப்பட்டது.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

interface ContentTypeCardProps {
  icon: string;
  title: string;
  count: number;
  href: string;
  color: string;
}

function ContentTypeCard({ icon, title, count, href, color }: ContentTypeCardProps) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-xl bg-white shadow-lg hover:shadow-2xl transition-all transform hover:scale-105"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-100 transition-opacity`}></div>
      <div className="relative p-6 text-center">
        <div className="text-5xl mb-3">{icon}</div>
        <h3 className="text-xl font-bold text-gray-900 group-hover:text-white transition-colors font-tamil">
          {title}
        </h3>
        <div className="mt-4 text-3xl font-bold text-purple-600 group-hover:text-white transition-colors">
          {count}
        </div>
      </div>
    </Link>
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
      href={`/content/${content.id}`}
      className="group bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden hover:shadow-2xl hover:border-orange-300 transition-all transform hover:scale-[1.03]"
    >
      {/* Featured Image or Gradient */}
      {content.featuredImage ? (
        <div className="relative h-48 overflow-hidden">
          <img
            src={content.featuredImage}
            alt={content.title}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
          />
          <div className="absolute top-3 right-3 flex gap-2">
            {content.audioUrl && (
              <span className="px-3 py-1 bg-orange-500 text-white text-xs font-bold rounded-full shadow-lg flex items-center gap-1">
                <span>🎧</span>
                <span className="font-tamil">ஆடியோ</span>
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="h-48 bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center relative">
          <div className="text-center">
            <div className="text-6xl mb-2">{content.type === 'POEMS' ? '📝' : content.type === 'SONGS' ? '🎵' : '📖'}</div>
          </div>
          {content.audioUrl && (
            <span className="absolute top-3 right-3 px-3 py-1 bg-orange-500 text-white text-xs font-bold rounded-full shadow-lg flex items-center gap-1">
              <span>🎧</span>
              <span className="font-tamil">ஆடியோ</span>
            </span>
          )}
        </div>
      )}

      <div className="p-6">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-xl font-bold text-gray-900 font-tamil group-hover:text-orange-600 transition-colors line-clamp-2 flex-1">
            {content.title}
          </h3>
          <span className={`px-2 py-1 text-xs font-semibold rounded-full font-tamil ml-2 flex-shrink-0 ${typeColors[content.type]}`}>
            {typeNames[content.type]}
          </span>
        </div>
        <p className="text-gray-600 font-tamil text-sm line-clamp-3 mb-4 leading-relaxed">
          {content.description || content.body?.substring(0, 120)}
        </p>
        <div className="flex items-center justify-between text-sm pt-4 border-t border-gray-100">
          <span className="text-gray-500 font-tamil">
            {content.author}
          </span>
          <span className="text-orange-600 group-hover:text-orange-700 font-bold font-tamil inline-flex items-center gap-1">
            <span>{content.audioUrl ? 'கேளுங்கள்' : 'படியுங்கள்'}</span>
            <span>→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
