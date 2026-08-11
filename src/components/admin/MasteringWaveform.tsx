'use client';

/**
 * Canvas waveform scrubber for the mastering audition player.
 *
 * WHY CANVAS. The previous SVG version emitted 240 <rect> nodes and re-rendered
 * the whole tree every time the playhead moved (~10x/second while playing).
 * Here the bars are drawn ONCE per resize into two offscreen canvases — one in
 * the unplayed colour, one in the played colour — and each frame composites
 * them with a single clip rect. Two drawImage calls, no per-bar arithmetic in
 * the animation loop, so scrubbing a long master stays smooth.
 *
 * The parent still owns the <audio> element, the rAF loop and the loop region;
 * this draws and reports gestures. It never touches audio itself.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  bucketsForWidth,
  describePosition,
  formatTime,
  ratioToTime,
  resamplePeaks,
  seekTargetForKey,
  type LoopRegion,
} from '@/lib/waveform';

interface Props {
  peaks: readonly number[];
  duration: number;
  position: number;
  loop: LoopRegion | null;
  /** Seek to an absolute time (seconds). */
  onSeek: (seconds: number) => void;
  /** A drag across the waveform proposes a loop region. */
  onLoopDrag: (fromSeconds: number, toSeconds: number) => void;
  height?: number;
  /**
   * Times (seconds) the engineer flagged a problem at.
   *
   * They belong ON the picture: a mark is a claim about a MOMENT, and reading
   * it from a list underneath means translating "1:15" back into a position by
   * eye every time. Drawn, the distribution is visible at a glance — three
   * marks clustered in one phrase is a different problem from three scattered.
   */
  marks?: readonly number[];
  /**
   * False when this waveform is not a transport.
   *
   * The trim panel draws the same picture but has no playhead — announcing it
   * as a slider parked at 0:00, with arrow keys wired to a no-op seek, would
   * describe a control that does not exist. In that mode it becomes an image
   * and the numeric inputs beside it carry the keyboard interaction; the drag
   * gesture stays as a pointer convenience.
   */
  interactive?: boolean;
  /** Overrides the default slider label; also used as the image label. */
  ariaLabel?: string;
}

/** devicePixelRatio is capped: beyond 2 the extra pixels cost memory and buy nothing. */
const MAX_DPR = 2;
const UNPLAYED = 'rgba(168, 85, 247, 0.45)';
const PLAYED = '#D3A548';
const LOOP_FILL = 'rgba(16, 185, 129, 0.22)';
/** The playhead itself — the colour boundary alone reads as a fill edge, not a position. */
const PLAYHEAD = '#F2F4F8';
/** A marked problem point. Amber so it never reads as the emerald loop region. */
const MARK_LINE = '#FFC453';

/**
 * The waveform is the visual centre: it is the only element that says WHERE
 * something happens. Peak and RMS are 8px supporting bars. Raised from 64 after
 * Raj read the three regions as competing.
 */
export const DEFAULT_WAVEFORM_HEIGHT = 84;

