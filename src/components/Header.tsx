'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { SITE, isYouTubeChannelConfigured, isYouTubeVideosConfigured } from '@/config/site';

const YouTubeIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const showYouTube = isYouTubeChannelConfigured();
  const showVideos = isYouTubeVideosConfigured();

  const navLinks = [
    { href: '/poems', label: 'கவிதைகள்' },
    { href: '/songs', label: 'பாடல்கள்' },
    { href: '/stories', label: 'கதைகள்' },
    { href: '/all', label: 'அனைத்தும்' },
    { href: '/music-composition', label: 'இசையமைப்பு' },
    ...(showVideos ? [{ href: '/videos', label: 'காணொளிகள்' }] : []),
  ];

  const isActive = (href: string) => !!pathname && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-gray-800 bg-gray-900/95 shadow-xl backdrop-blur-md">
      {/* Full-width nav (content spans edge to edge) */}
      <nav className="w-full px-4 sm:px-6 lg:px-10">
        <div className="flex h-20 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-3">
            <span className="font-kavivanar text-2xl font-bold tracking-tight text-orange-500 transition-colors group-hover:text-orange-400 sm:text-3xl">
              தமிழகவல்
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden items-center gap-1 md:flex lg:gap-2">
            {navLinks.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-4 py-2 font-tamil font-medium transition-all ${
                    active ? 'bg-gray-800/70 text-orange-400' : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            {showYouTube && (
              <a
                href={SITE.youtube.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 px-4 py-2 font-tamil text-sm font-bold text-white shadow-lg transition-all hover:opacity-90"
              >
                <YouTubeIcon />
                <span>{SITE.youtube.channelLabel}</span>
              </a>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="-mr-2.5 p-2.5 text-gray-300 hover:text-orange-500 md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="border-t border-gray-800 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              {navLinks.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`rounded-lg px-3 py-2.5 font-tamil transition-colors ${
                      active ? 'bg-gray-800/70 text-orange-400' : 'text-gray-300 hover:text-orange-500'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              {showYouTube && (
                <a
                  href={SITE.youtube.channelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 px-4 py-2 font-tamil text-sm text-white transition-colors hover:opacity-90"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <YouTubeIcon />
                  <span>{SITE.youtube.channelLabel}</span>
                </a>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
