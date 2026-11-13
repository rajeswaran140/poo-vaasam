/**
 * End titles: from a chosen moment to the end of the video, the picture fades
 * to black over a second and the logo and credits show centred on the black,
 * like a film's end titles, while the song plays on.
 *
 * The screen is black or white (Raj's choice). In the render it is ONE more
 * full-frame PNG, opaque, with the logo and
 * credits drawn on it, laid on TOP of everything (picture, corner logo, text)
 * and faded in with the overlay fade the text already uses. So nothing else
 * needs hiding, and the preview draws the very same image.
 */
import { drawBlock, layoutBlock } from '@/lib/video-text/draw';
import type { EndTitles, TextBlock, TextStyle } from '@/types/videoText';

/** The overlay id of the end-titles PNG (beside '_logo' and '_freeze'). */
export const END_TITLES_OVERLAY_ID = '_end';
/** How long the picture takes to go black. */
export const END_TITLES_FADE_SEC = 1;
/** The logo's height on the black screen, as a share of the video's height. */
export const END_LOGO_HEIGHT = 0.22;
/** The space between the logo and the credits, as a share of the video's height. */
const GAP = 0.04;

type Size = { width: number; height: number };

/** A start the render can honour: inside the video, with room for the fade. */
export function validateEndTitles(end: EndTitles | null | undefined, durationSec: number): string | null {
  if (!end) return null;
  if (!Number.isFinite(end.atSec) || end.atSec < 0) return 'The end titles need a start time.';
  // A hair of tolerance: 128.01 − 1 is 127.00999…, and a start stored as 127.01 must pass.
  if (end.atSec > durationSec - END_TITLES_FADE_SEC + 1e-6) {
    return 'The end titles start too close to the end of the video. Start them at least a second before it ends.';
  }
  return null;
}

/** The latest start that leaves a second for the fade, in whole hundredths (rounded DOWN, so it always validates). */
const latestStart = (durationSec: number) => Math.max(0, Math.floor((durationSec - END_TITLES_FADE_SEC) * 100 + 1e-6) / 100);

/** End titles at the playhead, kept a fade's length before the end, on the given screen. */
export function endTitlesAt(sec: number, durationSec: number, background: EndTitles['background'] = 'black'): EndTitles {
  const at = Math.round(Math.max(0, sec) * 100) / 100;
  return { atSec: Math.min(latestStart(durationSec), at), background };
}

/**
 * End titles after a new video is attached: kept when they still leave room
 * for the fade, else dropped. Without this a SHORTER re-upload left them past
 * the new end, and every save (they ride along with each autosave) was refused.
 */
export function fitEndTitlesToDuration(end: EndTitles | null | undefined, durationSec: number): EndTitles | null {
  if (!end) return null;
  return validateEndTitles(end, durationSec) === null ? end : null;
}

/**
 * How In and Out change what the export shows of the end titles, or null when
 * they are fully inside it. The preview plays the whole source, so this is
 * the only place the difference is said.
 */
export function endTitlesCutNote(end: EndTitles | null | undefined, range: { inSec: number; outSec: number }): string | null {
  if (!end) return null;
  if (end.atSec >= range.outSec) return 'The end titles start after Out, so the exported part does not show them.';
  if (range.outSec - end.atSec < END_TITLES_FADE_SEC) return 'Out comes before the fade finishes, so the export ends half-faded.';
  if (end.atSec + END_TITLES_FADE_SEC <= range.inSec) return 'The end titles start before In, so the whole exported part is the end screen.';
  return null;
}

/** The screen colour, and the credits' colour on it (every text colour is light, so white gets dark text). */
export const END_SCREEN = {
  black: { fill: '#000000', text: null },
  white: { fill: '#ffffff', text: '#1c1c1c' },
} as const;

/**
 * The render's span for the end-titles PNG. The end is a finite point past the
 * video (not Infinity, which does not survive JSON to the chunk workers), so
 * the fade-out window never falls inside the video: it fades in only.
 */
