'use client';

/**
 * The Video Text timeline: Title, Lyrics and Credits rows under a seconds
 * ruler, Premiere-style.
 *
 * - Drag a block's body to move it, its edges to change start or end. Edge
 *   handles shrink on narrow blocks and vanish under 16 px, so a short block
 *   (the 5 s title on a whole-song view) can always be moved.
 * - Click a block to select it: Start/End boxes under the tracks take a typed
 *   time, and buttons set either edge (or move the block) to the playhead.
 *   Every drag is computed from the blocks as they were at pointerdown plus
 *   the pointer's travel, so a clamp at a neighbour never "sticks".
 * - A focused block: ←/→ nudge 0.1 s (Shift = 1 s); [ and ] move its start or
 *   end to the playhead. A focused edge handle: ←/→ move that edge.
 * - Pulling an edge into a neighbour it touches moves the shared boundary
 *   (a rolling edit); pulling it away leaves a gap.
 * - Click (tap) the ruler to seek; a swipe on it scrolls. Zoom runs from
 *   "whole song fits" to 40 px/s and keeps the playhead where it was on
 *   screen; while the song plays the view follows the playhead.
 * - It scrolls sideways inside its own box; the page never does.
 * - In and Out marks (cut.ts): the parts outside them are shaded, and the
 *   two handles on the ruler drag them (←/→ on a focused one: a frame, Shift
 *   = 1 s). Setting them is CutMarks, beside the timeline.
 *
 * All the arithmetic (clamping, minimum length, rounding) is timeline.ts.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { dragEdge, moveBlock, sameBlocks } from '@/lib/video-text/timeline';
import { cutRange, dragMark } from '@/lib/video-text/cut';
import type { Cut, TextBlock, Track } from '@/types/videoText';

const MAX_PX_PER_SEC = 40;
/** Width of the grab handles a selected thin block gets outside its edges. */
const OUTSIDE_HANDLE_PX = 10;
/** Pointer travel before a press on a block becomes a drag. */
const DRAG_DEAD_ZONE_PX = 4;
const FALLBACK_WIDTH = 600;
const LABEL_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

const ROWS: { track: Track; label: string }[] = [
  { track: 'title', label: 'Title' },
  { track: 'lyric', label: 'Lyrics' },
  { track: 'credits', label: 'Credits' },
];

const TRACK_STYLE: Record<Track, string> = {
  title: 'bg-violet-100 border-violet-300 text-violet-900 dark:bg-violet-900/50 dark:border-violet-700 dark:text-violet-100',
  lyric: 'bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-900/40 dark:border-orange-700 dark:text-orange-100',
  credits: 'bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-900/50 dark:border-sky-700 dark:text-sky-100',
};

/** 65.3 → "1:05.3" */
export function formatTime(sec: number): string {
  const tenths = Math.max(0, Math.round(sec * 10));
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * "12.5", "0:12.5", "1:05", "1:02:03" → seconds; null when it isn't a time.
 * The inverse of formatTime.
 */
export function parseTime(input: string): number | null {
  const t = input.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d*)?$/.test(t) && !/^\d*\.\d+$/.test(t)) return null;
  const parts = t.split(':');
  const secPart = Number(parts.pop());
  if (!Number.isFinite(secPart) || (parts.length > 0 && secPart >= 60)) return null;
  let total = secPart;
  let mult = 60;
  while (parts.length) {
    const n = Number(parts.pop());
    if (parts.length > 0 && n >= 60) return null;
    total += n * mult;
    mult *= 60;
  }
  return Math.round(total * 100) / 100;
}

/** Edge handle width for a block this many px wide: 8 px, 4 px under 32 px, none under 16 px. */
export function handleWidth(blockPx: number): number {
  return blockPx >= 32 ? 8 : blockPx >= 16 ? 4 : 0;
}

const tickLabel = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

type Drag = {
  id: string;
  mode: 'move' | 'start' | 'end';
  x: number;
  pointerId: number;
  /**
   * Taken at the first pointermove, not at pointerdown: pressing on a block
   * blurs a Start/End box, and that blur commits a typed time AFTER
   * pointerdown. Snapshotting then would drop the typed time.
   */
  base: TextBlock[] | null;
  from: number;
};

