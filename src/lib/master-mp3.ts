/**
 * Web MP3 export — the artifact listeners actually receive.
 *
 * WHY THIS EXISTS. Until now the module produced a peak-safe WAV and stopped;
 * the 192k MP3 the site serves was made separately by scripts/transcode-wav-to-
 * mp3.ts. Nothing ever measured the delivered file, and the 2026-07-24 catalogue
 * sweep found 2 of 17 served MP3s ABOVE the -1 dBTP ceiling
 * (`யாழ்ப்பாண வீதி-வாசம்` -0.08, `முத்தமிழின் மூன்றெழுத்தில்` -0.92).
 *
 * ⚠️ THE STANDING EXPLANATION FOR THOSE TWO WAS WRONG — measured 2026-08-03.
 * It was assumed lossy encoding had pushed the peak up. Tested across the 13
 * songs that have both a served MP3 and an archived master, the encode delta
 * (MP3 true peak minus WAV true peak) is:
 *
 *     mean -0.06 dB · median -0.11 dB · range -0.23 .. +0.22 dB
 *
 * i.e. 192k encoding is peak-NEUTRAL on this material. For overshoot to lift a
 * compliant -1 dBTP master to -0.08 it would have had to add ~0.9 dB, and the
 * largest rise ever observed is +0.22. Those two songs were simply never peak
 * limited — they did not come through this module.
 *
 * Two consequences, both encoded below:
 *  1. A hot MP3 means a hot MASTER. `mp3PeakVerdict` says so rather than
 *     blaming the encoder, because blaming the encoder sends you to re-encode,
 *     which fixes nothing.
 *  2. The check is still worth running. The margin is small but not zero, so a
 *     master sitting exactly on -1 can cross it; measuring the delivered file
 *     is the only way to know.
 */

/** Matches scripts/transcode-wav-to-mp3.ts and what the site already serves. */
export const MP3_BITRATE = '192k';

/** EBU R128 / streaming convention, same ceiling the WAV master is held to. */
export const TRUE_PEAK_CEILING_DBTP = -1;

/**
 * Largest peak RISE observed across 13 real master→MP3 pairs (2026-08-03).
 * Used to explain a violation, never to excuse one.
 */
export const MAX_OBSERVED_ENCODE_RISE_DB = 0.22;

/** S3 key for the MP3 built from a mastered WAV. */
export function mp3KeyFor(masterKey: string): string {
  return masterKey.replace(/\.wav$/i, '.mp3');
}

/** True if the key is an MP3 produced by this module. */
export function isMasterMp3Key(key: string): boolean {
  return /-master(-\d+(?:_\d+)?LUFS)?\.mp3$/i.test(key);
}

/**
 * ffmpeg arguments for the export.
 *
 * Encoded from the MASTERED WAV, not the source: the whole point is to measure
 * the file that ships. No filters — a fade or trim already happened in the
 * worker's pre-pass, and re-applying anything here would double it.
 */
export function buildMp3Args(inPath: string, outPath: string, bitrate = MP3_BITRATE): string[] {
  return [
    '-hide_banner', '-nostats',
    '-i', inPath,
    '-codec:a', 'libmp3lame',
    '-b:a', bitrate,
    // Strip any inherited cover art: a video stream in an "audio" file breaks
    // some players and inflates the download for no benefit.
    '-vn',
    '-y', outPath,
  ];
}

export type Mp3PeakStatus = 'ok' | 'hot' | 'unknown';

export interface Mp3PeakVerdict {
  status: Mp3PeakStatus;
  /** MP3 true peak minus WAV true peak, when both are known. */
  encodeDeltaDb: number | null;
  message: string;
}

/**
 * Is the delivered MP3 peak-safe, and if not, where does the fault lie?
 *
 * The distinction matters operationally. A hot MP3 whose master is also hot is
 * a mastering problem — re-master. A hot MP3 from a compliant master would be
 * an encoder problem — and per the measurement above, that has never been seen
 * on this material, so the verdict says which one it is instead of guessing.
 */
export function mp3PeakVerdict(input: {
  mp3Tp: number | null;
  wavTp: number | null;
}): Mp3PeakVerdict {
  const { mp3Tp, wavTp } = input;
  if (mp3Tp === null || !Number.isFinite(mp3Tp)) {
    return {
      status: 'unknown',
      encodeDeltaDb: null,
      message: 'The MP3 could not be measured, so its peak is unverified.',
    };
  }
  const delta =
    wavTp !== null && Number.isFinite(wavTp)
      ? Math.round((mp3Tp - wavTp) * 100) / 100
      : null;

  if (mp3Tp <= TRUE_PEAK_CEILING_DBTP) {
    return {
      status: 'ok',
      encodeDeltaDb: delta,
      message: `MP3 true peak ${mp3Tp.toFixed(2)} dBTP — within the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling.`,
    };
  }

  // Over the ceiling. Attribute it.
  const masterAlsoHot = wavTp !== null && Number.isFinite(wavTp) && wavTp > TRUE_PEAK_CEILING_DBTP;
  if (masterAlsoHot) {
    return {
      status: 'hot',
      encodeDeltaDb: delta,
      message:
        `MP3 true peak ${mp3Tp.toFixed(2)} dBTP is above the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling, ` +
        `and so is the master (${wavTp!.toFixed(2)}). Re-master this take — re-encoding will not fix it.`,
    };
  }
  return {
    status: 'hot',
    encodeDeltaDb: delta,
    message:
      `MP3 true peak ${mp3Tp.toFixed(2)} dBTP is above the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling ` +
      `even though the master is not. Measured encoding has never added more than ` +
      `${MAX_OBSERVED_ENCODE_RISE_DB} dB on this catalogue, so treat this as unexpected and check the file.`,
  };
}
