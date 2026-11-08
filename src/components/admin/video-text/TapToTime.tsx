'use client';

/**
 * Tap to time the lyrics: the song plays and Raj taps (the big button, or
 * Space) as each line begins. Each tap starts the next line and ends the one
 * before it; after the last line, one more tap ends it. Stop ends the open
 * line where the song is; Cancel puts every line back as it was. Dragging on
 * the timeline fine-tunes afterwards. The arithmetic is timeline.ts
 * (tapLyric / endLyricAt).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { endLyricAt, tapLyric } from '@/lib/video-text/timeline';
import type { TextBlock } from '@/types/videoText';

type Session = { from: number; next: number; open: number | null; snapshot: TextBlock[] };

export interface TapToTimeProps {
  blocks: TextBlock[];
  durationSec: number;
  video: RefObject<HTMLVideoElement | null>;
  onChange(blocks: TextBlock[]): void;
  disabled?: boolean;
}

const BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

export function TapToTime({ blocks, durationSec, video, onChange, disabled }: TapToTimeProps) {
  const lyric = blocks.filter((b) => b.track === 'lyric').sort((a, b) => a.startSec - b.startSec);
  const [startAt, setStartAt] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The latest values for the Space-key handler.
  const live = useRef({ blocks, session });
  live.current = { blocks, session };

  const now = () => video.current?.currentTime ?? 0;

  const start = () => {
    setNote(null);
    setSession({ from: startAt, next: startAt, open: null, snapshot: blocks });
    void video.current?.play()?.catch(() => undefined);
  };

  const finish = useCallback(() => {
    video.current?.pause();
    setSession(null);
  }, [video]);

  const tap = useCallback(() => {
    const { blocks: bs, session: s } = live.current;
    if (!s) return;
    const count = bs.filter((b) => b.track === 'lyric').length;
    const t = video.current?.currentTime ?? 0;
    if (s.next < count) {
      const next = tapLyric(bs, s.next, t, durationSec, { closePrevious: s.open === s.next - 1 });
      if (!next) {
        setNote(
          s.next > 0 && s.open === s.next - 1
            ? 'Too quick — a line shows for at least half a second. Tap again.'
            : 'No room left for the remaining lines before the end of the video.',
        );
        return;
      }
      setNote(null);
      onChange(next);
      setSession({ ...s, next: s.next + 1, open: s.next });
      return;
    }
    // Every line has started: this tap ends the last one.
    if (s.open !== null) {
      const ended = endLyricAt(bs, s.open, t, durationSec);
      if (!ended) {
        setNote('Too quick — a line shows for at least half a second. Tap again.');
        return;
      }
      onChange(ended);
    }
    finish();
    setNote('All lines timed. Drag a block to fine-tune it.');
  }, [durationSec, onChange, finish, video]);

  const stop = () => {
    const { blocks: bs, session: s } = live.current;
    if (s && s.open !== null) {
      const ended = endLyricAt(bs, s.open, now(), durationSec);
      if (ended) onChange(ended);
    }
    finish();
    setNote('Stopped. Lines you did not tap kept their times.');
  };

  const cancel = () => {
    if (session) onChange(session.snapshot);
    finish();
    setNote('Cancelled — every line is back where it was.');
  };

  // Space taps while a session runs (not while typing in a field).
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault(); // not the video's play/pause, not a page scroll
      tap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, tap]);

  if (lyric.length === 0) return null;

  if (!session) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-testid="tap-to-time">
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className={`${BUTTON} border border-orange-600 text-orange-700 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950/40`}
        >
          Tap to time lyrics
        </button>
        <label className="flex min-w-0 items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <span>from line</span>
          <select
            value={Math.min(startAt, lyric.length - 1)}
            onChange={(e) => setStartAt(Number(e.target.value))}
            className="min-w-0 max-w-[14rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            {lyric.map((b, i) => (
              <option key={b.id} value={i}>
                {i + 1}. {b.text}
              </option>
            ))}
          </select>
        </label>
        <p className="w-full text-xs text-gray-500 dark:text-gray-400">
          Put the playhead just before that line, press Tap to time lyrics, and tap Space (or the big button) as each line
          begins.
        </p>
        {note && (
          <p role="status" className="w-full text-sm text-gray-700 dark:text-gray-200">
            {note}
          </p>
        )}
      </div>
    );
  }

  const count = lyric.length;
  const label =
    session.next < count
      ? `Tap: line ${session.next + 1} starts`
      : 'Tap: last line ends';
  const upcoming = session.next < count ? lyric[session.next]?.text : lyric[count - 1]?.text;

  return (
    <div
      className="min-w-0 space-y-2 rounded-md border-2 border-orange-500 bg-orange-50 p-3 dark:bg-orange-950/30"
      data-testid="tap-to-time"
      role="group"
      aria-label="Tap to time"
    >
      <p className="truncate text-sm text-gray-800 dark:text-gray-100" aria-live="polite">
        {session.next < count ? `Line ${session.next + 1} of ${count}: ` : 'Last line: '}
        <span className="font-semibold">{upcoming}</span>
      </p>
      <button
        type="button"
        onClick={tap}
        className={`${BUTTON} w-full bg-orange-600 py-4 text-base text-white hover:bg-orange-700`}
      >
        {label}
      </button>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={stop}
          className={`${BUTTON} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200`}
        >
          Stop
        </button>
        <button
          type="button"
          onClick={cancel}
          className={`${BUTTON} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200`}
        >
          Cancel
        </button>
      </div>
      {note && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
    </div>
  );
}
