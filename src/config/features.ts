/**
 * Feature Flags Configuration
 *
 * Enable or disable features across the application
 * Set to false to hide features that are under development
 */

export const FEATURES = {
  // Admin Panel Features
  ADMIN: {
    SEO_FIELDS: false,        // SEO title and description in content forms
    SETTINGS_PAGE: false,     // Settings page in admin sidebar
    MEDIA_LIBRARY: false,     // Media library page in admin sidebar
    COMMENTS: false,          // Comment moderation features
    ANALYTICS: false,         // Analytics dashboard
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
  },
} as const;

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
