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
    label: 'YouTube',
    channelLabel: 'YouTube', // icon + brand word only, no Tamil
  },
} as const;

/**
 * True only when a real channel URL has been configured (not the placeholder).
 * Channel-promotion UI is gated on this so a placeholder never ships a dead link.
 */
export function isYouTubeChannelConfigured(): boolean {
  const url = SITE.youtube.channelUrl;
  return /youtube\.com\/(@|channel\/|c\/|user\/)/.test(url) && !url.includes('CHANGE_ME');
}
