/**
 * Pure parsing of ffmpeg's `ebur128`+`astats` (measurement) and `loudnorm`
 * (two-pass mastering) stderr — the brains of the Music Lab audio functions
 * (`worker/measure-fn.ts`, `worker/master-worker.ts`). Kept pure + framework-free
 * so it's unit-testable and validated against REAL ffmpeg output (see the test).
 *
 * Streaming target: -14 LUFS integrated, -1 dBTP true-peak ceiling.
 *
 * CRITICAL: `ebur128` prints a per-frame `t: … I: … LRA: … TPK: …` line for the
 * WHOLE track, THEN a Summary block at the end. We parse ONLY the Summary region
 * (after the last "Summary:") so the integrated/LRA/true-peak values are the
 * final ones — not the first per-frame sample.
 */

export type MeasureStatus = 'ok' | 'hot' | 'quiet';
export type MeasureVerdict = MeasureStatus | 'clip-risk' | 'squashed';

export interface LoudnessMetrics {
  /** Integrated loudness (LUFS). */
  lufs: number;
  /** Loudness range (LU). */
  lra: number;
  /** True peak (dBFS / dBTP). */
  truePeak: number;
  /** Crest factor = Peak level dB − RMS level dB (dynamics), 1 dp. */
  crest: number;
  /** astats flat factor (>0 ⇒ flat-topped / likely clipped). */
  flatFactor: number;
}

