/**
 * Site-wide configuration (links, social, branding).
 */

export const SITE = {
  name: 'தமிழகவல்',
  youtube: {
    /**
     * Your YouTube channel URL. Replace the placeholder below with your real
     * channel (e.g. https://www.youtube.com/@YourHandle). Until it's set to a
     * real channel, the YouTube/Subscribe links are hidden site-wide.
     */
    channelUrl: 'https://www.youtube.com/@Tamilagaval',
    /**
     * Channel ID (UC…, 24 chars) — required for the RSS-backed videos feed.
     * Empty = the /videos page, homepage strip and Subscribe CTAs stay hidden.
     */
    channelId: 'UCZCuphXleq-mXVYgvqh-OlQ',
    label: 'YouTube',
    channelLabel: 'YouTube', // icon + brand word only, no Tamil
  },
  facebook: {
    url: 'https://www.facebook.com/profile.php?id=61590184029055',
    label: 'Facebook',
  },
  instagram: {
    // Set to the Instagram profile URL once a Business/Creator account exists
    // (https://www.instagram.com/<handle>). Empty = hidden site-wide, so this
    // lights up everywhere (sameAs, follow row) the moment it's filled in.
    url: '',
    label: 'Instagram',
  },
} as const;

/**
 * Content sections in priority order (songs & poems lead — Raj is a
 * writer/lyricist showcasing his own work). `live: false` hides a section
 * everywhere it's driven from this list — nav, homepage cards and sitemap —
 * until it has content. Flip a section to `live: true` when you publish that
 * type. lyrics/stories/essays are empty for now.
 */
export const CONTENT_SECTIONS = [
  { type: 'SONGS', href: '/songs', label: 'பாடல்கள்', icon: '🎵', color: 'from-blue-500 to-blue-600', live: true },
  { type: 'POEMS', href: '/poems', label: 'கவிதைகள்', icon: '📝', color: 'from-green-500 to-green-600', live: true },
  { type: 'LYRICS', href: '/lyrics', label: 'பாடல் வரிகள்', icon: '🎤', color: 'from-yellow-500 to-yellow-600', live: false },
  { type: 'STORIES', href: '/stories', label: 'கதைகள்', icon: '📖', color: 'from-pink-500 to-pink-600', live: false },
  { type: 'ESSAYS', href: '/essays', label: 'கட்டுரைகள்', icon: '✍️', color: 'from-purple-500 to-purple-600', live: false },
] as const;

/** Content sections currently live (have content / ready to surface). */
export function liveContentSections() {
  return CONTENT_SECTIONS.filter((s) => s.live);
}

/**
 * True when the given content-type's section is live. Used to `noindex` the
 * still-empty section pages (lyrics/stories/essays) so crawlers don't index
 * thin/empty pages as soft-404s; flips to indexable automatically when the
 * section's `live` flag is turned on.
 */
export function isContentSectionLive(type: string): boolean {
  return CONTENT_SECTIONS.some((s) => s.type === type && s.live);
}

/** True when a real Facebook URL is configured. */
export function isFacebookConfigured(): boolean {
  return /facebook\.com\//.test(SITE.facebook.url);
}

/** True when a real Instagram URL is configured. */
export function isInstagramConfigured(): boolean {
  return /instagram\.com\//.test(SITE.instagram.url);
}

/**
 * Public social-profile URLs that are actually configured. Used for JSON-LD
 * `sameAs` (consolidates the brand's profiles in Google's knowledge graph) and
 * the social follow rows — one source of truth so every surface stays in sync.
 */
export function socialProfileUrls(): string[] {
  return [
    ...(isYouTubeChannelConfigured() ? [SITE.youtube.channelUrl] : []),
    ...(isFacebookConfigured() ? [SITE.facebook.url] : []),
    ...(isInstagramConfigured() ? [SITE.instagram.url] : []),
  ];
}

/**
 * True only when a real channel URL has been configured (not the placeholder).
 * Channel-promotion UI is gated on this so a placeholder never ships a dead link.
 */
export function isYouTubeChannelConfigured(): boolean {
  const url = SITE.youtube.channelUrl;
  return /youtube\.com\/(@|channel\/|c\/|user\/)/.test(url) && !url.includes('CHANGE_ME');
}

/** Validate a YouTube channel ID (UC + 22 url-safe chars). */
export function isValidYouTubeChannelId(id: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(id);
}

/** True when a real channel ID is set, enabling the RSS-backed videos feed/UI. */
export function isYouTubeVideosConfigured(): boolean {
  return isValidYouTubeChannelId(SITE.youtube.channelId);
}

/**
 * One-click "Subscribe" URL — opens YouTube's subscribe-confirmation dialog.
 * Pass a `source` to UTM-tag the click so GA can report which CTA on the site
 * actually drove the subscribe (hero vs footer vs floater vs videos-page …).
 * YouTube preserves the query string on the redirect to the channel page, so
 * the UTM lands in Google Analytics when the user comes back via any link
 * we control downstream.
 */
export function youtubeSubscribeUrl(source?: string): string {
  const base = `${SITE.youtube.channelUrl.replace(/\/+$/, '')}?sub_confirmation=1`;
  if (!source) return base;
  const utm = new URLSearchParams({
    utm_source: 'tamilagaval',
    utm_medium: 'site_cta',
    utm_campaign: 'youtube_subscribe',
    utm_content: source,
  });
  return `${base}&${utm.toString()}`;
}
