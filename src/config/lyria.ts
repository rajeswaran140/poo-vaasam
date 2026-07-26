/**
 * Lyria (Google Vertex AI) music-generation configuration.
 *
 * `enabled` is the master switch for GENERATION. While off, the poem-music
 * route serves only already-cached tracks and otherwise returns null, so the
 * PoemReader falls back to the existing royalty-free library (no behaviour
 * change for the reader).
 *
 * DEFAULT OFF, opt in via `LYRIA_ENABLED=true`. It used to be a hardcoded
 * `true`, which meant an unauthenticated GET could spend money on Vertex AI.
 * Two facts made that worse than it looks:
 *   1. The generated track is only free-of-charge on the SECOND request — the
 *      first pays for generation and caches the result in S3. A cache that
 *      never populates therefore bills on EVERY request.
 *   2. `s3://tamil-web-media/audio/poem-music/` contains zero `.wav` objects,
 *      i.e. the cache has never once populated in production. So generation was
 *      either failing silently (feature dead) or succeeding with a failing
 *      upload (feature billing on repeat).
 * Until that is diagnosed, generation stays off by default and the reader keeps
 * its royalty-free fallback. Flip the env var once the cache is confirmed to
 * write. See the poem-music route for the request-side guards.
 */
export const LYRIA = {
  /**
   * Generation is opt-in. Anything other than the exact string 'true' is off,
   * so a stray/empty value can't silently enable spend.
   */
  enabled: process.env.LYRIA_ENABLED === 'true',
  /** GCP project with Vertex AI + Lyria enabled. */
  project: process.env.GOOGLE_VERTEX_PROJECT || 'webcore-dev',
  location: 'us-central1',
  model: 'lyria-002',
} as const;

export function isLyriaEnabled(): boolean {
  return LYRIA.enabled && Boolean(LYRIA.project);
}
