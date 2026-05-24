'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SITE, isYouTubeChannelConfigured } from '@/config/site';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const showYouTube = isYouTubeChannelConfigured();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 shadow-xl">
      <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <span className="text-2xl sm:text-3xl font-bold text-orange-500 font-kavivanar group-hover:text-orange-400 transition-colors">
              தமிழகவல்
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1 lg:gap-2">
            <Link href="/poems" className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-800/50 rounded-lg transition-all font-tamil font-medium">
              கவிதைகள்
            </Link>
            <Link href="/songs" className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-800/50 rounded-lg transition-all font-tamil font-medium">
              பாடல்கள்
            </Link>
            <Link href="/stories" className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-800/50 rounded-lg transition-all font-tamil font-medium">
              கதைகள்
            </Link>
            <Link href="/all" className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-800/50 rounded-lg transition-all font-tamil font-medium">
              அனைத்தும்
            </Link>
            {showYouTube && (
              <a
                href={SITE.youtube.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 px-4 py-2 inline-flex items-center gap-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-all font-tamil text-sm font-bold shadow-lg"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
                <span>{SITE.youtube.channelLabel}</span>
              </a>
            )}
            <Link
              href="/admin"
              className="ml-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-full hover:from-orange-600 hover:to-orange-700 transition-all font-tamil text-sm font-bold shadow-lg hover:shadow-xl transform hover:scale-105"
            >
              நிர்வாகம்
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-gray-300 hover:text-orange-500"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-gray-800">
            <div className="flex flex-col gap-4">
              <Link
                href="/poems"
                className="text-gray-300 hover:text-orange-500 transition-colors font-tamil"
                onClick={() => setMobileMenuOpen(false)}
              >
                கவிதைகள்
              </Link>
              <Link
                href="/songs"
                className="text-gray-300 hover:text-orange-500 transition-colors font-tamil"
                onClick={() => setMobileMenuOpen(false)}
              >
                பாடல்கள்
              </Link>
              <Link
                href="/stories"
                className="text-gray-300 hover:text-orange-500 transition-colors font-tamil"
                onClick={() => setMobileMenuOpen(false)}
              >
                கதைகள்
              </Link>
              <Link
                href="/all"
                className="text-gray-300 hover:text-orange-500 transition-colors font-tamil"
                onClick={() => setMobileMenuOpen(false)}
              >
                அனைத்தும்
              </Link>
              {showYouTube && (
                <a
                  href={SITE.youtube.channelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors font-tamil text-sm inline-flex items-center justify-center gap-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                  <span>{SITE.youtube.channelLabel}</span>
                </a>
              )}
              <Link
                href="/admin"
                className="px-4 py-2 bg-orange-500 text-white rounded-full hover:bg-orange-600 transition-colors font-tamil text-sm inline-block text-center"
                onClick={() => setMobileMenuOpen(false)}
              >
                நிர்வாகம்
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
