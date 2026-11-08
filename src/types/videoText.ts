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

export type TamilFontId = 'noto-sans-tamil' | 'noto-serif-tamil' | 'mukta-malar' | 'arima' | 'baloo-thambi-2' | 'kavivanar';
export type EnglishFontId = 'plain' | 'montserrat' | 'poppins' | 'playfair-display' | 'lora' | 'oswald' | 'dancing-script';

/** One part's own look. Missing fields fall back (size → TextStyle.sizeScale, fonts → the defaults). */
export interface TrackStyle {
  /** 0.5–2, a multiple of the part's base size. */
  size?: number;
  tamilFont?: TamilFontId;
  englishFont?: EnglishFontId;
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

export interface VideoTextProject {
  id: string;
  name: string;
  titleText: string;
  creditsText: string;
  lyricsText: string;
  blocks: TextBlock[];
  style: TextStyle;
  source: SourceInfo | null;
  render: RenderState;
  version: number;
  createdAt: string;
  updatedAt: string;
}
