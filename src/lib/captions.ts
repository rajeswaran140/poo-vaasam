/**
 * Caption generation from structured {@link Lyrics}.
 *
 * Turns a song's stored lyrics into SRT / WebVTT cues — the unblocked core of
 * the "captions" component: the file is useful immediately (manual upload in
 * YouTube Studio, on-site <track>, karaoke), and is exactly what the eventual
 * captions.insert API call will carry once a youtube.force-ssl token is wired.
 *
 * Two timing modes:
 *  - SYNCED: when lines carry `startSeconds`, those drive cue starts (each cue
 *    runs until the next synced line, capped at the track end).
 *  - EVEN: with no timestamps, lines are distributed evenly across the track so
 *    a usable caption track exists even before anyone hand-syncs the lyrics.
 *
 * Pure + unit-tested. No I/O.
 */

import { Lyrics } from '@/domain/songs/Lyrics';

export interface CaptionCue {
  /** Cue start, seconds. */
  start: number;
  /** Cue end, seconds. */
  end: number;
  text: string;
}

export interface CaptionOptions {
  /** Total track length, seconds — bounds the last cue / even distribution. */
  totalSec: number;
  /** Minimum cue duration in the synced path (avoids fl. defaults to 1s). */
  minCueSec?: number;
}

/** Format seconds as HH:MM:SS<sep>mmm (SRT uses ',', WebVTT uses '.'). */
export function formatTimestamp(seconds: number, sep: ',' | '.'): string {
  const clamped = Math.max(0, seconds);
  const ms = Math.round(clamped * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(millis, 3)}`;
}

/** Flattened lyric lines in document order (sections concatenated). */
function flatLines(lyrics: Lyrics): { text: string; startSeconds?: number }[] {
  return lyrics.sections.flatMap((sec) =>
    sec.lines.map((l) => ({ text: l.text, startSeconds: l.startSeconds }))
  );
}

/**
 * Build caption cues from lyrics. Returns [] for empty lyrics or a non-positive
 * total. Uses per-line timestamps when present, otherwise distributes evenly.
 */
export function lyricsToCues(lyrics: Lyrics, opts: CaptionOptions): CaptionCue[] {
  const totalSec = opts.totalSec;
  const minCue = opts.minCueSec ?? 1;
  const lines = flatLines(lyrics);
  if (lines.length === 0 || !(totalSec > 0)) return [];

  if (lyrics.isTimeSynced()) {
    // Keep only timed lines, in order; each runs until the next timed start.
    const timed = lines
      .filter((l): l is { text: string; startSeconds: number } => typeof l.startSeconds === 'number')
      .sort((a, b) => a.startSeconds - b.startSeconds);
    return timed.map((line, i) => {
      const start = Math.min(line.startSeconds, totalSec);
      const nextStart = i + 1 < timed.length ? timed[i + 1].startSeconds : totalSec;
      const end = Math.min(totalSec, Math.max(nextStart, start + minCue));
      return { start, end, text: line.text };
    });
  }

  // Even distribution across the track.
  const slice = totalSec / lines.length;
  return lines.map((line, i) => ({
    start: i * slice,
    end: (i + 1) * slice,
    text: line.text,
  }));
}

/** Serialise cues as SubRip (.srt). */
export function toSRT(cues: CaptionCue[]): string {
  return cues
    .map((cue, i) => {
      const range = `${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}`;
      return `${i + 1}\n${range}\n${cue.text}`;
    })
    .join('\n\n');
}

/** Serialise cues as WebVTT (.vtt) — leads with the required WEBVTT header. */
export function toWebVTT(cues: CaptionCue[]): string {
  const body = cues
    .map((cue) => `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n${cue.text}`)
    .join('\n\n');
  return body ? `WEBVTT\n\n${body}` : 'WEBVTT\n';
}
