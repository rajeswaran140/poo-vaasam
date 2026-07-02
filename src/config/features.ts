/**
 * Feature Flags Configuration
 *
 * Enable or disable features across the application
 * Set to false to hide features that are under development
 */

export const FEATURES = {
  // Admin Panel Features
  ADMIN: {
    SEO_FIELDS: true,         // SEO title and description in content forms
    SETTINGS_PAGE: false,     // Settings page in admin sidebar
    MEDIA_LIBRARY: false,     // Media library page in admin sidebar
    // NOTE: Comments (/admin/comments) and Analytics (/admin/analytics) are LIVE
    // and always linked in the sidebar — they were never gated by a flag. The old
    // COMMENTS/ANALYTICS flags here were dead (zero consumers) and falsely read
    // `false`, so they were removed to stop the config from lying. Re-add a flag
    // here only if you actually wire it into the sidebar/page.
  },

  // Content Features
  CONTENT: {
    AUDIO_UPLOAD: true,       // Audio file upload for songs/poems
    IMAGE_UPLOAD: true,       // Featured image upload
    CATEGORIES: true,         // Category management
    TAGS: true,               // Tag management
    RATINGS: false,           // User ratings (not implemented yet)
  },

  // Public Features
  PUBLIC: {
    SEARCH: false,            // Search functionality
    COMMENTS: false,          // Public commenting
    SOCIAL_SHARE: false,      // Social media sharing buttons
    // On-site audio playback. TEMPORARILY OFF (2026-07-02): the site funnels
    // listeners to YouTube (where watch-hours count toward YPP) instead of
    // competing with it. When off, songs WITH a YouTube video route to "Watch
    // on YouTube"; songs WITHOUT one keep the on-site player as a fallback so
    // nothing is orphaned. Flip back to true to restore full on-site playback.
    AUDIO_PLAYBACK: false,
  },
} as const;

/** True when on-site audio playback is enabled (see PUBLIC.AUDIO_PLAYBACK). */
export function isAudioPlaybackEnabled(): boolean {
  return Boolean(FEATURES.PUBLIC.AUDIO_PLAYBACK);
}

/**
 * Helper function to check if a feature is enabled
 */
export function isFeatureEnabled(category: keyof typeof FEATURES, feature: string): boolean {
  return (FEATURES[category] as any)[feature] === true;
}

/**
 * Get all enabled admin features
 */
export function getEnabledAdminFeatures() {
  return Object.entries(FEATURES.ADMIN)
    .filter(([_, enabled]) => enabled)
    .map(([feature]) => feature);
}
