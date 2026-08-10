'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { StudioCta } from '@/components/StudioCta';
import { SITE, CONTENT_SECTIONS, isYouTubeChannelConfigured, isYouTubeVideosConfigured } from '@/config/site';

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

type NavLink = { href: string; label: string };
type NavItem = NavLink | { label: string; children: NavLink[] };

const hasChildren = (item: NavItem): item is { label: string; children: NavLink[] } =>
  'children' in item;

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const showYouTube = isYouTubeChannelConfigured();
  const showVideos = isYouTubeVideosConfigured();

  // Exactly FOUR primary nav items; related destinations are grouped into the
  // two dropdowns so the top bar stays uncluttered. Driven by the shared section
  // registry (songs/poems lead; empty sections stay hidden) + the video toggle.
  const navItems: NavItem[] = [
    {
      label: 'படைப்புகள்',
      children: [
        ...CONTENT_SECTIONS.filter((s) => s.live).map((s) => ({ href: s.href, label: s.label })),
        { href: '/lyrics', label: 'பாடல் வரிகள்' },
        ...(showVideos ? [{ href: '/videos', label: 'காணொளிகள்' }] : []),
        { href: '/all', label: 'அனைத்தும்' },
      ],
    },
    {
      label: 'சமூகம்',
      children: [
        { href: '/share', label: 'உங்கள் கதை' },
        { href: '/support', label: 'ஆதரவு' },
        { href: '/status', label: 'Status பகிருங்கள்' },
      ],
    },
    { href: '/music-composition', label: 'இசையமைப்பு' },
    { href: '/about', label: 'பற்றி' },
  ];

  const isActive = (href: string) => !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
  const groupActive = (children: NavLink[]) => children.some((c) => isActive(c.href));
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
      {/* Skip link — first focusable element; lets keyboard users bypass the nav
          (WCAG 2.4.1). Visually hidden until focused; targets the page's <main id="main">. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-orange-600 focus:px-4 focus:py-2 focus:font-tamil focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
      >
        உள்ளடக்கத்திற்கு செல்
      </a>
      <nav className="w-full px-4 sm:px-6 lg:px-10">
        <div className="flex h-20 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-3">
            <span className="font-kavivanar text-2xl font-bold tracking-tight text-orange-500 transition-colors group-hover:text-orange-400 sm:text-3xl">
              தமிழகவல்
            </span>
          </Link>

          {/* Desktop Navigation — four primary items (two dropdowns, two links),
              plus the Studio link. Studio sits OUTSIDE navItems deliberately: it
              is an external, tracked destination, and folding it into the union
              would mean every leaf pretending it might be external. Keeping the
              four-item rule intact was also the reason not to demote
              /music-composition into a dropdown — that would have changed the
              traffic to a funnel we are deliberately leaving undisturbed. */}
          <div className="hidden items-center gap-1 md:flex lg:gap-2">
            {navItems.map((item) => {
              if (hasChildren(item)) {
                const active = groupActive(item.children);
                return (
                  <div key={item.label} className="group relative">
                    <button
                      type="button"
                      aria-haspopup="true"
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex items-center gap-1 rounded-lg px-4 py-2 font-tamil font-medium transition-all ${
                        active ? 'bg-gray-800/70 text-orange-400' : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
                      }`}
                    >
                      {item.label}
                      <Chevron className="transition-transform group-hover:rotate-180" />
                    </button>
                    <div className="absolute left-0 top-full hidden pt-2 group-hover:block group-focus-within:block">
                      <div className="min-w-[12rem] rounded-xl border border-gray-800 bg-gray-900/95 p-1.5 shadow-2xl backdrop-blur-md">
                        {item.children.map((child) => {
                          const childActive = isActive(child.href);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              aria-current={childActive ? 'page' : undefined}
                              className={`block rounded-lg px-3 py-2 font-tamil transition-colors ${
                                childActive ? 'bg-gray-800 text-orange-400' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                              }`}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }
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

            <StudioCta placement="site_nav" variant="nav" />

            {showYouTube && (
              <a
                href={SITE.youtube.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-2 rounded-full bg-orange-600 px-4 py-2 font-tamil text-sm font-bold text-white shadow-lg transition-colors hover:bg-orange-700"
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

        {/* Mobile Menu — dimmed backdrop + scrollable panel. Dropdowns become
            labelled sections; plain links sit at the top level. */}
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
                {navItems.map((item, i) =>
                  hasChildren(item) ? (
                    <div key={item.label}>
                      {i > 0 && <div className="my-1 border-t border-gray-800/60" />}
                      <p className="px-3 pt-1 font-tamil text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {item.label}
                      </p>
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          aria-current={isActive(child.href) ? 'page' : undefined}
                          onClick={close}
                          className={`block py-2.5 pl-5 pr-3 ${mobileLinkClass(isActive(child.href))}`}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      onClick={close}
                      className={`px-3 py-2.5 ${mobileLinkClass(isActive(item.href))}`}
                    >
                      {item.label}
                    </Link>
                  )
                )}

                {/* Mobile gets the Studio link too — on a phone the header nav
                    is hidden entirely, so omitting it here would mean most
                    visitors never see the CTA at all. */}
                <StudioCta placement="site_nav" variant="nav" className="px-3 py-2.5" />

                {showYouTube && (
                  <a
                    href={SITE.youtube.channelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-orange-600 px-4 py-2 font-tamil text-sm text-white transition-colors hover:bg-orange-700"
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
