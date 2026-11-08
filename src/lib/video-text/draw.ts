/**
 * Text drawing shared by the live preview and the burned-in PNGs. Both call
 * `drawBlock`, so they match exactly. Wrapping uses Intl.Segmenter so a Tamil
 * cluster (consonant + vowel sign, pulli, etc.) is never split.
 */
import { CENTRE_PLACEMENT, type Placement, type TextBlock, type TextStyle } from '@/types/videoText';
import { englishFont, tamilFont, textColor, trackStyleOf, type FontChoice } from '@/lib/video-text/fonts';
import { googleFamilyName, loadGoogleFont, type FontSlot } from '@/lib/video-text/google-font-loader';

export const SAFE_MARGIN = 0.05;
export const FONT_FAMILY = '"Noto Sans Tamil", "Noto Sans", sans-serif';

type MeasureCtx = Pick<CanvasRenderingContext2D, 'measureText' | 'font'>;
type Frame = { width: number; height: number };

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

/**
 * Where a block sits. Lyrics follow lyricPosition (always centred across);
 * title and credits use their own placement, centred when none is saved.
 */
export function placementFor(track: TextBlock['track'], style: TextStyle): Placement {
  if (track === 'lyric') return { v: style.lyricPosition === 'lower' ? 'bottom' : 'middle', h: 'center' };
  return (track === 'title' ? style.titlePlace : style.creditsPlace) ?? CENTRE_PLACEMENT;
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

/** The value of a font CSS variable, read where the editor defines them ([data-vt-fonts]) or on <html>. */
function cssVarValue(name: string): string {
  if (typeof document === 'undefined') return '';
  const el = document.querySelector('[data-vt-fonts]') ?? document.documentElement;
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** One font's family, or '' when it has none of its own (Plain) or is not defined on this page. */
function familyOf(choice: FontChoice<string>, slot: FontSlot): string {
  if (choice.google) return googleFamilyName(choice.google, slot);
  if (!choice.cssVar) return '';
  // The site-wide Tamil font keeps its old plain-name fallback (resolveFontFamily).
  return cssVarValue(choice.cssVar) || (choice.cssVar === '--font-tamil' ? '"Noto Sans Tamil"' : '');
}

/**
 * A part's font stack: its English font (Latin only), then its Tamil font,
 * then the fallbacks. Noto Sans Tamil with Plain gives exactly the stack used
 * before fonts could be chosen.
 */
export function fontStackFor(track: TextBlock['track'], style: TextStyle): { stack: string; weight: number } {
  const own = trackStyleOf(track, style);
  const ta = tamilFont(own.tamilFont);
  const families = [familyOf(englishFont(own.englishFont), 'latin'), familyOf(ta, 'tamil')].filter(Boolean);
  return { stack: families.length ? `${families.join(', ')}, "Noto Sans", sans-serif` : FONT_FAMILY, weight: ta.weight };
}

const fontFor = (px: number, track: TextBlock['track'], style: TextStyle) => {
  const { stack, weight } = fontStackFor(track, style);
  return `${weight} ${px}px ${stack}`;
};

/**
 * `yBaseline[i]` is the vertical middle of line i: `drawBlock` sets
 * textBaseline='middle', so the same numbers drive preview and burn-in.
 */
export function layoutBlock(
  ctx: MeasureCtx,
  block: TextBlock,
  frame: Frame,
  style: TextStyle,
): { fontPx: number; lines: string[]; x: number; yBaseline: number[]; align: CanvasTextAlign } {
  const look = trackStyleOf(block.track, style);
  const basePx = (frame.height * look.heightPct) / 100;
  const maxLines = MAX_LINES[block.track];
  let fontPx = basePx;
  let lines: string[] = [];
  for (let step = 0; ; step++) {
    fontPx = basePx * Math.max(1 - 0.05 * step, MIN_SHRINK);
    ctx.font = fontFor(fontPx, block.track, style);
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
  const place = placementFor(block.track, style);
  const top =
    place.v === 'top'
      ? frame.height * SAFE_MARGIN
      : place.v === 'bottom'
        ? frame.height * (1 - SAFE_MARGIN) - total
        : (frame.height - total) / 2;
  // Moved by hand: added on top of the alignment, as a share of the frame.
  const dx = look.offset.x * frame.width;
  const dy = look.offset.y * frame.height;
  const yBaseline = lines.map((_, i) => top + lh * (i + 0.5) + dy);
  // Half the stroke (0.06 em) sticks out past a left/right-aligned line's edge.
  const inset = frame.width * SAFE_MARGIN + fontPx * 0.06;
  const x = (place.h === 'left' ? inset : place.h === 'right' ? frame.width - inset : frame.width / 2) + dx;
  const align: CanvasTextAlign = place.h === 'left' ? 'left' : place.h === 'right' ? 'right' : 'center';
  return { fontPx, lines, x, yBaseline, align };
}

/** The dim box behind a block's lines: padding, corner radius and colour. */
export const BOX = { padX: 0.4, padY: 0.15, radius: 0.2, fill: 'rgba(0,0,0,0.5)' } as const;

/** Where the box goes: around every line (measured), padded, kept inside the frame. */
export function boxRect(
  ctx: MeasureCtx,
  layout: { fontPx: number; lines: string[]; x: number; yBaseline: number[]; align: CanvasTextAlign },
  frame: Frame,
): { x: number; y: number; w: number; h: number } {
  const { fontPx, lines, x, yBaseline, align } = layout;
  const lh = fontPx * LINE_HEIGHT;
  const half = (fontPx * 0.12) / 2; // the stroke sticks out this far
  let left = Infinity;
  let right = -Infinity;
  for (const line of lines) {
    const w = width(ctx, line);
    const l = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    left = Math.min(left, l - half);
    right = Math.max(right, l + w + half);
  }
  const x0 = Math.max(0, left - fontPx * BOX.padX);
  const x1 = Math.min(frame.width, right + fontPx * BOX.padX);
  const y0 = Math.max(0, yBaseline[0] - lh / 2 - fontPx * BOX.padY);
  const y1 = Math.min(frame.height, yBaseline[yBaseline.length - 1] + lh / 2 + fontPx * BOX.padY);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Draw one block, fully opaque. Fades are applied to the finished image as a
 * whole: by the render's ffmpeg fade on the PNG, and by the preview
 * compositing a layer at fadeAlphaAt — never by drawing at partial alpha.
 */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  frame: Frame,
  style: TextStyle,
): void {
  const layout = layoutBlock(ctx, block, frame, style);
  const { fontPx, lines, x, yBaseline, align } = layout;
  const look = trackStyleOf(block.track, style);
  ctx.save();
  ctx.font = fontFor(fontPx, block.track, style);
  if (look.box && lines.length) {
    const r = boxRect(ctx, layout, frame);
    ctx.fillStyle = BOX.fill;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(r.x, r.y, r.w, r.h, fontPx * BOX.radius);
    else ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill();
  }
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = fontPx * 0.12;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = textColor(look.color).css;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = fontPx * 0.15;
  ctx.shadowOffsetY = fontPx * 0.04;
  lines.forEach((line, i) => {
    ctx.strokeText(line, x, yBaseline[i]);
    ctx.fillText(line, x, yBaseline[i]);
  });
  ctx.restore();
}

/** A Tamil letter: without sample text, load()/check() only cover the Latin range of a subset font. */
const TAMIL_SAMPLE = 'அ';

/** Latin letters, for the English fonts. */
const LATIN_SAMPLE = 'Ag';

/**
 * Load, and check, every font the parts use — each family on its own, so a
 * loaded English face cannot vouch for a Tamil face that is still missing.
 * Without a style: the default Tamil font (as before fonts could be chosen).
 */
export async function ensureFonts(style?: TextStyle): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  // Without a style: the default Tamil font, as before fonts could be chosen.
  const st: TextStyle = style ?? { sizeScale: 1, lyricPosition: 'lower' };
  const checks = new Map<string, { sample: string; label: string }>();
  for (const track of ['title', 'lyric', 'credits'] as const) {
    const own = trackStyleOf(track, st);
    const ta = tamilFont(own.tamilFont);
    const en = englishFont(own.englishFont);
    for (const [choice, sample, kind, slot] of [[ta, TAMIL_SAMPLE, 'Tamil', 'tamil'], [en, LATIN_SAMPLE, 'English', 'latin']] as const) {
      if (!choice.cssVar && !choice.google) continue; // Plain: no font of its own
      const label = ta.id === 'noto-sans-tamil' && kind === 'Tamil' ? 'Tamil font' : `${kind} font (${choice.label})`;
      if (choice.google) {
        // From Google, on first use. A failure must stop the render, not draw the fallback.
        try {
          await loadGoogleFont(choice.google, slot);
        } catch {
          throw new Error(`The ${label} did not load from Google Fonts — check the connection and try again.`);
        }
      }
      const family = familyOf(choice, slot);
      // A chosen font whose variable is missing would silently draw the fallback.
      if (!family) throw new Error(`The ${label} did not load — reload the page and try again.`);
      // Check the real face only. next/font's variable also lists a metric
      // fallback ("x Fallback", a local() Arial) that is in error wherever
      // Arial is not installed (Linux, Android): checking the whole list then
      // fails although the font itself is loaded.
      const primary = family.split(',')[0].trim();
      checks.set(`${choice.weight} 32px ${primary}`, { sample, label });
    }
  }
  for (const [font, { sample, label }] of checks) {
    await document.fonts.load(font, sample);
    if (!document.fonts.check(font, sample)) throw new Error(`The ${label} did not load — reload the page and try again.`);
  }
}

export async function renderBlockPng(
  block: TextBlock,
  frame: Frame,
  style: TextStyle,
): Promise<Blob> {
  await ensureFonts(style);
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
