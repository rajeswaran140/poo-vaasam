/**
 * The logo watermark: one saved image, placed in a corner of every frame of
 * the exported video. Pure layout plus the drawing shared by the preview and
 * the burned-in PNG (the same call, so they match).
 *
 * - Size is the logo's height as a % of the video's height (like the text);
 *   a very wide logo is scaled down to fit inside the safe margin.
 * - It sits in its corner inside SAFE_MARGIN, then the hand move is added.
 * - Opacity is applied to the whole image at once.
 */
import type { LogoCorner, LogoStyle, TextOffset, TextStyle } from '@/types/videoText';

export const LOGO_HEIGHT_PCT_MIN = 1;
export const LOGO_HEIGHT_PCT_MAX = 100;
export const LOGO_OPACITY_MIN = 0.1;
export const LOGO_OPACITY_MAX = 1;
export const LOGO_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const satisfies readonly LogoCorner[];
/** The overlay id the render uses for the logo's PNG (block ids are UUIDs, never this). */
export const LOGO_OVERLAY_ID = '_logo';
/** Logo files: what the browser can draw, up to 5 MB. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

const MARGIN = 0.05; // = draw.ts SAFE_MARGIN (kept here so the worker bundle needs no canvas code)
const NO_OFFSET: TextOffset = { x: 0, y: 0 };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const DEFAULT_LOGO: Required<LogoStyle> = {
  show: false,
  corner: 'bottom-right',
  heightPct: 10,
  opacity: 0.8,
  offset: NO_OFFSET,
};

/** This project's logo settings with every default filled in. */
export function logoStyleOf(style: Pick<TextStyle, 'logo'> | null | undefined): Required<LogoStyle> {
  const own = style?.logo ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    show: own.show === true,
    corner: own.corner && (LOGO_CORNERS as readonly string[]).includes(own.corner) ? own.corner : DEFAULT_LOGO.corner,
    heightPct: clamp(num(own.heightPct, DEFAULT_LOGO.heightPct), LOGO_HEIGHT_PCT_MIN, LOGO_HEIGHT_PCT_MAX),
    opacity: clamp(num(own.opacity, DEFAULT_LOGO.opacity), LOGO_OPACITY_MIN, LOGO_OPACITY_MAX),
    offset: own.offset ?? NO_OFFSET,
  };
}

/** True when this project's export carries the logo. */
export const logoShown = (style: Pick<TextStyle, 'logo'> | null | undefined) => logoStyleOf(style).show;

type Size = { width: number; height: number };

/** Where the logo lands on the frame, in pixels. */
export function logoRect(image: Size, frame: Size, logo: Required<LogoStyle>): { x: number; y: number; w: number; h: number } {
  const aspect = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  let h = (frame.height * logo.heightPct) / 100;
  let w = h * aspect;
  const maxW = frame.width * (1 - 2 * MARGIN);
  const maxH = frame.height * (1 - 2 * MARGIN);
  const fit = Math.min(1, maxW / w, maxH / h);
  w *= fit;
  h *= fit;
  const left = logo.corner.endsWith('left');
  const top = logo.corner.startsWith('top');
  const x = (left ? frame.width * MARGIN : frame.width * (1 - MARGIN) - w) + logo.offset.x * frame.width;
  const y = (top ? frame.height * MARGIN : frame.height * (1 - MARGIN) - h) + logo.offset.y * frame.height;
  return { x, y, w, h };
}

/** Draw the logo onto a frame-sized canvas, at its opacity. */
export function drawLogo(
  ctx: Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'drawImage' | 'globalAlpha' | 'imageSmoothingQuality'>,
  image: CanvasImageSource & Size,
  frame: Size,
  logo: Required<LogoStyle>,
): void {
  const r = logoRect(image, frame, logo);
  ctx.save();
  ctx.globalAlpha = logo.opacity;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, r.x, r.y, r.w, r.h);
  ctx.restore();
}

/** The logo's full-frame PNG for the render (transparent everywhere else). */
export async function renderLogoPng(image: CanvasImageSource & Size, frame: Size, logo: Required<LogoStyle>): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    drawLogo(ctx as unknown as CanvasRenderingContext2D, image, frame, logo);
    return canvas.convertToBlob({ type: 'image/png' });
  }
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  drawLogo(ctx, image, frame, logo);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
  );
}

/** S3 key for a newly uploaded logo: outside the 30-day video-text folder, so it is kept. */
export const LOGO_PREFIX = 'audio/mastering/video-text-logo/';
export function logoKey(contentType: string, now: number, nonce: string): string {
  const ext = contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/webp' ? '.webp' : '.png';
  const safe = String(nonce).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32) || 'x';
  return `${LOGO_PREFIX}${now}_${safe}${ext}`;
}
export const isLogoKey = (key: unknown): key is string =>
  typeof key === 'string' && /^audio\/mastering\/video-text-logo\/\d+_[A-Za-z0-9-]{1,32}\.(png|jpg|webp)$/.test(key);
