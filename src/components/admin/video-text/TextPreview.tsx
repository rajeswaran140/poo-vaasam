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
 */
import { useCallback, useEffect, useRef, type Ref } from 'react';
import { drawBlock, ensureFonts } from '@/lib/video-text/draw';
import type { TextBlock, TextStyle } from '@/types/videoText';

/** Report the time at most this often, so the editor does not re-render at 60 fps. */
const TIME_STEP_SEC = 1 / 15;

export interface TextPreviewProps {
  videoUrl: string;
  frame: { width: number; height: number };
  blocks: TextBlock[];
  style: TextStyle;
  onTime(sec: number): void;
  ref?: Ref<HTMLVideoElement>;
}

const activeAt = (blocks: TextBlock[], t: number) => blocks.filter((b) => t >= b.startSec && t < b.endSec);

export function TextPreview({ videoUrl, frame, blocks, style, onTime, ref }: TextPreviewProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const drawnKey = useRef<string | null>(null);
  const fontsReady = useRef(false);
  const lastTime = useRef(-1);

  const latest = useRef({ blocks, style, frame, onTime });
  latest.current = { blocks, style, frame, onTime };

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
    const { blocks: bs, style: st, frame: fr } = latest.current;
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
    const key = JSON.stringify([fr.width, fr.height, st, active.map((b) => [b.id, b.text])]);
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
    for (const b of active) drawBlock(octx, b, fr, st);

    ctx.clearRect(0, 0, w, h);
    if (active.length > 0) ctx.drawImage(off, 0, 0, w, h);
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

  // Fonts first: a canvas drawn before the Tamil font loads uses a fallback.
  useEffect(() => {
    let cancelled = false;
    ensureFonts()
      .catch(() => undefined) // Make video reports a missing font; the preview just draws.
      .then(() => {
        if (cancelled) return;
        fontsReady.current = true;
        paint();
      });
    return () => {
      cancelled = true;
    };
  }, [paint]);

  // Text or style changed: redraw at the current time.
  useEffect(() => {
    paint();
  }, [blocks, style, frame.width, frame.height, paint]);

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

  const ratio = frame.width / Math.max(1, frame.height);
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: `${frame.width} / ${frame.height}`, width: `min(100%, calc(70vh * ${ratio}))` }}
    >
      <video
        ref={setVideo}
        src={videoUrl}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full"
      />
      <canvas ref={overlay} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
