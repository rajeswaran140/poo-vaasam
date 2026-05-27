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
    channelUrl: 'https://youtube.com/@RajeswaranThangarajah',
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
} as const;

/** True when a real Facebook URL is configured. */
export function isFacebookConfigured(): boolean {
  return /facebook\.com\//.test(SITE.facebook.url);
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

/** One-click "Subscribe" URL — opens YouTube's subscribe-confirmation dialog. */
export function youtubeSubscribeUrl(): string {
  return `${SITE.youtube.channelUrl.replace(/\/+$/, '')}?sub_confirmation=1`;
}