export interface TimelineProps {
  blocks: TextBlock[];
  durationSec: number;
  playheadSec: number;
  onChange(blocks: TextBlock[]): void;
  onSeek(sec: number): void;
  /** In and Out; absent or null is the whole video. */
  cut?: Cut | null;
  /** The video's frame rate: the marks snap to its frames. */
  fps?: number;
  onCutChange?(cut: Cut | null): void;
}

export function Timeline({ blocks, durationSec, playheadSec, onChange, onSeek, cut = null, fps = 25, onCutChange }: TimelineProps) {
  const duration = Math.max(1, durationSec);
  const scroller = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const latestBlocks = useRef(blocks);
  latestBlocks.current = blocks;
  /** Why the last drag or nudge did nothing (a line boxed in by its neighbours). */
  const [hint, setHint] = useState<string | null>(null);

  /** Pass an edit on only when it changes something: a no-op must not mark the video out of date. */
  const emit = (next: TextBlock[]) => {
    if (sameBlocks(latestBlocks.current, next)) return false;
    setHint(null);
    onChange(next);
    return true;
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitPx = (boxWidth || FALLBACK_WIDTH) / duration;
  const maxPx = Math.max(fitPx, MAX_PX_PER_SEC);
  // Zoom is stored as 0..1 between fit and max so a resize keeps "fits" fitting.
  const [zoom, setZoom] = useState(0);
  const pps = fitPx + (maxPx - fitPx) * zoom;
  const innerWidth = duration * pps;

  // Zoom keeps a time fixed on screen: the playhead when it is in view, else
  // the middle of the view. Applied after the new width is laid out.
  const zoomAnchor = useRef<{ sec: number; screenX: number } | null>(null);
  const changeZoom = (z: number) => {
    const el = scroller.current;
    if (el) {
      const w = el.clientWidth || FALLBACK_WIDTH;
      const headX = Math.min(Math.max(0, playheadSec), duration) * pps - el.scrollLeft;
      const screenX = headX >= 0 && headX <= w ? headX : w / 2;
      zoomAnchor.current = { sec: (el.scrollLeft + screenX) / pps, screenX };
    }
    setZoom(z);
  };
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scroller.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, a.sec * pps - a.screenX);
  }, [pps]);

  // Follow the playhead when it leaves the view (playback, Tap to time, a
  // seek), never while a block is being dragged.
  useEffect(() => {
    const el = scroller.current;
    if (!el || drag.current) return;
    const w = el.clientWidth;
    if (!w || innerWidth <= w) return;
    const x = Math.min(Math.max(0, playheadSec), duration) * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + w - 8) el.scrollLeft = Math.max(0, x - w * 0.25);
  }, [playheadSec, pps, innerWidth, duration]);

  const ticks = useMemo(() => {
    // Labelled ticks at least 48 px apart; unlabelled second (or 5 s) ticks between.
    const step = LABEL_STEPS.find((s) => s * pps >= 48) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
    const minor = pps >= 6 ? 1 : pps >= 1.5 && step > 5 ? 5 : step;
    const out: { sec: number; major: boolean }[] = [];
    for (let t = 0; t <= duration; t += minor) out.push({ sec: t, major: t % step === 0 });
    return out;
  }, [pps, duration]);

  // Keep a selection that still exists.
  const selectedId = blocks.some((b) => b.id === selected) ? selected : null;
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;

  const lyricNumber = useMemo(() => {
    const m = new Map<string, number>();
    blocks
      .filter((b) => b.track === 'lyric')
      .sort((a, b) => a.startSec - b.startSec)
      .forEach((b, i) => m.set(b.id, i + 1));
    return m;
  }, [blocks]);

  const nameOf = (b: TextBlock) =>
    b.track === 'lyric' ? `lyric ${lyricNumber.get(b.id) ?? ''}`.trim() : b.track === 'title' ? 'title' : 'credits';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const beginDrag = (e: PointerEvent<HTMLElement>, b: TextBlock, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(b.id);
    drag.current = { id: b.id, mode, x: e.clientX, pointerId: e.pointerId, base: null, from: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // A tap that wobbles a few px is a tap, not a drag (at fit zoom on a
    // phone, 3 px can be several seconds).
    if (!d.base && Math.abs(e.clientX - d.x) < DRAG_DEAD_ZONE_PX) return;
    if (!d.base) {
      const now = latestBlocks.current.find((b) => b.id === d.id);
      if (!now) return;
      d.base = latestBlocks.current;
      d.from = d.mode === 'end' ? now.endSec : now.startSec;
    }
    const sec = d.from + (e.clientX - d.x) / pps;
    const next = d.mode === 'move' ? moveBlock(d.base, d.id, sec, durationSec) : dragEdge(d.base, d.id, d.mode, sec, durationSec);
    if (d.mode === 'move' && sameBlocks(d.base, next) && Math.abs(sec - d.from) >= 0.05) noRoom(d.id);
    emit(next);
  };

  const noRoom = (id: string) => {
    const b = latestBlocks.current.find((x) => x.id === id);
    if (b) setHint(`${cap(nameOf(b))} touches its neighbours, so it can't move. Drag its edge to make room, or shorten a neighbour.`);
  };

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  const onBlockKey = (e: KeyboardEvent<HTMLElement>, b: TextBlock) => {
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (!emit(moveBlock(blocks, b.id, b.startSec + (e.key === 'ArrowRight' ? step : -step), durationSec))) noRoom(b.id);
    } else if (e.key === '[') {
      e.preventDefault();
      emit(dragEdge(blocks, b.id, 'start', playheadSec, durationSec));
    } else if (e.key === ']') {
      e.preventDefault();
      emit(dragEdge(blocks, b.id, 'end', playheadSec, durationSec));
    }
  };

  const onEdgeKey = (e: KeyboardEvent<HTMLElement>, b: TextBlock, edge: 'start' | 'end') => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowRight' ? 1 : -1);
    const at = edge === 'start' ? b.startSec : b.endSec;
    emit(dragEdge(blocks, b.id, edge, at + step, durationSec));
  };

  // A click, not a pointerdown: on a phone a swipe on the ruler scrolls the
  // timeline (the browser cancels the click) instead of moving the song.
  const seekFromRuler = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(durationSec, Math.max(0, (e.clientX - rect.left) / pps)));
  };

  const playheadX = Math.min(Math.max(0, playheadSec), duration) * pps;

  // ---- In / Out handles
  const inner = useRef<HTMLDivElement>(null);
  /** `grab`: seconds between the pointer and the mark at pointerdown, so the mark does not jump to the pointer. */
  const markDrag = useRef<{ kind: 'in' | 'out'; pointerId: number; grab: number } | null>(null);
  const latestCut = useRef(cut);
  latestCut.current = cut;
  const setMark = (kind: 'in' | 'out', sec: number) => {
    if (!onCutChange) return;
    const c = latestCut.current;
    // A handle stops a second short of the other mark; it never moves it.
    const next = dragMark(c, kind, sec, durationSec, fps);
    if (JSON.stringify(next) !== JSON.stringify(c)) onCutChange(next);
  };
  const beginMarkDrag = (e: PointerEvent<HTMLElement>, kind: 'in' | 'out') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = inner.current?.getBoundingClientRect();
    const r = cutRange(latestCut.current, durationSec);
    const at = kind === 'in' ? r.inSec : r.outSec;
    markDrag.current = { kind, pointerId: e.pointerId, grab: rect ? (e.clientX - rect.left) / pps - at : 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMarkMove = (e: PointerEvent<HTMLElement>) => {
    const d = markDrag.current;
    const rect = inner.current?.getBoundingClientRect();
    if (!d || d.pointerId !== e.pointerId || !rect) return;
    setMark(d.kind, Math.min(durationSec, Math.max(0, (e.clientX - rect.left) / pps - d.grab)));
  };
  const endMarkDrag = (e: PointerEvent<HTMLElement>) => {
    if (markDrag.current?.pointerId === e.pointerId) markDrag.current = null;
  };
  const onMarkKey = (e: KeyboardEvent<HTMLElement>, kind: 'in' | 'out', at: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 1 / fps) * (e.key === 'ArrowRight' ? 1 : -1);
    setMark(kind, at + step);
  };
  const range = cutRange(cut, durationSec);
  // Flags sit inside the kept part; when it is too narrow for both, they go
  // outside it, so neither covers the other.
  const FLAG_PX = 12;
  const flagsOutside = (range.outSec - range.inSec) * pps < FLAG_PX * 2;
  const flagLeft = (kind: 'in' | 'out', at: number) => {
    const x = kind === 'in' ? (flagsOutside ? at * pps - FLAG_PX : at * pps) : flagsOutside ? at * pps : at * pps - FLAG_PX;
    return Math.min(Math.max(0, x), Math.max(0, innerWidth - FLAG_PX));
  };

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0">
        {/* Row labels stay put; only the tracks scroll. */}
        <div className="w-16 shrink-0 pt-6 text-xs font-medium text-gray-500 dark:text-gray-400" aria-hidden="true">
          {ROWS.map((r) => (
            <div key={r.track} className="flex h-10 items-center">
              <span>{r.label}</span>
            </div>
          ))}
        </div>

        <div
          ref={scroller}
          className="relative min-w-0 flex-1 overflow-x-auto overscroll-x-contain rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950"
          data-testid="timeline-scroller"
        >
          <div ref={inner} className="relative" style={{ width: innerWidth }}>
            {/* Ruler: click to seek. */}
            <div
              className="relative h-6 cursor-pointer border-b border-gray-200 dark:border-gray-700"
              onClick={seekFromRuler}
              data-testid="timeline-ruler"
            >
              {ticks.map((t) => (
                <div
                  key={t.sec}
                  className={`absolute bottom-0 w-px ${t.major ? 'h-3 bg-gray-400 dark:bg-gray-500' : 'h-1.5 bg-gray-300 dark:bg-gray-700'}`}
                  style={{ left: t.sec * pps }}
                >
                  {t.major && (
                    <span className="absolute -top-3.5 left-1 select-none whitespace-nowrap text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                      {tickLabel(t.sec)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {ROWS.map((r) => (
              <div
                key={r.track}
                role="group"
                aria-label={`${r.label} row`}
                className="relative h-10 border-b border-gray-100 last:border-b-0 dark:border-gray-800"
              >
                {blocks
                  .filter((b) => b.track === r.track)
                  .map((b) => {
                    const name = nameOf(b);
                    const isSel = b.id === selectedId;
                    const blockPx = Math.max(2, (b.endSec - b.startSec) * pps);
                    const hw = handleWidth(blockPx);
                    return (
                      <div
                        key={b.id}
                        role="slider"
                        tabIndex={0}
                        aria-label={`${cap(name)}: ${b.text}`}
                        aria-valuemin={0}
                        aria-valuemax={durationSec}
                        aria-valuenow={b.startSec}
                        aria-valuetext={`${formatTime(b.startSec)} to ${formatTime(b.endSec)}`}
                        title={b.text}
                        onFocus={() => setSelected(b.id)}
                        onKeyDown={(e) => onBlockKey(e, b)}
                        onPointerDown={(e) => beginDrag(e, b, 'move')}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        className={`absolute top-1 bottom-1 cursor-grab touch-none select-none rounded border px-2 text-[11px] leading-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${TRACK_STYLE[b.track]} ${isSel ? 'z-10 ring-2 ring-orange-500 dark:ring-orange-400' : ''}`}
                        style={{ left: b.startSec * pps, width: blockPx }}
                      >
                        <span className="pointer-events-none block truncate">{b.text}</span>
                        {(['start', 'end'] as const).map((edge) => (
                          <div
                            key={edge}
                            role="slider"
                            tabIndex={isSel ? 0 : -1}
                            aria-label={`${edge === 'start' ? 'Start' : 'End'} of ${name}`}
                            aria-valuemin={0}
                            aria-valuemax={durationSec}
                            aria-valuenow={edge === 'start' ? b.startSec : b.endSec}
                            aria-valuetext={formatTime(edge === 'start' ? b.startSec : b.endSec)}
                            onKeyDown={(e) => onEdgeKey(e, b, edge)}
                            onFocus={(e) => e.stopPropagation()}
                            // Move/up bubble to the block, which handles every drag.
                            onPointerDown={(e) => beginDrag(e, b, edge)}
                            data-testid={`edge-${edge}`}
                            // Under 16 px there is no room inside: an unselected block's handles
                            // are 0 px (the body moves it); a SELECTED one gets handles just
                            // outside its edges, so a thin block can still be stretched.
                            // Always mounted, so a focused edge keeps focus and arrow keys.
                            style={
                              hw > 0
                                ? { width: hw }
                                : isSel
                                  ? { width: OUTSIDE_HANDLE_PX, [edge === 'start' ? 'left' : 'right']: -OUTSIDE_HANDLE_PX }
                                  : { width: 0, pointerEvents: 'none' }
                            }
                            className={`absolute top-0 bottom-0 cursor-ew-resize touch-none focus:outline-none focus-visible:bg-orange-500/40 ${
                              hw === 0 && isSel
                                ? `bg-orange-500 ${edge === 'start' ? 'rounded-l' : 'rounded-r'}`
                                : `hover:bg-black/10 dark:hover:bg-white/10 ${edge === 'start' ? 'left-0' : 'right-0'}`
                            }`}
                          />
                        ))}
                      </div>
                    );
                  })}
              </div>
            ))}

            {/* In and Out: outside them is shaded (not in the video); the handles sit on the ruler. */}
            {cut && (
              <>
                {range.inSec > 0 && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 left-0 z-[15] bg-gray-900/45 dark:bg-black/60"
                    style={{ width: range.inSec * pps }}
                    data-testid="cut-shade-in"
                  />
                )}
                {range.outSec < durationSec && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-[15] bg-gray-900/45 dark:bg-black/60"
                    style={{ left: range.outSec * pps, width: Math.max(0, (duration - range.outSec) * pps) }}
                    data-testid="cut-shade-out"
                  />
                )}
                {(['in', 'out'] as const).map((kind) => {
                  const at = kind === 'in' ? range.inSec : range.outSec;
                  return (
                    <div
                      key={kind}
                      role="slider"
                      tabIndex={0}
                      aria-label={kind === 'in' ? 'In mark' : 'Out mark'}
                      aria-valuemin={0}
                      aria-valuemax={durationSec}
                      aria-valuenow={at}
                      aria-valuetext={formatTime(at)}
                      title={`${kind === 'in' ? 'In' : 'Out'} ${formatTime(at)} — drag to move`}
                      onPointerDown={(e) => beginMarkDrag(e, kind)}
                      onPointerMove={onMarkMove}
                      onPointerUp={endMarkDrag}
                      onPointerCancel={endMarkDrag}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => onMarkKey(e, kind, at)}
                      data-testid={`cut-${kind}`}
                      className={`absolute top-0 z-30 flex h-6 w-3 cursor-ew-resize touch-none select-none items-center justify-center bg-emerald-600 text-[9px] font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                        kind === 'in' ? 'rounded-l' : 'rounded-r'
                      }`}
                      style={{ left: flagLeft(kind, at) }}
                    >
                      {kind === 'in' ? 'I' : 'O'}
                    </div>
                  );
                })}
              </>
            )}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-500"
              style={{ left: playheadX }}
              data-testid="timeline-playhead"
            />
          </div>
        </div>
      </div>

      {hint && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400" data-testid="timeline-hint">
          {hint}
        </p>
      )}

      {selectedBlock ? (
        <BlockTimes
          key={selectedBlock.id}
          block={selectedBlock}
          name={cap(nameOf(selectedBlock))}
          blocks={blocks}
          durationSec={durationSec}
          playheadSec={playheadSec}
          onChange={onChange}
        />
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Drag a block to move it, or click it to type its start and end times.
        </p>
      )}

      <label className="flex min-w-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>Zoom</span>
        <input
          type="range"
          aria-label="Zoom"
          min={0}
          max={1}
          step={0.01}
          value={zoom}
          onChange={(e) => changeZoom(Number(e.target.value))}
          className="w-40 min-w-0 accent-orange-600"
        />
      </label>
    </div>
  );
}

