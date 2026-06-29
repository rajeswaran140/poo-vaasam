/**
 * Browser glue: fetch an audio URL, decode it to 48 kHz PCM via the Web Audio
 * API, and run the pure metrics. Best-effort — CORS blocks, decode errors, or
 * an abort just yield null (the take still logs, only without measurements).
 * The DSP itself lives in the unit-tested audio-metrics module.
 *
 * Note: cross-origin audio (e.g. the CloudFront media bucket) must send CORS
 * headers allowing the admin origin, or the fetch is blocked and metrics are
 * skipped — configure the bucket CORS to enable measurement there.
 */

import { computeAudioMetrics, type AudioMetrics } from '@/lib/audio-metrics';

const TARGET_RATE = 48000;

type OfflineCtor = typeof OfflineAudioContext;

export async function measureAudioFromUrl(url: string, signal?: AbortSignal): Promise<AudioMetrics | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();

    const Ctor: OfflineCtor | undefined =
      (typeof OfflineAudioContext !== 'undefined' && OfflineAudioContext) ||
      (globalThis as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext;
    if (!Ctor) return null;

    // A throwaway 48 kHz context so decodeAudioData resamples to the rate the
    // BS.1770 K-weighting coefficients assume.
    const ctx = new Ctor(1, 1, TARGET_RATE);
    const audio = await ctx.decodeAudioData(bytes);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    if (!channels.length || !channels[0].length) return null;

    const metrics = computeAudioMetrics(channels, audio.sampleRate);
    // A silent/empty decode → no useful measurement.
    return Number.isFinite(metrics.peakDbfs) ? metrics : null;
  } catch {
    return null;
  }
}
