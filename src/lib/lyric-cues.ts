/**
 * lyric-cues — parse an SRT lyric track and select the cues that fall inside a
 * clip window, shifted to clip-relative time. Used by generate-song-short.ts to
 * burn synchronised lyrics onto a hook clip. Pure + framework-free so it's unit
 * testable without ffmpeg.
 */

export interface LyricCue {
  /** seconds from the start of the source track */
  start: number;
  end: number;
  text: string;
}

export interface WindowedCue {
  /** seconds from the start of the CLIP (i.e. cue.start - windowStart, clamped) */
  start: number;
  end: number;
  text: string;
}

const TS = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

function toSeconds(m: RegExpMatchArray): number {
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** Parse SubRip (.srt) text into cues. Tolerates `.` or `,` ms separators and CRLF. */
export function parseSrt(srt: string): LyricCue[] {
  const cues: LyricCue[] = [];
  const blocks = srt.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx < 0) continue;
    const [a, b] = lines[arrowIdx].split('-->');
    const ma = a.match(TS);
    const mb = b.match(TS);
    if (!ma || !mb) continue;
    const text = lines
      .slice(arrowIdx + 1)
      .join('\n')
      .trim();
    if (!text) continue;
    cues.push({ start: toSeconds(ma), end: toSeconds(mb), text });
  }
  return cues;
}

/**
 * Return the cues overlapping [windowStart, windowStart+windowDur), with times
 * shifted to clip-relative and clamped to the window. Cues left with under
 * `minVisible` seconds on screen are dropped (they'd only flash).
 */
export function selectWindowCues(
  cues: LyricCue[],
  windowStart: number,
  windowDur: number,
  minVisible = 0.3,
): WindowedCue[] {
  const windowEnd = windowStart + windowDur;
  const out: WindowedCue[] = [];
  for (const c of cues) {
    if (c.end <= windowStart || c.start >= windowEnd) continue;
    const start = Math.max(c.start, windowStart) - windowStart;
    const end = Math.min(c.end, windowEnd) - windowStart;
    if (end - start < minVisible) continue;
    out.push({ start, end, text: c.text });
  }
  return out;
}