const SMALL_BUTTON =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';

/** One time box: shows the block's time, commits a typed one on Enter or blur. */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit(sec: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  // The block's time changed from elsewhere (a drag, a nudge): show it, and
  // drop a rejected entry rather than leave a stale red box.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(null);
    setBad(false);
  }
  // Selecting another block unmounts this box, and a removed input may never
  // blur: commit a valid typed time on the way out.
  const pending = useRef<{ draft: string | null; onCommit(sec: number): void }>({ draft, onCommit });
  pending.current = { draft, onCommit };
  useEffect(
    () => () => {
      const { draft: d, onCommit: commitNow } = pending.current;
      const sec = d === null ? null : parseTime(d);
      if (sec !== null) commitNow(sec);
    },
    [],
  );
  const commit = () => {
    if (draft === null) return;
    const sec = parseTime(draft);
    if (sec === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(null);
    onCommit(sec);
  };
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? formatTime(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(null);
            setBad(false);
          }
        }}
        aria-invalid={bad || undefined}
        className={`w-20 rounded-md border px-2 py-1 text-xs tabular-nums dark:bg-gray-900 ${
          bad ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'
        }`}
      />
    </label>
  );
}

function BlockTimes({
  block,
  name,
  blocks,
  durationSec,
  playheadSec,
  onChange,
}: {
  block: TextBlock;
  name: string;
  blocks: TextBlock[];
  durationSec: number;
  playheadSec: number;
  onChange(blocks: TextBlock[]): void;
}) {
  const [note, setNote] = useState<string | null>(null);
  // Apply a change; say so when a neighbour or the video's end stopped it short.
  const apply = (next: TextBlock[], wanted: { start?: number; end?: number }) => {
    const after = next.find((b) => b.id === block.id) ?? block;
    const startOff = wanted.start !== undefined && Math.abs(after.startSec - wanted.start) > 0.005;
    const endOff = wanted.end !== undefined && Math.abs(after.endSec - wanted.end) > 0.005;
    setNote(
      startOff || endOff
        ? `Stopped at ${formatTime(startOff ? after.startSec : after.endSec)}: a block can't overlap its neighbour, run past the end, or be shorter than half a second.`
        : null,
    );
    if (!sameBlocks(blocks, next)) onChange(next);
  };
  const setStart = (sec: number) => apply(dragEdge(blocks, block.id, 'start', sec, durationSec), { start: sec });
  const setEnd = (sec: number) => apply(dragEdge(blocks, block.id, 'end', sec, durationSec), { end: sec });
  const moveTo = (sec: number) => apply(moveBlock(blocks, block.id, sec, durationSec), { start: sec });
  /** From 0 to the end of the video. Lyric lines can't: they would cover their neighbours. */
  const wholeVideo = () => {
    const end = Math.floor(durationSec * 100) / 100;
    const widened = dragEdge(dragEdge(blocks, block.id, 'start', 0, durationSec), block.id, 'end', end, durationSec);
    apply(widened, { start: 0, end });
  };

  return (
    <div
      role="group"
      aria-label={`Times for ${name}`}
      data-testid="block-times"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/60"
    >
      <span className="min-w-0 max-w-full truncate text-xs font-semibold text-gray-800 dark:text-gray-100" title={block.text}>
        {name}: {block.text}
      </span>
      <TimeField label="Start" value={block.startSec} onCommit={setStart} />
      <TimeField label="End" value={block.endSec} onCommit={setEnd} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SMALL_BUTTON} onClick={() => setStart(playheadSec)}>
          Start at playhead
        </button>
        <button type="button" className={SMALL_BUTTON} onClick={() => setEnd(playheadSec)}>
          End at playhead
        </button>
        <button type="button" className={SMALL_BUTTON} onClick={() => moveTo(playheadSec)}>
          Move to playhead
        </button>
        {block.track !== 'lyric' && (
          <button type="button" className={SMALL_BUTTON} onClick={wholeVideo}>
            Whole video
          </button>
        )}
      </div>
      {note && (
        <p role="status" className="w-full text-xs text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
    </div>
  );
}
