/** Shared shapes for the Video Text admin tool. Pure types, safe on client and server. */

export type Track = 'title' | 'lyric' | 'credits';

export interface TextBlock {
  id: string;
  track: Track;
  text: string;
  startSec: number;
  endSec: number;
}

/** Where a title or credits block sits on the picture, inside the safe margin. */
export interface Placement {
  v: 'top' | 'middle' | 'bottom';
  h: 'left' | 'center' | 'right';
}

export const CENTRE_PLACEMENT: Placement = { v: 'middle', h: 'center' };

/** A Google font, by family: `g:Hind Madurai`. Loaded from Google when used (lib/video-text/google-fonts.ts). */
export type GoogleFontId = `g:${string}`;
export type TamilFontId = 'noto-sans-tamil' | 'noto-serif-tamil' | 'mukta-malar' | 'arima' | 'baloo-thambi-2' | 'kavivanar' | GoogleFontId;
export type EnglishFontId = 'plain' | 'montserrat' | 'poppins' | 'playfair-display' | 'lora' | 'oswald' | 'dancing-script' | GoogleFontId;

export type TextColorId = 'white' | 'yellow' | 'gold' | 'cream';

/** One part's own look. Missing fields fall back (size → TextStyle.sizeScale, fonts → the defaults, white, no box, no fade). */
export interface TrackStyle {
  /** Older saves: 0.5–2, a multiple of the part's base size. Read only when heightPct is missing. */
  size?: number;
  /** Letter size as a percentage of the video's height, 1–100. */
  heightPct?: number;
  /**
   * Moved by hand from where the alignment puts it, as fractions of the
   * video's width and height (−1 to 1). Missing or 0,0: exactly aligned.
   */
  offset?: TextOffset;
  tamilFont?: TamilFontId;
  englishFont?: EnglishFontId;
  color?: TextColorId;
  /** A dim box behind the lines, for busy or bright pictures. */
  box?: boolean;
  /** Fade each line in and out (FADE_SEC). */
  fade?: boolean;
}

export interface TextOffset {
  x: number;
  y: number;
}

export interface TextStyle {
  /** 0.75–1.5, default 1. */
  sizeScale: number;
  lyricPosition: 'lower' | 'middle';
  /** Optional: projects saved before placement existed are centred. */
  titlePlace?: Placement;
  creditsPlace?: Placement;
  /** Per-part size and fonts. Projects saved before this have none: Noto Sans Tamil at sizeScale. */
  tracks?: Partial<Record<Track, TrackStyle>>;
  /** The saved logo burned in over the whole video. Missing: no logo. */
  logo?: LogoStyle;
}

export type LogoCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** How this project shows the one saved logo. Missing fields fall back (lib/video-text/logo.ts). */
export interface LogoStyle {
  show?: boolean;
  corner?: LogoCorner;
  /** The logo's height as a percentage of the video's height, 1–100. */
  heightPct?: number;
  /** 0.1–1. */
  opacity?: number;
  /** Moved by hand from its corner, as fractions of the video's width and height (−1 to 1). */
  offset?: TextOffset;
}

/** The one logo every project can use (uploaded once, reused). */
export interface SavedLogo {
  key: string;
  contentType: string;
  width: number;
  height: number;
  uploadedAt: string;
}

export interface SourceInfo {
  key: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  hasAudio: boolean;
  uploadedAt: string;
  expiresAt: string;
}

export type RenderStatus =
  | 'idle'
  | 'queued'
  | 'segmenting'
  | 'encoding'
  | 'joining'
  | 'done'
  | 'error';

export interface RenderState {
  renderId: string | null;
  status: RenderStatus;
  progress: { done: number; total: number } | null;
  outputKey: string | null;
  outputExpiresAt: string | null;
  error: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

/**
 * The part of the video Make video exports, Premiere's In and Out marks.
 * Times are in the source's seconds, on its frame grid; `outSec` equal to the
 * video's length means "to the end". Null (or missing) is the whole video.
 */
export interface Cut {
  inSec: number;
  outSec: number;
}

export interface VideoTextProject {
  id: string;
  name: string;
  titleText: string;
  creditsText: string;
  lyricsText: string;
  blocks: TextBlock[];
  style: TextStyle;
  /** Optional: projects saved before the cut existed export the whole video. */
  cut?: Cut | null;
  source: SourceInfo | null;
  render: RenderState;
  version: number;
  createdAt: string;
  updatedAt: string;
}
