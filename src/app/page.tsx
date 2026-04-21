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
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
      {/* தலைப்பு பகுதி */}
      <section className="relative overflow-hidden bg-gradient-to-r from-purple-600 via-purple-700 to-purple-800 text-white">
        <div className="container mx-auto px-4 py-20 relative">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-6xl font-bold mb-6 font-kavivanar leading-tight">
              தமிழகவல்
            </h1>
            <p className="text-2xl mb-4 text-purple-100 font-tamil">
              தமிழ் இலக்கிய தளம்
            </p>
            <p className="text-xl mb-8 text-purple-200 font-tamil">
              பாடல்கள், கவிதைகள், கதைகள் மற்றும் பல
            </p>
            <div className="flex justify-center gap-4 mb-12">
              <Link
                href="/songs"
                className="px-8 py-4 bg-white text-purple-700 rounded-xl font-semibold hover:bg-purple-50 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 font-tamil"
              >
                🎵 பாடல்கள்
              </Link>
              <Link
                href="/poems"
                className="px-8 py-4 bg-purple-500 text-white rounded-xl font-semibold hover:bg-purple-400 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 font-tamil"
              >
                📝 கவிதைகள்
              </Link>
            </div>

            {/* புள்ளிவிவரங்கள் */}
            <div className="flex justify-center gap-8 mt-12">
              <div className="text-center">
                <div className="text-4xl font-bold">{totalContent}</div>
                <div className="text-purple-200 text-sm font-tamil">மொத்த உள்ளடக்கம்</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold">{stats?.songs || 0}</div>
                <div className="text-purple-200 text-sm font-tamil">பாடல்கள்</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold">{stats?.poems || 0}</div>
                <div className="text-purple-200 text-sm font-tamil">கவிதைகள்</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* உள்ளடக்க வகைகள் பகுதி */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12 font-tamil">
          உள்ளடக்க வகைகள்
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
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
        <section className="container mx-auto px-4 py-16 bg-white">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold text-gray-900 font-tamil">
              சமீபத்திய உள்ளடக்கம்
            </h2>
            <Link
              href="/all"
              className="text-purple-600 hover:text-purple-700 font-medium font-tamil"
            >
              அனைத்தையும் காண்க →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredContent.map((content: any) => (
              <ContentCard key={content.id} content={content} />
            ))}
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
      className="group bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-all transform hover:scale-[1.02]"
    >
      <div className="p-6">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-xl font-bold text-gray-900 font-tamil group-hover:text-purple-600 transition-colors">
            {content.title}
          </h3>
          <span className={`px-2 py-1 text-xs font-semibold rounded-full font-tamil ${typeColors[content.type]}`}>
            {typeNames[content.type]}
          </span>
        </div>
        <p className="text-gray-600 font-tamil text-sm line-clamp-2 mb-4">
          {content.description || content.body?.substring(0, 100)}
        </p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 font-tamil">
            {content.author}
          </span>
          <span className="text-purple-600 group-hover:text-purple-700 font-medium font-tamil">
            மேலும் படிக்க →
          </span>
        </div>
      </div>
    </Link>
  );
}