export function endTitlesSpan(end: EndTitles, durationSec: number) {
  return { id: END_TITLES_OVERLAY_ID, startSec: end.atSec, endSec: durationSec + 60, fadeSec: END_TITLES_FADE_SEC };
}

/**
 * Draw the end-titles frame: black or white, the logo centred on the first
 * line, the credits centred under it in the credits part's own fonts and size
 * (its colour on black; dark text on white). With no logo the credits sit in
 * the middle; with no credits the logo does.
 */
export function drawEndTitles(
  ctx: CanvasRenderingContext2D,
  frame: Size,
  creditsText: string,
  style: TextStyle,
  logo: (CanvasImageSource & Size) | null,
  background: EndTitles['background'] = 'black',
): void {
  const screen = END_SCREEN[background === 'white' ? 'white' : 'black'];
  ctx.save();
  ctx.fillStyle = screen.fill;
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.restore();

  const text = String(creditsText ?? '').trim();
  // The credits part's look, but centred and not moved by hand.
  const centred: TextStyle = {
    ...style,
    creditsPlace: { v: 'middle', h: 'center' },
    tracks: { ...style.tracks, credits: { ...style.tracks?.credits, offset: { x: 0, y: 0 } } },
  };
  const block: TextBlock = { id: END_TITLES_OVERLAY_ID, track: 'credits', text, startSec: 0, endSec: 1 };
  let textHeight = 0;
  if (text) {
    const lay = layoutBlock(ctx, block, frame, centred);
    const lh = lay.yBaseline.length > 1 ? lay.yBaseline[1] - lay.yBaseline[0] : lay.fontPx * 1.25;
    textHeight = lh * lay.lines.length;
  }
  const aspect = logo && logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1;
  let lh = logo ? frame.height * END_LOGO_HEIGHT : 0;
  let lw = lh * aspect;
  if (lw > frame.width * 0.8) {
    lw = frame.width * 0.8;
    lh = lw / aspect;
  }
  const gap = logo && text ? frame.height * GAP : 0;
  const top = (frame.height - (lh + gap + textHeight)) / 2;

  if (logo) {
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo, (frame.width - lw) / 2, top, lw, lh);
    ctx.restore();
  }
  if (text) {
    // Move the centred block so its middle sits under the logo.
    const middle = top + lh + gap + textHeight / 2;
    const placed: TextStyle = {
      ...centred,
      tracks: { ...centred.tracks, credits: { ...centred.tracks?.credits, offset: { x: 0, y: (middle - frame.height / 2) / frame.height } } },
    };
    if (!screen.text) {
      drawBlock(ctx, block, frame, placed);
    } else {
      // On white: the same lines and positions, in plain dark text (no dark outline or shadow).
      const lay = layoutBlock(ctx, block, frame, placed); // leaves ctx.font set to the laid-out size
      ctx.save();
      ctx.textAlign = lay.align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = screen.text;
      lay.lines.forEach((line, i) => ctx.fillText(line, lay.x, lay.yBaseline[i]));
      ctx.restore();
    }
  }
}

/** The end-titles PNG for the render. */
export async function renderEndTitlesPng(
  frame: Size,
  creditsText: string,
  style: TextStyle,
  logo: (CanvasImageSource & Size) | null,
  background: EndTitles['background'] = 'black',
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    drawEndTitles(ctx as unknown as CanvasRenderingContext2D, frame, creditsText, style, logo, background);
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  drawEndTitles(ctx, frame, creditsText, style, logo, background);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
  );
}

/** How much of the end titles shows at time t (0..1): a 1 s fade in from atSec. */
export function endTitlesAlphaAt(end: EndTitles | null | undefined, t: number): number {
  if (!end || t < end.atSec) return 0;
  return Math.min(1, (t - end.atSec) / END_TITLES_FADE_SEC);
}
