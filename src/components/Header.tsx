'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { SITE, isYouTubeChannelConfigured, isYouTubeVideosConfigured } from '@/config/site';

const YouTubeIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const Chevron = ({ className = '' }: { className?: string }) => (
  <svg className={`h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

// Content-type pages, grouped under a single "படைப்புகள்" menu.
const BROWSE_LINKS = [
  { href: '/poems', label: 'கவிதைகள்' },
  { href: '/songs', label: 'பாடல்கள்' },
  { href: '/lyrics', label: 'பாடல் வரிகள்' },
  { href: '/stories', label: 'கதைகள்' },
  { href: '/essays', label: 'கட்டுரைகள்' },
  { href: '/all', label: 'அனைத்தும்' },
];

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const showYouTube = isYouTubeChannelConfigured();
  const showVideos = isYouTubeVideosConfigured();

  // Distinct, non-content-type destinations stay at the top level.
  const topLinks = [
    { href: '/music-composition', label: 'இசையமைப்பு' },
    ...(showVideos ? [{ href: '/videos', label: 'காணொளிகள்' }] : []),
  ];

  const isActive = (href: string) => !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
  const browseActive = BROWSE_LINKS.some((l) => isActive(l.href));
  const close = () => setMobileMenuOpen(false);

  // Lock background scroll + close on Escape while the mobile menu is open.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileMenuOpen]);

  // Auto-close the menu on navigation.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const mobileLinkClass = (active: boolean) =>
    `rounded-lg font-tamil transition-colors ${active ? 'bg-gray-800/70 text-orange-400' : 'text-gray-300 hover:text-orange-500'}`;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-gray-800 bg-gray-900/95 shadow-xl backdrop-blur-md">
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
            {/* Browse dropdown */}
            <div className="group relative">
              <button
                type="button"
                aria-haspopup="true"
                aria-current={browseActive ? 'page' : undefined}
                className={`inline-flex items-center gap-1 rounded-lg px-4 py-2 font-tamil font-medium transition-all ${
                  browseActive ? 'bg-gray-800/70 text-orange-400' : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
                }`}
              >
                படைப்புகள்
                <Chevron className="transition-transform group-hover:rotate-180" />
              </button>
              <div className="absolute left-0 top-full hidden pt-2 group-hover:block group-focus-within:block">
                <div className="min-w-[12rem] rounded-xl border border-gray-800 bg-gray-900/95 p-1.5 shadow-2xl backdrop-blur-md">
                  {BROWSE_LINKS.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`block rounded-lg px-3 py-2 font-tamil transition-colors ${
                          active ? 'bg-gray-800 text-orange-400' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>

            {topLinks.map((item) => {
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
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
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

        {/* Mobile Menu — dimmed backdrop + scrollable panel */}
        {mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 top-20 z-40 bg-black/60 md:hidden"
              onClick={close}
              aria-hidden="true"
            />
            <div
              id="mobile-menu"
              className="relative z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain border-t border-gray-800 bg-gray-900 py-4 md:hidden"
            >
              <div className="flex flex-col gap-1">
                <p className="px-3 pt-1 font-tamil text-xs font-semibold uppercase tracking-wide text-gray-500">படைப்புகள்</p>
                {BROWSE_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    onClick={close}
                    className={`py-2.5 pl-5 pr-3 ${mobileLinkClass(isActive(item.href))}`}
                  >
                    {item.label}
                  </Link>
                ))}

                <div className="my-1 border-t border-gray-800/60" />

                {topLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    onClick={close}
                    className={`px-3 py-2.5 ${mobileLinkClass(isActive(item.href))}`}
                  >
                    {item.label}
                  </Link>
                ))}

                {showYouTube && (
                  <a
                    href={SITE.youtube.channelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 px-4 py-2 font-tamil text-sm text-white transition-colors hover:opacity-90"
                    onClick={close}
                  >
                    <YouTubeIcon />
                    <span>{SITE.youtube.channelLabel}</span>
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </nav>
    </header>
  );
}
