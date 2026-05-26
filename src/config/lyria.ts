/**
 * Lyria (Google Vertex AI) music-generation configuration.
 *
 * `enabled` is the master switch — kept OFF until Vertex AI + the Lyria model
 * are enabled on the GCP project and verified live. While off, the poem-music
 * route serves only already-cached tracks and otherwise returns null, so the
 * PoemReader falls back to the existing royalty-free library (no behavior change).
 */
export const LYRIA = {
  /** Verified live on webcore-dev (Vertex AI + Lyria enabled, SA authorized). */
  enabled: true,
  /** GCP project with Vertex AI + Lyria enabled. */
  project: process.env.GOOGLE_VERTEX_PROJECT || 'webcore-dev',
  location: 'us-central1',
  model: 'lyria-002',
} as const;

export function isLyriaEnabled(): boolean {
  return LYRIA.enabled && Boolean(LYRIA.project);
}
