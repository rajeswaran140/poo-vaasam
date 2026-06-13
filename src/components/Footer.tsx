/**
 * Shared site footer — brand identity, YouTube/Facebook social, quick links,
 * about/legal links, copyright. Was inline-only in the homepage; extracted so
 * /songs, /videos, and future public pages share the same chrome.
 */

import Link from 'next/link';
import {
  SITE,
  liveContentSections,
  isYouTubeChannelConfigured,
  isFacebookConfigured,
  isInstagramConfigured,
  isYouTubeVideosConfigured,
  youtubeSubscribeUrl,
} from '@/config/site';
import { TrackedYouTubeAnchor } from '@/components/TrackedYouTubeAnchor';
import { SubscribeForm } from '@/components/SubscribeForm';

export function Footer() {
  return (
    <footer className="relative bg-gray-900 text-white py-12">
      {/* brand accent — ties the footer to the orange hero */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-500/70 to-transparent" />

      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-2xl font-bold mb-3 font-kavivanar">தமிழகவல்</h3>
            <p className="text-gray-400 font-tamil text-sm mb-5">
              தமிழ் கவிதைகள் · பாடல்கள் · காணொளிகள் · என்றும் இலவசம்
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {isYouTubeChannelConfigured() && (
                <TrackedYouTubeAnchor
                  href={youtubeSubscribeUrl('footer')}
                  source="footer"
                  ariaLabel="YouTube"
                  className="inline-flex items-center justify-center w-11 h-11 bg-orange-600 text-white rounded-full hover:bg-orange-700 transition-colors shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                </TrackedYouTubeAnchor>
              )}
              {isFacebookConfigured() && (
                <a
                  href={SITE.facebook.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Facebook"
                  className="inline-flex items-center justify-center w-11 h-11 bg-orange-600 text-white rounded-full hover:bg-orange-700 transition-colors shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                </a>
              )}
              {isInstagramConfigured() && (
                <a
                  href={SITE.instagram.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                  className="inline-flex items-center justify-center w-11 h-11 bg-orange-600 text-white rounded-full hover:bg-orange-700 transition-colors shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.332.014 7.052.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.332 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
                  </svg>
                </a>
              )}
            </div>
          </div>
          <div>
            <h4 className="font-semibold mb-4 font-tamil">விரைவு இணைப்புகள்</h4>
            <ul className="space-y-2 text-gray-400">
              {liveContentSections().map((s) => (
                <li key={s.href}><Link href={s.href} className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">{s.label}</Link></li>
              ))}
              {isYouTubeVideosConfigured() && (
                <li><Link href="/videos" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">காணொளிகள்</Link></li>
              )}
              <li><Link href="/music-composition" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">இசையமைப்பு சேவை</Link></li>
              <li><Link href="/all" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">அனைத்து உள்ளடக்கம்</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4 font-tamil">பற்றி</h4>
            <ul className="space-y-2 text-gray-400">
              <li><Link href="/about" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">எங்களை பற்றி</Link></li>
              <li><Link href="/contact" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">தொடர்பு</Link></li>
              <li><Link href="/privacy" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">Terms</Link></li>
            </ul>
          </div>
        </div>
        {/* Newsletter — the audience we own, independent of any algorithm. */}
        <div className="border-t border-gray-800 mt-8 pt-8 flex justify-center">
          <SubscribeForm source="footer" />
        </div>
        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
          <p>© {new Date().getFullYear()} TechSynergy Corp. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