export function MasteringWaveform({
  peaks,
  duration,
  position,
  loop,
  onSeek,
  onLoopDrag,
  height = DEFAULT_WAVEFORM_HEIGHT,
  marks = [],
  interactive = true,
  ariaLabel,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layersRef = useRef<{ unplayed: HTMLCanvasElement; played: HTMLCanvasElement } | null>(null);
  const sizeRef = useRef({ w: 0, h: height, dpr: 1 });
  const dragFrom = useRef<number | null>(null);
  const hoverRef = useRef<HTMLDivElement | null>(null);

  /** Draw the bars once per size change, into two colour layers. */
  const buildLayers = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth;
    if (w <= 0) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    sizeRef.current = { w, h: height, dpr };

    const buckets = resamplePeaks(peaks, bucketsForWidth(w));
    const make = (colour: string) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(w * dpr));
      c.height = Math.max(1, Math.floor(height * dpr));
      const g = c.getContext('2d');
      if (!g) return c;
      g.scale(dpr, dpr);
      g.fillStyle = colour;
      const mid = height / 2;
      buckets.forEach((p, i) => {
        const x = i * 3;
        const h = Math.max(1, p * (height - 4));
        g.fillRect(x, mid - h / 2, 2, h);
      });
      return c;
    };
    layersRef.current = { unplayed: make(UNPLAYED), played: make(PLAYED) };

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
    }
  }, [peaks, height]);

  /** Composite: loop region, unplayed layer, played layer clipped to the playhead. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const layers = layersRef.current;
    if (!canvas || !layers) return;
    const { w, h, dpr } = sizeRef.current;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    if (loop && duration > 0) {
      g.fillStyle = LOOP_FILL;
      const x = (loop.start / duration) * w;
      g.fillRect(x, 0, ((loop.end - loop.start) / duration) * w, h);
    }
    g.drawImage(layers.unplayed, 0, 0, w, h);
    const ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    if (ratio > 0) {
      g.save();
      g.beginPath();
      g.rect(0, 0, w * ratio, h);
      g.clip();
      g.drawImage(layers.played, 0, 0, w, h);
      g.restore();
    }

    // Marks first, so the playhead stays readable when it sits on one.
    if (duration > 0 && marks.length) {
      g.fillStyle = MARK_LINE;
      for (const t of marks) {
        const x = Math.round((Math.min(Math.max(t, 0), duration) / duration) * w);
        g.fillRect(x - 1, 0, 2, h);
        // A small cap makes a mark findable even against a busy waveform.
        g.fillRect(x - 3, 0, 6, 3);
      }
    }

    // The playhead. The played/unplayed colour boundary shows how FAR along the
    // track is, but it reads as the edge of a fill rather than a position — and
    // at a quiet passage, where both layers are near-silent, there is nothing
    // to see at all.
    if (duration > 0 && ratio > 0) {
      const x = Math.round(w * ratio);
      g.fillStyle = PLAYHEAD;
      g.fillRect(x - 0.5, 0, 1.5, h);
    }
  }, [loop, duration, position, marks]);

  useEffect(() => {
    buildLayers();
    paint();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      buildLayers();
      paint();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [buildLayers, paint]);

  // Repaint on playhead/loop change. This is a composite of two ready-made
  // images, not a re-render of the bars, so it is cheap enough to run per tick.
  useEffect(() => {
    paint();
  }, [paint]);

  const timeAt = (clientX: number): number => {
    const host = hostRef.current;
    if (!host || duration <= 0) return 0;
    const r = host.getBoundingClientRect();
    return ratioToTime((clientX - r.left) / r.width, duration);
  };

  return (
    <div
      ref={hostRef}
      role={interactive ? 'slider' : 'img'}
      aria-label={ariaLabel ?? 'Waveform — click to seek, drag to set a loop'}
      {...(interactive
        ? {
            'aria-valuemin': 0,
            'aria-valuemax': Math.max(0, Math.round(duration)),
            'aria-valuenow': Math.round(position),
            'aria-valuetext': describePosition(position, duration),
            tabIndex: 0,
          }
        : {})}
      className="relative w-full cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      style={{ height }}
      // Pointer Events + capture, so a drag that leaves the element still
      // completes — mouse events alone drop the gesture on touch.
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragFrom.current = timeAt(e.clientX);
      }}
      onPointerMove={(e) => {
        const el = hoverRef.current;
        if (!el) return;
        const r = e.currentTarget.getBoundingClientRect();
        el.style.left = `${e.clientX - r.left}px`;
        el.textContent = formatTime(timeAt(e.clientX));
        el.hidden = false;
      }}
      onPointerLeave={() => {
        if (hoverRef.current) hoverRef.current.hidden = true;
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        const to = timeAt(e.clientX);
        const from = dragFrom.current;
        dragFrom.current = null;
        if (from === null) return;
        if (Math.abs(to - from) < 0.25) onSeek(to);
        else onLoopDrag(from, to);
      }}
      onKeyDown={(e) => {
        // A role="slider" that ignores arrow keys is a slider in name only.
        const target = seekTargetForKey(e.key, position, duration);
        if (target === null) return;
        e.preventDefault();
        e.stopPropagation();
        onSeek(target);
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
      <div
        ref={hoverRef}
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute top-0 h-full border-l border-gray-900/60 pl-1 text-[10px] tabular-nums text-gray-700 dark:border-white/60 dark:text-gray-200"
      />
    </div>
  );
}
