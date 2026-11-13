'use client';

/**
 * The uploaded video with its text drawn over it, exactly as it will be
 * burned in: the active blocks go through `drawBlock` at the FULL frame size
 * into an offscreen canvas (the same call that makes the PNGs), which is then
 * scaled down onto a canvas laid over the <video>.
 *
 * - The box has the frame's aspect ratio, so the picture fills it with no
 *   letterbox and the overlay lines up. A vertical video is capped in height.
 * - The full-size redraw happens only when the set of active blocks, their
 *   text or the style changes — redrawing 2560×1440 every frame would crawl
 *   on a phone. Between changes only the cheap scaled copy repeats.
 * - The overlay ignores the pointer so the video controls still work.
 * - `ref` exposes the <video> so the timeline can seek it.
 * - Move text (onMove): a switch over the picture. While it is on, each part
 *   showing now gets an outlined box over its text that drags (or arrows)
 *   the part, on top of its alignment. Only the boxes take the pointer, so
 *   the video controls still work around them; with the switch off nothing
 *   over the picture can be grabbed by accident.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { boxRect, drawBlock, ensureFonts, layoutBlock } from '@/lib/video-text/draw';
import { OFFSET_MAX, fadeAlphaAt, trackStyleOf } from '@/lib/video-text/fonts';
import { drawLogo, logoRect, logoStyleOf } from '@/lib/video-text/logo';
import type { TextBlock, TextOffset, TextStyle, Track } from '@/types/videoText';
import type { LogoImage } from './useSavedLogo';
import { frameAt, frameOfStart, seekTimeFor } from '@/lib/video-text/freeze';
import { drawEndTitles, endTitlesAlphaAt } from '@/lib/video-text/end-titles';

/** What a move box moves: a text part, or the logo. */
export type MoveTarget = Track | 'logo';
const TRACK_NAME: Record<MoveTarget, string> = { title: 'Title', lyric: 'Lyrics', credits: 'Credits', logo: 'Logo' };
const clampOffset = (n: number) => Math.round(Math.min(OFFSET_MAX, Math.max(-OFFSET_MAX, n)) * 1000) / 1000;

/** Report the time at most this often, so the editor does not re-render at 60 fps. */
const TIME_STEP_SEC = 1 / 15;

export interface TextPreviewProps {
  videoUrl: string;
  frame: { width: number; height: number };
  blocks: TextBlock[];
  style: TextStyle;
  onTime(sec: number): void;
  ref?: Ref<HTMLVideoElement>;
  /** Move a part (or the logo) by hand: its offset from the alignment. Without it there is no Move text switch. */
  onMove?(target: MoveTarget, offset: TextOffset): void;
  /** The saved logo, drawn when the style shows it (under the text, as in the render). */
  logo?: LogoImage | null;
  /** The freeze: from this time the picture shows the frame at it (the render's held frame). */
  freezeSec?: number | null;
  /** The video's frame rate, to find the frozen frame. */
  fps?: number;
  /** The hidden copy could not load the link (expired): the editor fetches a fresh one. */
  onLinkError?(): void;
  /** The playhead, so the move boxes follow the text that shows now. */
  timeSec?: number;
  /** End titles: from atSec the picture fades to black with the logo and credits (as the render's top layer). */
  endTitles?: { atSec: number; background?: 'black' | 'white' } | null;
  /** The credits text shown on the end titles. */
  creditsText?: string;
}

const activeAt = (blocks: TextBlock[], t: number) => blocks.filter((b) => t >= b.startSec && t < b.endSec);