export interface MeasureResult {
  metrics: LoudnessMetrics;
  badge: string;
  verdict: MeasureVerdict;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** parseFloat that understands ffmpeg's "-inf"/"inf" (silence). */
function num(s: string | undefined): number {
  if (s == null) return NaN;
  if (/^-?inf$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  return parseFloat(s);
}
function matchNum(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? num(m[1]) : NaN;
}

/** The ebur128 Summary region (everything after the final "Summary:"). */
function summaryRegion(stderr: string): string {
  const i = stderr.lastIndexOf('Summary:');
  return i >= 0 ? stderr.slice(i) : stderr;
}

/** Badge + verdict from the metrics. Pure; mirrors the spec precedence. */
/**
 * Take-selection advice: what mastering CAN fix versus what it cannot.
 *
 * The Music Lab already shows a badge and a `clip-risk`/`squashed` chip, but it
 * never says which problems are worth walking away from. That distinction is
 * the whole point: loudness is corrected losslessly by a static gain, whereas
 * clipping and squashed dynamics are baked into the take and no amount of
 * mastering will recover them. The standing decision is that dynamics live
 * UPSTREAM, at take selection — this puts that rule at the moment of the choice
 * instead of in Raj's head.
 *
 * CALIBRATED TO THIS CATALOGUE, not to generic mastering guidance. Tamilagaval's
 * SUNO sources measure LRA 2.3–5.0 with real masters at 2.8–3.0, so a "narrow
 * dynamics" warning at a textbook threshold (say 6 LU) would fire on nearly
 * every take and teach Raj to ignore it. The LRA flag therefore only trips
 * BELOW the bottom of the observed range.
 */
export const CATALOGUE_MIN_LRA = 2.3;

export interface TakeIssue {
  label: string;
  detail: string;
  /** 'mastering' = corrected losslessly downstream. 'take' = pick another. */
  fix: 'mastering' | 'take';
}

export interface TakeAdvice {
  /** false = at least one problem mastering cannot repair. */
  usable: boolean;
  headline: string;
  issues: TakeIssue[];
}

export function takeAdvice(
  m: Pick<LoudnessMetrics, 'lufs' | 'truePeak' | 'flatFactor' | 'crest' | 'lra'>,
  target = -14
): TakeAdvice {
  const issues: TakeIssue[] = [];

  // --- not repairable: baked into the recording ---
  if (m.flatFactor > 0) {
    issues.push({
      label: 'Clipped at source',
      detail: `flat-topped samples (flat factor ${round1(m.flatFactor)}) — the waveform is already squared off`,
      fix: 'take',
    });
  }
  if (m.truePeak > 0) {
    issues.push({
      label: 'Over full scale',
      detail: `true peak ${round1(m.truePeak)} dBTP is above 0 — already distorting`,
      fix: 'take',
    });
  }
  if (Number.isFinite(m.crest) && m.crest < 6) {
    issues.push({
      label: 'Squashed',
      detail: `crest ${round1(m.crest)} dB — peaks and body are almost the same level`,
      fix: 'take',
    });
  }
  if (Number.isFinite(m.lra) && m.lra < CATALOGUE_MIN_LRA) {
    issues.push({
      label: 'Unusually narrow dynamics',
      detail: `LRA ${round1(m.lra)} LU, below this catalogue's usual ${CATALOGUE_MIN_LRA}–5.0`,
      fix: 'take',
    });
  }

  // --- repairable downstream ---
  const delta = round1(m.lufs - target);
  if (Math.abs(delta) > 1) {
    issues.push({
      label: delta > 0 ? 'Loud' : 'Quiet',
      detail: `${Math.abs(delta)} LU ${delta > 0 ? 'above' : 'below'} ${target} — corrected by a static gain`,
      fix: 'mastering',
    });
  }
  if (m.truePeak > -1 && m.truePeak <= 0) {
    issues.push({
      label: 'Peak above ceiling',
      detail: `true peak ${round1(m.truePeak)} dBTP — mastering brings it under -1`,
      fix: 'mastering',
    });
  }

  const blocking = issues.filter((i) => i.fix === 'take');
  return {
    usable: blocking.length === 0,
    headline: blocking.length
      ? `Consider another take — ${blocking.length} issue${blocking.length > 1 ? 's' : ''} mastering cannot fix`
      : issues.length
        ? 'Good take — mastering will handle the rest'
        : 'Good take — already on target',
    issues,
  };
}

export function badgeAndVerdict(
  m: Pick<LoudnessMetrics, 'lufs' | 'truePeak' | 'flatFactor' | 'crest'>,
  target = -14
): { badge: string; status: MeasureStatus; verdict: MeasureVerdict } {
  const delta = round1(m.lufs - target);
  let status: MeasureStatus;
  let badge: string;
  if (Math.abs(delta) <= 1) {
    status = 'ok';
    badge = `on-target (${target})`;
  } else if (delta > 0) {
    status = 'hot';
    badge = `+${delta} LU hot`;
  } else {
    status = 'quiet';
    badge = `${Math.abs(delta)} LU quiet`;
  }

  let verdict: MeasureVerdict;
  // `clip-risk` means the take is ACTUALLY distorting: samples above full scale,
  // or flat-topped (already squared off). It used to trip at `truePeak > -1`,
  // which conflated two different things — a peak of -0.5 dBTP is not clipping,
  // it merely sits above the -1 dBTP DELIVERY ceiling, and mastering attenuates
  // it losslessly. That over-strict rule put a red "clip-risk" chip beside a
  // take that takeAdvice() correctly called fine, so the same screen said two
  // opposite things. Peaks between -1 and 0 are reported by takeAdvice as a
  // mastering fix; the verdict now falls through to the loudness status.
  if (m.truePeak > 0 || m.flatFactor > 0) verdict = 'clip-risk';
  // NOTE: the crest < 6 threshold is PROVISIONAL — inherited, not calibrated.
  // Unlike CATALOGUE_MIN_LRA it has never been checked against real takes
  // (zero measured takes are stored). Revisit once Music Lab has production
  // data; do not treat 6 dB as validated for this catalogue.
  else if (Number.isFinite(m.crest) && m.crest < 6) verdict = 'squashed';
  else verdict = status;

  return { badge, status, verdict };
}

/** Parse a measurement pass (ebur128 + astats) into metrics + badge + verdict. */
export function parseMeasurement(stderr: string, target = -14): MeasureResult {
  const sum = summaryRegion(stderr);
  const lufs = matchNum(sum, /I:\s+(-?\d+(?:\.\d+)?|-?inf)\s+LUFS/i);
  const lra = matchNum(sum, /LRA:\s+(-?\d+(?:\.\d+)?|-?inf)\s+LU/i);
  const truePeak = matchNum(sum, /Peak:\s+(-?\d+(?:\.\d+)?|-?inf)\s+dBFS/i);

  // astats labels are unique (no per-frame collision) — search the whole log.
  const peakLevelDb = matchNum(stderr, /Peak level dB:\s+(-?\d+(?:\.\d+)?|-?inf)/i);
  const rmsLevelDb = matchNum(stderr, /RMS level dB:\s+(-?\d+(?:\.\d+)?|-?inf)/i);
  const flatFactor = matchNum(stderr, /Flat factor:\s+(-?\d+(?:\.\d+)?|-?inf)/i);
  const crest =
    Number.isFinite(peakLevelDb) && Number.isFinite(rmsLevelDb) ? round1(peakLevelDb - rmsLevelDb) : NaN;

  const metrics: LoudnessMetrics = { lufs, lra, truePeak, crest, flatFactor };
  const { badge, verdict } = badgeAndVerdict(metrics, target);
  return { metrics, badge, verdict };
}

// ---------------------------------------------------------------------------
// Mastering — loudnorm two-pass
// ---------------------------------------------------------------------------

export interface LoudnormStats {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

/** Parse the JSON block loudnorm pass 1 prints to stderr (last {...}). */
export function parseLoudnormStats(stderr: string): LoudnormStats | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: Record<string, string>;
  try {
    obj = JSON.parse(stderr.slice(start, end + 1));
  } catch {
    return null;
  }
  const stats: LoudnormStats = {
    input_i: parseFloat(obj.input_i),
    input_tp: parseFloat(obj.input_tp),
    input_lra: parseFloat(obj.input_lra),
    input_thresh: parseFloat(obj.input_thresh),
    target_offset: parseFloat(obj.target_offset),
  };
  return Object.values(stats).every((v) => Number.isFinite(v)) ? stats : null;
}

/**
 * Which normalization loudnorm ACTUALLY performed, read from its own JSON.
 *
 * This is the load-bearing check behind "loudness only, never tone". Pass 2
 * asks for `linear=true`, which applies ONE static gain to the whole file and
 * therefore cannot alter dynamics. But ffmpeg silently DOWNGRADES to dynamic
 * mode when the linear gain would breach the true-peak ceiling — and dynamic
 * mode compresses. Nothing errors; the file just quietly comes back with its
 * range squeezed.
 *
 * So the promise is only verifiable per-file, after the fact. Parse it from the
 * PASS 2 log (what was done), not pass 1 (what was predicted).
 */
export function parseNormalizationType(log: string): 'linear' | 'dynamic' | null {
  const start = log.lastIndexOf('{');
  const end = log.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(log.slice(start, end + 1)) as Record<string, string>;
    const t = obj.normalization_type?.toLowerCase();
    return t === 'linear' || t === 'dynamic' ? t : null;
  } catch {
    return null;
  }
}

/** The pass-2 linear loudnorm filter string from pass-1 measurements. */
export function buildPass2Loudnorm(stats: LoudnormStats, target = -14): string {
  return (
    `loudnorm=I=${target}:TP=-1:LRA=11` +
    `:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}` +
    `:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}` +
    // print_format=json so pass 2 reports what it ACTUALLY did in a parseable
    // form. Without it ffmpeg prints a human-readable summary, parseNormalizationType
    // finds no JSON object and returns null — which is exactly what happened on
    // the first real master (job 0d51a31e, 2026-07-28): LRA was captured but
    // normalizationType came back null, silently disabling the corroborating
    // check on the linear-vs-dynamic guarantee.
    `:offset=${stats.target_offset}:linear=true:print_format=json`
  );
}

/** loudnorm accepts an integrated target in [-70, -5]; outside that ffmpeg errors. */
export const MIN_TARGET_LUFS = -70;
export const MAX_TARGET_LUFS = -5;

export const isValidTarget = (t: unknown): t is number =>
  typeof t === 'number' && Number.isFinite(t) && t >= MIN_TARGET_LUFS && t <= MAX_TARGET_LUFS;

/**
 * S3 key for a mastering output. The target is part of the name so the same
 * source mastered for Spotify (-14) and Apple (-16) yields two files instead of
 * the second silently overwriting the first, and the source extension is
 * replaced rather than appended (`song.wav` → `song-master-14LUFS.wav`, not
 * `song.wav-master.wav`).
 */
export function masterKeyFor(s3Key: string, target: number): string {
  const stem = s3Key.replace(/\.[a-z0-9]+$/i, '');
  return `${stem}-master-${String(Math.abs(target)).replace('.', '_')}LUFS.wav`;
}

/**
 * True if the key is itself a mastering output. Re-mastering one compounds the
 * correction on an already-corrected file, so both routes refuse it. Also
 * matches the legacy `<key>-master.wav` shape written before targets were named.
 */
export function isMasterKey(s3Key: string): boolean {
  return /-master(-\d+(?:_\d+)?LUFS)?\.wav$/i.test(s3Key);
}

// ---------------------------------------------------------------------------
// Source file info — parsed from the header ffmpeg already prints
// ---------------------------------------------------------------------------

/** What the source file actually was, for the report's hand-off record. */
export interface SourceInfo {
  /** e.g. "pcm_s24le". */
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  /** ffmpeg's layout token, e.g. "stereo", "mono", "5.1". */
  channelLayout: string | null;
  /** Bits per sample, from the pcm_sNN codec (16/24/32). */
  bitDepth: number | null;
  durationSec: number | null;
}

/** ffmpeg's channel-layout tokens → a channel count. */
const LAYOUT_CHANNELS: Record<string, number> = {
  mono: 1, stereo: 2, downmix: 2, '2.1': 3, '3.0': 3, quad: 4, '4.0': 4,
  '5.0': 5, '5.1': 6, '6.1': 7, '7.1': 8,
};

/**
 * The `Input #0` header region only.
 *
 * CRITICAL — the same class of trap as the ebur128 Summary above: ffmpeg prints
 * a `Stream #0:0: Audio:` line for the INPUT *and* another for the OUTPUT, and
 * with a loudnorm filter the output line reports loudnorm's internal 192000 Hz
 * working rate. Parsing the whole log would therefore report every source as
 * 192 kHz. Everything from "Stream mapping:"/"Output #" onward is cut away so
 * only the real source header is read.
 */
function inputRegion(stderr: string): string {
  const start = stderr.indexOf('Input #0');
  if (start < 0) return '';
  const rest = stderr.slice(start);
  const ends = [rest.indexOf('Stream mapping:'), rest.indexOf('\nOutput #')].filter((i) => i > 0);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

/**
 * Source format from the header ffmpeg prints anyway during the measurement
 * pass — so the job records "what came in" without spawning ffprobe or a second
 * decode. Returns null when the log carries no usable input header; individual
 * fields are null when only that one is unreadable, so a partial header still
 * yields whatever it did say.
 */
export function parseSourceInfo(stderr: string): SourceInfo | null {
  const region = inputRegion(stderr);
  if (!region) return null;

  // "Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 48000 Hz, 5.1, s32 (24 bit), 6912 kb/s"
  const stream = region.match(/Stream #\d+:\d+(?:\[[^\]]*\])?[^:]*: Audio:\s*([a-z0-9_]+)/i);
  const codec = stream?.[1] ?? null;
  const sampleRate = matchNum(region, /,\s*(\d+)\s*Hz/);
  const layoutMatch = region.match(/\d+\s*Hz,\s*([^,]+?)\s*(?:,|$)/m);
  const channelLayout = layoutMatch?.[1]?.trim() ?? null;

  let channels: number | null = null;
  if (channelLayout) {
    // ffmpeg falls back to "N channels" for layouts it has no name for.
    const explicit = channelLayout.match(/^(\d+)\s+channels?$/i);
    channels = explicit ? Number(explicit[1]) : (LAYOUT_CHANNELS[channelLayout.toLowerCase()] ?? null);
  }

  // Bit depth from the codec (pcm_s24le → 24) rather than the sample-format
  // token: ffmpeg decodes 24-bit PCM into an s32 container and prints
  // "s32 (24 bit)", so the codec is the one that names the file's real depth.
  const depth = codec?.match(/^pcm_[sfu](\d+)/i);
  const bitDepth = depth ? Number(depth[1]) : null;

  // "Duration: 00:03:42.10" (or "N/A" on a stream with no known length).
  const dur = region.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const durationSec = dur
    ? Math.round((Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])) * 10) / 10
    : null;

  const info: SourceInfo = {
    codec,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : null,
    channels,
    channelLayout,
    bitDepth,
    durationSec,
  };
  // An input header with nothing readable in it is worth no more than no header.
  return Object.values(info).some((v) => v !== null) ? info : null;
}

/** The single measurement-pass ffmpeg args (used by measure-fn). */
export function measureArgs(input: string): string[] {
  return [
    '-hide_banner', '-nostats', '-i', input,
    '-af', 'ebur128=peak=true,astats=metadata=1:measure_perchannel=0',
    '-f', 'null', '-',
  ];
}
