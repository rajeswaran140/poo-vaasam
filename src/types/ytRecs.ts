/**
 * Cached AI YouTube-growth recommendations. Generated on demand (admin refresh)
 * and stored so the dashboard can render them WITHOUT an LLM call in its server
 * render path — the Anthropic call doesn't fit the Amplify ~30s request ceiling
 * reliably (same constraint as the composer).
 */
export interface CachedYtRecs {
  recommendations: string[];
  /** ISO timestamp of when these were generated. */
  generatedAt: string;
  /** Analytics window (days) the recs were based on. */
  days: number;
}