export function TextPreview({ videoUrl, frame, blocks, style, onTime, ref, onMove, timeSec = 0, logo = null, freezeSec = null, fps = 25, onLinkError, endTitles = null, creditsText = '' }: TextPreviewProps) {
  const linkError = useRef(onLinkError);
  linkError.current = onLinkError;
  const video = useRef<HTMLVideoElement | null>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const drawnKey = useRef<string | null>(null);
  const fontsReady = useRef(false);
  const lastTime = useRef(-1);

  const still = useRef<HTMLCanvasElement>(null);
  const stillVideo = useRef<HTMLVideoElement>(null);
  const stillReady = useRef(false);
  const latestFreeze = useRef<number | null>(freezeSec);
  latestFreeze.current = freezeSec;
  const latestFps = useRef(fps);
  latestFps.current = fps;
  const latest = useRef({ blocks, style, frame, onTime, logo, endTitles, creditsText });
  const layerCanvas = useRef<HTMLCanvasElement | null>(null);
  latest.current = { blocks, style, frame, onTime, logo, endTitles, creditsText };

  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      video.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as { current: HTMLVideoElement | null }).current = el;
    },
    [ref],
  );

  /** Draw the overlay for the video's current time. */
  const paint = useCallback(() => {
    const v = video.current;
    const canvas = overlay.current;
    // Nothing to draw over until the video has a frame (HAVE_CURRENT_DATA).
    if (!v || !canvas || !fontsReady.current || v.readyState < 2) return;
    const { blocks: bs, style: st, frame: fr, logo: lg, endTitles: end, creditsText: credits } = latest.current;
    // The held frame covers the moving picture from the freeze on.
    if (still.current) {
      const f = latestFreeze.current;
      still.current.style.visibility = f !== null && stillReady.current && frameAt(v.currentTime, latestFps.current) >= frameOfStart(f, latestFps.current) ? 'visible' : 'hidden';
    }
    const showLogo = Boolean(lg) && logoStyleOf(st).show;
    const t = v.currentTime;

    // Size the visible canvas to its displayed box, in device pixels.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const resized = canvas.width !== w || canvas.height !== h;
    if (resized) {
      canvas.width = w;
      canvas.height = h;
    }

    const active = activeAt(bs, t);
    // A fading block is redrawn as its alpha changes (in 2% steps); others only when they change.
    const alphas = active.map((b) => Math.round(fadeAlphaAt(b, trackStyleOf(b.track, st).fade, t) * 50) / 50);
    // The end titles fade in over a second, redrawn in 2% steps like a fading block.
    const endAlpha = Math.round(endTitlesAlphaAt(end, t) * 50) / 50;
    const key = JSON.stringify([fr.width, fr.height, st, showLogo ? lg!.key : null, active.map((b, i) => [b.id, b.text, alphas[i]]), endAlpha, endAlpha > 0 ? [credits, lg?.key ?? null, end?.background ?? 'black'] : null]);
    if (key === drawnKey.current && !resized) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!offscreen.current) offscreen.current = document.createElement('canvas');
    const off = offscreen.current;
    if (off.width !== fr.width || off.height !== fr.height) {
      off.width = fr.width;
      off.height = fr.height;
    }
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.clearRect(0, 0, off.width, off.height);
    // The logo first, UNDER the text: the render lays its PNG first too.
    if (showLogo) drawLogo(octx, lg!.image, fr, logoStyleOf(st));
    active.forEach((b, i) => {
      if (alphas[i] >= 1) return drawBlock(octx, b, fr, st);
      // A fading block is drawn whole on its own layer, then faded AS ONE
      // image — exactly what the render's ffmpeg fade does to the PNG. Drawing
      // it at partial alpha directly would stack the stroke, fill and shadows
      // (a third of the way in would look ~80% visible).
      if (!layerCanvas.current) layerCanvas.current = document.createElement('canvas');
      const layer = layerCanvas.current;
      if (layer.width !== fr.width || layer.height !== fr.height) {
        layer.width = fr.width;
        layer.height = fr.height;
      }
      const lctx = layer.getContext('2d');
      if (!lctx) return;
      lctx.clearRect(0, 0, layer.width, layer.height);
      drawBlock(lctx, b, fr, st);
      octx.save();
      octx.globalAlpha = alphas[i];
      octx.drawImage(layer, 0, 0);
      octx.restore();
    });

    // The end titles on top of everything, as the render lays their PNG last.
    if (endAlpha > 0) {
      if (!layerCanvas.current) layerCanvas.current = document.createElement('canvas');
      const layer = layerCanvas.current;
      if (layer.width !== fr.width || layer.height !== fr.height) {
        layer.width = fr.width;
        layer.height = fr.height;
      }
      const lctx = layer.getContext('2d');
      if (lctx) {
        lctx.clearRect(0, 0, layer.width, layer.height);
        drawEndTitles(lctx, fr, credits ?? '', st, lg?.image ?? null, end?.background);
        octx.save();
        octx.globalAlpha = endAlpha;
        octx.drawImage(layer, 0, 0);
        octx.restore();
      }
    }

    ctx.clearRect(0, 0, w, h);
    if (active.length > 0 || showLogo || endAlpha > 0) ctx.drawImage(off, 0, 0, w, h);
    drawnKey.current = key;
  }, []);

  const reportTime = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (Math.abs(v.currentTime - lastTime.current) >= TIME_STEP_SEC || v.paused) {
      lastTime.current = v.currentTime;
      latest.current.onTime(v.currentTime);
    }
  }, []);

  // Fonts first: a canvas drawn before a font loads uses a fallback. Runs
  // again when a part's font changes, then redraws in the new font.
  const fontKey = (['title', 'lyric', 'credits'] as const)
    .map((t) => `${style.tracks?.[t]?.tamilFont ?? ''}/${style.tracks?.[t]?.englishFont ?? ''}`)
    .join('|');
  useEffect(() => {
    let cancelled = false;
    ensureFonts(latest.current.style)
      .catch(() => undefined) // Make video reports a missing font; the preview just draws.
      .then(() => {
        if (cancelled) return;
        fontsReady.current = true;
        paint();
      });
    return () => {
      cancelled = true;
    };
  }, [paint, fontKey]);

  // The freeze moved (or the video changed): grab its frame from a second, hidden copy of the video.
  useEffect(() => {
    stillReady.current = false;
    const sv = stillVideo.current;
    const canvas = still.current;
    if (!sv || !canvas || freezeSec === null) {
      paint();
      return;
    }
    let cancelled = false;
    const target = seekTimeFor(frameOfStart(freezeSec, fps), fps);
    const grab = () => {
      if (cancelled) return;
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvas.getContext('2d')?.drawImage(sv, 0, 0, frame.width, frame.height);
      stillReady.current = true;
      paint();
    };
    const seekIt = () => {
      if (Math.abs(sv.currentTime - target) < 1e-4 && sv.readyState >= 2) grab();
      else sv.currentTime = target;
    };
    const failed = () => linkError.current?.();
    sv.addEventListener('error', failed);
    sv.addEventListener('seeked', grab);
    if (sv.readyState >= 1) seekIt();
    else sv.addEventListener('loadedmetadata', seekIt, { once: true });
    return () => {
      cancelled = true;
      sv.removeEventListener('seeked', grab);
      sv.removeEventListener('error', failed);
      sv.removeEventListener('loadedmetadata', seekIt);
    };
  }, [freezeSec, fps, videoUrl, frame.width, frame.height, paint]);

  // Text or style changed: redraw at the current time.
  useEffect(() => {
    paint();
  }, [blocks, style, frame.width, frame.height, logo, endTitles, creditsText, paint]);

  // While playing, follow every frame; otherwise follow seeks.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const loop = () => {
      paint();
      reportTime();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onStop = () => {
      cancelAnimationFrame(raf);
      paint();
      reportTime();
    };
    const onStill = () => {
      paint();
      reportTime();
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onStop);
    v.addEventListener('ended', onStop);
    v.addEventListener('seeked', onStill);
    v.addEventListener('timeupdate', onStill);
    v.addEventListener('loadeddata', onStill);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onStop);
      v.removeEventListener('ended', onStop);
      v.removeEventListener('seeked', onStill);
      v.removeEventListener('timeupdate', onStill);
      v.removeEventListener('loadeddata', onStill);
    };
  }, [paint, reportTime]);

  // A resize changes the displayed size; repaint the scaled copy.
  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [paint]);

  // ---- Move text
  const [moving, setMoving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<CanvasRenderingContext2D | null>(null);
  const drag = useRef<{ track: MoveTarget; pointerId: number; x: number; y: number; from: TextOffset } | null>(null);
  /** Each showing part's text box, in fractions of the frame (all of a part's showing lines together). */
  const moveBoxes = (): { track: MoveTarget; x: number; y: number; w: number; h: number }[] => {
    if (!moving || !onMove || typeof document === 'undefined') return [];
    if (!measure.current) measure.current = document.createElement('canvas').getContext('2d');
    const ctx = measure.current;
    if (!ctx) return [];
    const byTrack = new Map<Track, { x0: number; y0: number; x1: number; y1: number }>();
    for (const b of activeAt(blocks, timeSec)) {
      if (!b.text.trim()) continue;
      const r = boxRect(ctx, layoutBlock(ctx, b, frame, style), frame);
      const u = byTrack.get(b.track);
      byTrack.set(b.track, u
        ? { x0: Math.min(u.x0, r.x), y0: Math.min(u.y0, r.y), x1: Math.max(u.x1, r.x + r.w), y1: Math.max(u.y1, r.y + r.h) }
        : { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
    }
    const boxes: { track: MoveTarget; x: number; y: number; w: number; h: number }[] = [...byTrack].map(([track, u]) => ({
      track,
      x: u.x0 / frame.width,
      y: u.y0 / frame.height,
      w: (u.x1 - u.x0) / frame.width,
      h: (u.y1 - u.y0) / frame.height,
    }));
    // First, so the text boxes stack above it: where they overlap, a drag takes the text.
    const look = logoStyleOf(style);
    if (logo && look.show) {
      const r = logoRect(logo, frame, look);
      boxes.unshift({ track: 'logo', x: r.x / frame.width, y: r.y / frame.height, w: r.w / frame.width, h: r.h / frame.height });
    }
    return boxes;
  };
  const offsetOf = (track: MoveTarget) => (track === 'logo' ? logoStyleOf(style).offset : trackStyleOf(track, style).offset);
  const beginMove = (e: PointerEvent<HTMLDivElement>, track: MoveTarget) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { track, pointerId: e.pointerId, x: e.clientX, y: e.clientY, from: offsetOf(track) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMoveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const rect = box.current?.getBoundingClientRect();
    if (!d || d.pointerId !== e.pointerId || !rect || !rect.width || !rect.height || !onMove) return;
    onMove(d.track, {
      x: clampOffset(d.from.x + (e.clientX - d.x) / rect.width),
      y: clampOffset(d.from.y + (e.clientY - d.y) / rect.height),
    });
  };
  const endMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };
  const onMoveKey = (e: KeyboardEvent<HTMLDivElement>, track: MoveTarget) => {
    const step = e.shiftKey ? 0.05 : 0.005;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const k = d[e.key];
    if (!k || !onMove) return;
    e.preventDefault();
    const o = offsetOf(track);
    onMove(track, { x: clampOffset(o.x + k[0]), y: clampOffset(o.y + k[1]) });
  };

  const ratio = frame.width / Math.max(1, frame.height);
  return (
    <div className="min-w-0 space-y-2">
    {onMove && (
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} className="h-4 w-4 accent-orange-600" />
          Move text by dragging it on the picture
        </label>
        {moving && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Drag a part&apos;s outlined box, or select it and use the arrow keys (Shift = bigger steps). Pick an alignment to put it back.
          </span>
        )}
      </div>
    )}
    <div
      ref={box}
      className="relative mx-auto overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: `${frame.width} / ${frame.height}`, width: `min(100%, calc(70vh * ${ratio}))` }}
    >
      <video
        ref={setVideo}
        data-testid="preview-video"
        src={videoUrl}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full"
      />
      {freezeSec !== null && (
        <>
          {/* A second copy of the video, only to grab the frozen frame from. */}
          <video ref={stillVideo} src={videoUrl} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute h-px w-px opacity-0" />
          <canvas ref={still} aria-hidden="true" data-testid="freeze-still" className="pointer-events-none absolute inset-0 h-full w-full" style={{ visibility: 'hidden' }} />
        </>
      )}
      <canvas ref={overlay} aria-hidden="true" data-testid="text-overlay" className="pointer-events-none absolute inset-0 h-full w-full" />
      {moveBoxes().map((m) => (
        <div
          key={m.track}
          role="button"
          tabIndex={0}
          aria-label={`Move ${TRACK_NAME[m.track]}: drag, or use the arrow keys`}
          data-testid={`move-${m.track}`}
          onPointerDown={(e) => beginMove(e, m.track)}
          onPointerMove={onMoveDrag}
          onPointerUp={endMove}
          onPointerCancel={endMove}
          onKeyDown={(e) => onMoveKey(e, m.track)}
          className="absolute cursor-move touch-none rounded border-2 border-dashed border-orange-400 bg-orange-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
        />
      ))}
    </div>
    {freezeSec !== null && (
      // The held frame covers the video's own controls from the freeze on: play and pause from here too.
      <div className="flex min-w-0 items-center justify-center gap-3" data-testid="freeze-transport">
        <button
          type="button"
          onClick={() => {
            const v = video.current;
            if (!v) return;
            if (v.paused) void v.play().catch(() => undefined);
            else v.pause();
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Play / Pause
        </button>
        <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">{formatClock(timeSec)}</span>
      </div>
    )}
    </div>
  );
}

const formatClock = (sec: number) => {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};
