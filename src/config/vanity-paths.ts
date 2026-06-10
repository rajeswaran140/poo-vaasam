/**
 * Vanity (clean) URLs for specific content items.
 *
 * Keyed by content id → the pretty path that should be its public URL. The
 * routing for these (serve the page at the vanity path + 301 the /content/<id>
 * URL to it) is wired in next.config.ts; this map is the single source of truth
 * that both the config and the app (canonical, internal links, sitemap) read so
 * they never drift.
 */
export const VANITY_PATHS: Record<string, string> = {
  // எங்கள் தேசம் → /thayagam
  cnt_1781049094952_wstyqacm4: '/thayagam',
};

/**
 * The canonical public path for a content id: its vanity URL when one exists,
 * otherwise the default /content/<id>.
 */
export function contentPath(id: string): string {
  return VANITY_PATHS[id] || `/content/${id}`;
}
