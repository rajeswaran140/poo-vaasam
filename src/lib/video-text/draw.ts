/**
 * Text drawing shared by the live preview and the burned-in PNGs. Both call
 * `drawBlock`, so they match exactly. Wrapping uses Intl.Segmenter so a Tamil
 * cluster (consonant + vowel sign, pulli, etc.) is never split.
 */
import type { TextBlock, TextStyle } from '@/types/videoText';

export const SAFE_MARGIN = 0.05;
export const FONT_FAMILY = '"Noto Sans Tamil", "Noto Sans", sans-serif';

type MeasureCtx = Pick<CanvasRenderingContext2D, 'measureText' | 'font'>;
type Frame = { width: number; height: number };

const BASE_FRACTION: Record<TextBlock['track'], number> = { title: 0.075, lyric: 0.05, credits: 0.04 };
const MAX_LINES: Record<TextBlock['track'], number> = { title: 2, lyric: 2, credits: 8 };
const MIN_SHRINK = 0.4;
const LINE_HEIGHT = 1.25;
const ELLIPSIS = '…';

function segments(text: string, granularity: 'word' | 'grapheme'): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter('ta', { granularity }).segment(text), (s) => s.segment);
  }
  // Fallback: spaces for words; code points for graphemes (best effort).
  return granularity === 'word' ? text.split(/(\s+)/).filter(Boolean) : Array.from(text);
}

const width = (ctx: MeasureCtx, s: string) => ctx.measureText(s).width;

/** Break one over-long word at cluster boundaries. */
function breakWord(ctx: MeasureCtx, word: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const g of segments(word, 'grapheme')) {
    if (cur && width(ctx, cur + g) > maxWidth) {
      out.push(cur);
      cur = g;
    } else {
      cur += g;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function wrapParagraph(ctx: MeasureCtx, para: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const tok of segments(para, 'word')) {
    if (width(ctx, cur + tok) <= maxWidth) {
      cur += tok;
      continue;
    }
    if (tok.trim() === '') continue; // whitespace at a break is dropped
    if (cur.trim()) lines.push(cur.trimEnd());
    cur = '';
    if (width(ctx, tok) <= maxWidth) {
      cur = tok;
    } else {
      const parts = breakWord(ctx, tok, maxWidth);
      cur = parts.pop() ?? '';
      lines.push(...parts);
    }
  }
  lines.push(cur.trimEnd());
  return lines;
}

/** Wrap on words (cluster-safe); explicit `\n` is always a break. `fits` = within maxLines. */
export function wrapLines(
  ctx: MeasureCtx,
  text: string,
  maxWidth: number,
  maxLines = 2,
): { lines: string[]; fits: boolean } {
  const lines = text.split('\n').flatMap((p) => wrapParagraph(ctx, p.trimEnd(), maxWidth));
  return { lines, fits: lines.length <= maxLines };
}

function ellipsize(ctx: MeasureCtx, line: string, maxWidth: number): string {
  const gs = segments(line, 'grapheme');
  while (gs.length && width(ctx, gs.join('') + ELLIPSIS) > maxWidth) gs.pop();
  return gs.join('').trimEnd() + ELLIPSIS;
}

/**
 * next/font registers a hashed family name, exposed as the `--font-tamil` CSS
 * variable on <html>. Canvas cannot use var(), so read it and use the real name.
 */
export function resolveFontFamily(): string {
  if (typeof document === 'undefined') return FONT_FAMILY;
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-tamil').trim();
  return v ? `${v}, "Noto Sans", sans-serif` : FONT_FAMILY;
}

const fontFor = (px: number) => `700 ${px}px ${resolveFontFamily()}`;

/**
 * `yBaseline[i]` is the vertical middle of line i: `drawBlock` sets
 * textBaseline='middle', so the same numbers drive preview and burn-in.
 */
export function layoutBlock(
  ctx: MeasureCtx,
  block: TextBlock,
  frame: Frame,
  style: TextStyle,
): { fontPx: number; lines: string[]; x: number; yBaseline: number[] } {
  const basePx = frame.height * BASE_FRACTION[block.track] * style.sizeScale;
  const maxLines = MAX_LINES[block.track];
  let fontPx = basePx;
  let lines: string[] = [];
  for (let step = 0; ; step++) {
    fontPx = basePx * Math.max(1 - 0.05 * step, MIN_SHRINK);
    ctx.font = fontFor(fontPx);
    // The stroke widens each glyph run by lineWidth (0.12 em); keep it inside the margin.
    const maxWidth = frame.width * (1 - 2 * SAFE_MARGIN) - fontPx * 0.12;
    const r = wrapLines(ctx, block.text, maxWidth, maxLines);
    lines = r.lines;
    if (r.fits) break;
    if (fontPx <= basePx * MIN_SHRINK + 1e-9) {
      // Floor reached: keep what fits and mark the cut.
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxWidth);
      break;
    }
  }

  const lh = fontPx * LINE_HEIGHT;
  const total = lh * lines.length;
  let top: number;
  if (block.track === 'lyric' && style.lyricPosition === 'lower') {
    top = frame.height * (1 - SAFE_MARGIN) - total;
  } else {
    top = (frame.height - total) / 2;
  }
  const yBaseline = lines.map((_, i) => top + lh * (i + 0.5));
  return { fontPx, lines, x: frame.width / 2, yBaseline };
}

export function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  frame: Frame,
  style: TextStyle,
): void {
  const { fontPx, lines, x, yBaseline } = layoutBlock(ctx, block, frame, style);
  ctx.save();
  ctx.font = fontFor(fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = fontPx * 0.12;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = fontPx * 0.15;
  ctx.shadowOffsetY = fontPx * 0.04;
  lines.forEach((line, i) => {
    ctx.strokeText(line, x, yBaseline[i]);
    ctx.fillText(line, x, yBaseline[i]);
  });
  ctx.restore();
}

export async function ensureFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const font = `700 32px ${resolveFontFamily()}`;
  await document.fonts.load(font);
  if (!document.fonts.check(font)) {
    throw new Error('The Tamil font did not load — reload the page and try again.');
  }
}

export async function renderBlockPng(
  block: TextBlock,
  frame: Frame,
  style: TextStyle,
): Promise<Blob> {
  await ensureFonts();
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    drawBlock(ctx as unknown as CanvasRenderingContext2D, block, frame, style);
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  drawBlock(ctx, block, frame, style);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
  );
}
