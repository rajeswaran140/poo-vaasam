'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900/98 backdrop-blur-lg border-b border-gray-800/50 shadow-xl">
      <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo with Free Badge */}
          <Link href="/" className="flex items-center gap-3 group">
            <span className="text-2xl sm:text-3xl font-bold text-orange-500 font-kavivanar group-hover:text-orange-400 transition-colors">
              தமிழகவல்
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 bg-orange-500/20 border border-orange-500/30 text-orange-400 rounded-full text-xs font-bold font-tamil">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              இலவசம்
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
