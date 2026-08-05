/**
 * Pre-master analysis of a source (and optionally its Part B).
 *
 * Stores MEASUREMENTS, never verdicts. The worker has the audio and does the
 * ffmpeg work; the app decides what the numbers mean (see master-analysis.ts).
 * That split is deliberate: a threshold or a wording change stays app-side, so
 * it ships with an Amplify build rather than needing a Lambda redeploy.
 *
 * Carries a 24h ttl like a mastering job — an analysis is a scratch reading
 * about a file, worth nothing once the master exists.
 */
export type MasterAnalysisStatus = 'processing' | 'done' | 'error';

export interface MasterAnalysis {
  id: string;
  status: MasterAnalysisStatus;
  createdAt: string;
  updatedAt: string;
  s3Key: string;
  partBKey: string | null;
  /** Source duration, from the header. Null when it could not be read. */
  durationSec: number | null;
  leadingSilenceSec: number | null;
  trailingSilenceSec: number | null;
  /** How far the last second sits below the four before it. Null = unjudgeable. */
  tailDropLu: number | null;
  integratedLufs: number | null;
  /** Part B's readings, when a second file was analysed. */
  partBDurationSec: number | null;
  partBIntegratedLufs: number | null;
  partBTailDropLu: number | null;
  error: { code: string; message: string } | null;
}
