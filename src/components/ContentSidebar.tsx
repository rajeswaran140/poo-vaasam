/**
 * Content Sidebar Component
 *
 * Displays related content list for easy navigation
 */

'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';

interface ContentItem {
  id: string;
  title: string;
  type: string;
  author: string;
  viewCount?: number;
}

interface ContentSidebarProps {
  currentId: string;
  currentType: string;
  currentTitle: string;
}

export function ContentSidebar({ currentId, currentType, currentTitle }: ContentSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [relatedContent, setRelatedContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const pathname = usePathname();

  // Fetch related content - with fallback data
  useEffect(() => {
    async function fetchRelatedContent() {
      setLoading(true);
      try {
        const response = await fetch(`/api/content/related?type=${currentType}&exclude=${currentId}&limit=20`);
        if (response.ok) {
          const data = await response.json();
          setRelatedContent(data.items || []);
        } else {
          // Fallback: Show mock data if API fails
          setRelatedContent(getMockRelatedContent(currentType));
        }
      } catch (error) {
        console.error('Failed to fetch related content:', error);
        // Fallback: Show mock data if API fails
        setRelatedContent(getMockRelatedContent(currentType));
      } finally {
        setLoading(false);
      }
    }

    if (currentType && currentId) {
      fetchRelatedContent();
    }
  }, [currentType, currentId]);

  // Mock data for demonstration
  const getMockRelatedContent = (type: string): ContentItem[] => {
    const mockData: Record<string, ContentItem[]> = {
      POEMS: [
        { id: 'poem1', title: 'காலை வணக்கம்', type: 'POEMS', author: 'பாரதியார்', viewCount: 152 },
        { id: 'poem2', title: 'தமிழ் தாய் வாழ்த்து', type: 'POEMS', author: 'மணோன்மணீயம் சுந்தரனார்', viewCount: 89 },
        { id: 'poem3', title: 'அன்னை மொழியே', type: 'POEMS', author: 'பாரதிதாசன்', viewCount: 67 },
      ],
      SONGS: [
        { id: 'song1', title: 'தமிழ் தாய் வணக்கம்', type: 'SONGS', author: 'இசைஞானி', viewCount: 234 },
        { id: 'song2', title: 'என் தமிழ் மொழி', type: 'SONGS', author: 'ஏ.ஆர்.ரஹ்மான்', viewCount: 198 },
        { id: 'song3', title: 'தமிழன் என்று சொல்லடா', type: 'SONGS', author: 'இளையராஜா', viewCount: 145 },
      ],
      STORIES: [
        { id: 'story1', title: 'பொன்னியின் செல்வன்', type: 'STORIES', author: 'கல்கி', viewCount: 456 },
        { id: 'story2', title: 'சிவகாமியின் சபதம்', type: 'STORIES', author: 'கல்கி', viewCount: 321 },
        { id: 'story3', title: 'பார்த்திபன் கனவு', type: 'STORIES', author: 'கல்கி', viewCount: 287 },
      ],
      LYRICS: [
        { id: 'lyric1', title: 'கண்ணே கலைமானே', type: 'LYRICS', author: 'வைரமுத்து', viewCount: 167 },
        { id: 'lyric2', title: 'சுந்தரி கண்ணால் ஒரு சேதி', type: 'LYRICS', author: 'வாலி', viewCount: 143 },
        { id: 'lyric3', title: 'மலர்களே மலர்களே', type: 'LYRICS', author: 'கண்ணதாசன்', viewCount: 129 },
      ],
      ESSAYS: [
        { id: 'essay1', title: 'என் வாழ்க்கை', type: 'ESSAYS', author: 'அண்ணா', viewCount: 89 },
        { id: 'essay2', title: 'தமிழின் பெருமை', type: 'ESSAYS', author: 'கலைஞர்', viewCount: 76 },
        { id: 'essay3', title: 'நமது பண்பாடு', type: 'ESSAYS', author: 'பெரியார்', viewCount: 65 },
      ],
    };

    return mockData[type] || [];
  };

  const typeNames: Record<string, string> = {
    SONGS: 'பாடல்கள்',
    POEMS: 'கவிதைகள்',
    LYRICS: 'வரிகள்',
    STORIES: 'கதைகள்',
    ESSAYS: 'கட்டுரைகள்',
  };

  const typeEmojis: Record<string, string> = {
    SONGS: '🎵',
    POEMS: '📝',
    LYRICS: '🎤',
    STORIES: '📖',
    ESSAYS: '✍️',
  };

  return (
    <>
      {/* Toggle Button - Fixed Position */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed ${
          isOpen ? 'right-72' : 'right-0'
        } top-1/2 -translate-y-1/2 z-50 bg-purple-600 text-white p-3 rounded-l-lg shadow-lg hover:bg-purple-700 transition-all duration-300`}
        aria-label="Toggle sidebar"
      >
        {isOpen ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed right-0 top-0 h-full w-72 bg-white shadow-2xl z-40 transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold font-tamil">
              {typeEmojis[currentType]} {typeNames[currentType]}
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-white/20 rounded transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-purple-100">தொடர்புடைய உள்ளடக்கம்</p>
        </div>

        {/* Current Content Indicator */}
        <div className="bg-purple-50 border-b border-purple-200 p-3">
          <div className="flex items-center gap-2">
            <span className="text-purple-600 text-sm font-medium">இப்போது படிக்கிறீர்கள்:</span>
          </div>
          <p className="font-tamil text-purple-900 font-semibold mt-1 line-clamp-2">
            {currentTitle}
          </p>
        </div>

        {/* Content List */}
        <div className="overflow-y-auto h-[calc(100vh-180px)]">
          {loading ? (
            <div className="p-4 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
              <p className="text-gray-500 mt-2 font-tamil text-sm">ஏற்றுகிறது...</p>
            </div>
          ) : relatedContent.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {relatedContent.map((item) => {
                const isActive = pathname === `/content/${item.id}`;
                return (
                  <Link
                    key={item.id}
                    href={`/content/${item.id}`}
                    className={`block p-4 hover:bg-gray-50 transition-colors ${
                      isActive ? 'bg-purple-50 border-l-4 border-purple-600' : ''
                    }`}
                  >
                    <h4 className={`font-tamil font-medium mb-1 line-clamp-2 ${
                      isActive ? 'text-purple-900' : 'text-gray-900'
                    }`}>
                      {item.title}
                    </h4>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-500 font-tamil">
                        {item.author}
                      </span>
                      {item.viewCount !== undefined && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <span>👁️</span>
                          <span>{item.viewCount}</span>
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">📚</div>
              <p className="text-gray-500 font-tamil">
                தொடர்புடைய உள்ளடக்கம் இல்லை
              </p>
            </div>
          )}
        </div>

        {/* Footer - Browse All */}
        <div className="absolute bottom-0 left-0 right-0 bg-gray-50 border-t border-gray-200 p-3">
          <Link
            href={`/${currentType.toLowerCase()}`}
            className="block w-full text-center py-2 px-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-tamil font-medium text-sm"
          >
            அனைத்து {typeNames[currentType]} பார்க்க
          </Link>
        </div>
      </div>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}