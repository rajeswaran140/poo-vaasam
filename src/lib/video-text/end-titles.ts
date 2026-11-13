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
  if (end.atSec > durationSec - END_TITLES_FADE_SEC) {
    return 'The end titles start too close to the end of the video. Start them at least a second before it ends.';
  }
  return null;
}

/** End titles at the playhead, kept a fade's length before the end, on the given screen. */
export function endTitlesAt(sec: number, durationSec: number, background: EndTitles['background'] = 'black'): EndTitles {
  const max = Math.max(0, durationSec - END_TITLES_FADE_SEC);
  return { atSec: Math.round(Math.min(max, Math.max(0, sec)) * 100) / 100, background };
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
