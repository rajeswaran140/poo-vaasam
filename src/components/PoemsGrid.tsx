'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MagnifyingGlassIcon, FunnelIcon, SparklesIcon, HeartIcon } from '@heroicons/react/24/outline';
import { HeartIcon as HeartSolidIcon } from '@heroicons/react/24/solid';

interface PoemsGridProps {
  poems: any[]; // Accept any array of content objects from the database
}

type SortOption = 'recent' | 'popular' | 'alphabetical' | 'random';

export function PoemsGrid({ poems }: PoemsGridProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAuthor, setSelectedAuthor] = useState('all');
  const [selectedTag, setSelectedTag] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [likedPoems, setLikedPoems] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Extract unique authors and tags
  const authors = useMemo(() => {
    const authorSet = new Set(poems.map(p => p.author));
    return Array.from(authorSet).sort();
  }, [poems]);

  const tags = useMemo(() => {
    const tagMap = new Map();
    poems.forEach((p: any) => {
      p.tags?.forEach((tag: any) => {
        if (!tagMap.has(tag.id)) {
          tagMap.set(tag.id, tag);
        }
      });
    });
    return Array.from(tagMap.values());
  }, [poems]);

  // Filter and sort poems
  const filteredAndSortedPoems = useMemo(() => {
    let filtered = poems;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        p =>
          p.title.toLowerCase().includes(query) ||
          p.body.toLowerCase().includes(query) ||
          p.author.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query)
      );
    }

    // Author filter
    if (selectedAuthor !== 'all') {
      filtered = filtered.filter(p => p.author === selectedAuthor);
    }

    // Tag filter
    if (selectedTag !== 'all') {
      filtered = filtered.filter((p: any) => p.tags?.some((tag: any) => tag.id === selectedTag));
    }

    // Sort
    switch (sortBy) {
      case 'recent':
        filtered = [...filtered].sort((a, b) => {
          const dateA = new Date(a.publishedAt || a.createdAt).getTime();
          const dateB = new Date(b.publishedAt || b.createdAt).getTime();
          return dateB - dateA;
        });
        break;
      case 'popular':
        filtered = [...filtered].sort((a, b) => b.viewCount - a.viewCount);
        break;
      case 'alphabetical':
        filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title, 'ta'));
        break;
      case 'random':
        filtered = [...filtered].sort(() => Math.random() - 0.5);
        break;
    }

    return filtered;
  }, [poems, searchQuery, selectedAuthor, selectedTag, sortBy]);

  const handleLike = (poemId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLikedPoems(prev => {
      const next = new Set(prev);
      if (next.has(poemId)) {
        next.delete(poemId);
      } else {
        next.add(poemId);
      }
      return next;
    });
  };

  const getRandomPoem = () => {
    if (poems.length === 0) return;
    const randomIndex = Math.floor(Math.random() * poems.length);
    window.location.href = `/content/${poems[randomIndex].id}`;
  };

  return (
    <div className="space-y-6">
      {/* Search and Filter Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search Input */}
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="கவிதைகளைத் தேடு..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-tamil"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2.5 rounded-lg border font-tamil flex items-center gap-2 transition-colors ${
                showFilters
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <FunnelIcon className="w-5 h-5" />
              வடிகட்டி
            </button>

            <button
              onClick={getRandomPoem}
              className="px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-tamil flex items-center gap-2"
              title="சீரற்ற கவிதை"
            >
              <SparklesIcon className="w-5 h-5" />
              ஆச்சரியம்
            </button>
          </div>
        </div>

        {/* Filters Dropdown */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
            {/* Author Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 font-tamil">
                ஆசிரியர்
              </label>
              <select
                value={selectedAuthor}
                onChange={e => setSelectedAuthor(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-tamil"
              >
                <option value="all">அனைத்து ஆசிரியர்கள்</option>
                {authors.map(author => (
                  <option key={author} value={author}>
                    {author}
                  </option>
                ))}
              </select>
            </div>

            {/* Tag Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 font-tamil">
                குறிச்சொற்கள்
              </label>
              <select
                value={selectedTag}
                onChange={e => setSelectedTag(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-tamil"
              >
                <option value="all">அனைத்து குறிச்சொற்கள்</option>
                {tags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Options */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 font-tamil">
                வரிசைப்படுத்து
              </label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortOption)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-tamil"
              >
                <option value="recent">புதியவை முதலில்</option>
                <option value="popular">பிரபலமானவை</option>
                <option value="alphabetical">அகரவரிசை</option>
                <option value="random">சீரற்ற</option>
              </select>
            </div>
          </div>
        )}

        {/* Results Count */}
        <div className="mt-4 text-sm text-gray-600 font-tamil">
          மொத்தம் {filteredAndSortedPoems.length} கவிதைகள் கிடைத்தன
        </div>
      </div>

      {/* Poems Grid */}
      {filteredAndSortedPoems.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🔍</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2 font-tamil">கவிதைகள் கிடைக்கவில்லை</h2>
          <p className="text-gray-600 font-tamil">வேறு தேடல் முயற்சி செய்யவும்</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredAndSortedPoems.map(poem => (
            <Link
              key={poem.id}
              href={`/content/${poem.id}`}
              className="group flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-xl hover:border-green-300 hover:-translate-y-1 transition-all duration-300 overflow-hidden"
            >
              {/* Featured Image or Placeholder */}
              <div className="relative w-full aspect-video bg-gradient-to-br from-green-50 to-green-100 overflow-hidden">
                {poem.featuredImage ? (
                  <img
                    src={poem.featuredImage}
                    alt={poem.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-6xl mb-2 group-hover:scale-110 transition-transform duration-300">
                        📝
                      </div>
                      <p className="text-sm text-green-600 font-tamil">கவிதை</p>
                    </div>
                  </div>
                )}

                {/* Like Button Overlay */}
                <button
                  onClick={e => handleLike(poem.id, e)}
                  className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:scale-110 transition-transform duration-200 opacity-0 group-hover:opacity-100"
                  title={likedPoems.has(poem.id) ? 'விருப்பத்தை அகற்று' : 'விருப்பம்'}
                >
                  {likedPoems.has(poem.id) ? (
                    <HeartSolidIcon className="w-5 h-5 text-red-500" />
                  ) : (
                    <HeartIcon className="w-5 h-5 text-gray-700" />
                  )}
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 flex flex-col p-4 sm:p-6">
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 font-tamil mb-3 group-hover:text-green-600 transition-colors line-clamp-2">
                  {poem.title}
                </h3>

                {/* Description or Body Preview */}
                {poem.description ? (
                  <p className="text-sm sm:text-base text-gray-600 font-tamil mb-4 line-clamp-3">
                    {poem.description}
                  </p>
                ) : (
                  <div className="text-sm sm:text-base text-gray-700 font-tamil mb-4 leading-relaxed line-clamp-4">
                    {poem.body.split('\n').slice(0, 3).join('\n')}
                    {poem.body.split('\n').length > 3 && '...'}
                  </div>
                )}

                {/* Tags */}
                {poem.tags && poem.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {poem.tags.slice(0, 3).map((tag: any) => (
                      <span
                        key={tag.id}
                        className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-tamil"
                      >
                        #{tag.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Author & Meta */}
                <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs sm:text-sm text-gray-500 font-tamil">- {poem.author}</span>
                  {poem.viewCount > 0 && (
                    <span className="text-xs text-gray-400">👁️ {poem.viewCount}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
