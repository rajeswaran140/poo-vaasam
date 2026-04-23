'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
      <nav className="container mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl font-bold text-orange-500 font-kavivanar">தமிழகவல்</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/poems" className="text-gray-300 hover:text-orange-500 transition-colors font-tamil">
              கவிதைகள்
            </Link>
            <Link href="/songs" className="text-gray-300 hover:text-orange-500 transition-colors font-tamil">
              பாடல்கள்
            </Link>
            <Link href="/stories" className="text-gray-300 hover:text-orange-500 transition-colors font-tamil">
              கதைகள்
            </Link>
            <Link href="/all" className="text-gray-300 hover:text-orange-500 transition-colors font-tamil">
              அனைத்தும்
            </Link>
            <Link
              href="/admin"
              className="px-4 py-2 bg-orange-500 text-white rounded-full hover:bg-orange-600 transition-colors font-tamil text-sm"
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
