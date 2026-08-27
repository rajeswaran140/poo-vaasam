/**
 * Client-side override that reroutes react-transliterate's browser fetch to
 * our same-origin proxy — see /api/admin/compose/transliterate.
 *
 * WHY THIS EXISTS. react-transliterate hard-codes a fetch to
 * https://inputtools.google.com/request. That endpoint returns valid
 * transliteration data but sends NO `Access-Control-Allow-Origin`, so every
 * modern browser silently blocks the response. The library offers no way to
 * override the URL via props.
 *
 * Fix: while any component using ReactTransliterate is mounted, wrap
 * window.fetch so any call to that URL is rewritten to
 * /api/admin/compose/transliterate. The proxy route calls Google server-side
 * (where CORS doesn't apply) and returns the JSON verbatim, so
 * react-transliterate's parser works unchanged. Any other library's fetches
 * are untouched — the URL check is exact-prefix.
 *
 * Safe under multiple concurrent mounts: each mount stores + restores the
 * original fetch it saw at effect time. If two Tamil inputs mount and
 * unmount, the second's cleanup restores the first's proxied version, and
 * the first's cleanup restores the real one. The chain unwinds correctly.
 *
 * Use it in any client component that renders ReactTransliterate.
 */

'use client';

import { useEffect } from 'react';

const INPUTTOOLS_PREFIX = 'https://inputtools.google.com/request';

export function useInputtoolsProxyOverride(): void {
  useEffect(() => {
    // jsdom (used by tests) has no window.fetch — guard so tests that render
    // a Tamil-input component don't blow up at effect time. Production
    // browsers always have fetch.
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const original = window.fetch.bind(window);
    window.fetch = function proxied(input: RequestInfo | URL, init?: RequestInit) {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (typeof rawUrl === 'string' && rawUrl.startsWith(INPUTTOOLS_PREFIX)) {
        try {
          const u = new URL(rawUrl);
          const text = u.searchParams.get('text') ?? '';
          const itc = u.searchParams.get('itc') ?? 'ta-t-i0-und';
          const lang = itc.split('-')[0] || 'ta';
          const num = u.searchParams.get('num') ?? '5';
          const proxied =
            `/api/admin/compose/transliterate` +
            `?text=${encodeURIComponent(text)}` +
            `&lang=${encodeURIComponent(lang)}` +
            `&num=${encodeURIComponent(num)}`;
          return original(proxied, init);
        } catch {
          // Fall through if URL parsing fails — the CSP still refuses the
          // direct call and the user sees no suggestions, but nothing worse
          // than the pre-proxy state.
          return original(input, init);
        }
      }
      return original(input, init);
    };
    return () => {
      window.fetch = original;
    };
  }, []);
}
