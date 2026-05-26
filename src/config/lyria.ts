/**
 * Lyria (Google Vertex AI) music-generation configuration.
 *
 * `enabled` is the master switch — kept OFF until Vertex AI + the Lyria model
 * are enabled on the GCP project and verified live. While off, the poem-music
 * route serves only already-cached tracks and otherwise returns null, so the
 * PoemReader falls back to the existing royalty-free library (no behavior change).
 */
export const LYRIA = {
  /** Flip to true once Vertex AI + Lyria are enabled and a live test passes. */
  enabled: false,
  /** GCP project that has Vertex AI + Lyria enabled (inline via next.config if needed). */
  project: process.env.GOOGLE_VERTEX_PROJECT || '',
  location: 'us-central1',
  model: 'lyria-002',
} as const;

export function isLyriaEnabled(): boolean {
  return LYRIA.enabled && Boolean(LYRIA.project);
}
