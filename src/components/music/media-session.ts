/**
 * media-session — a thin, pure wrapper over the W3C Media Session API
 * (navigator.mediaSession) that powers the OS lock-screen / notification
 * "now playing" surface: artwork + title, the play/pause state indicator, the
 * elapsed-time scrubber, and the hardware/notification transport buttons.
 *
 * It's the web counterpart to what react-native-track-player gives the planned
 * Expo app — same intent (background-audio controls), different platform API.
 *
 * Kept framework-agnostic and dependency-injected (navigator + MediaMetadata)
 * so it is fully unit-testable and SSR/old-browser safe: every entry point
 * feature-detects and no-ops rather than throwing.
 */

export interface NowPlayingInfo {
  title: string;
  artist: string;
  album?: string;
  /** Cover image URL; expanded to several sizes for the OS to choose from. */
  artwork?: string;
}

export interface MediaSessionCallbacks {
  play(): void;
  pause(): void;
  previoustrack(): void;
  nexttrack(): void;
  /** Seek to an absolute time (seconds) — from the lock-screen scrubber. */
  seekto?(time: number): void;
  /** Skip back by an offset (seconds). */
  seekbackward?(offset: number): void;
  /** Skip forward by an offset (seconds). */
  seekforward?(offset: number): void;
}

export interface MediaPosition {
  duration: number;
  position: number;
}

export interface MediaSessionDeps {
  navigator?: Navigator;
  metadataCtor?: typeof MediaMetadata;
}

const DEFAULT_SEEK_OFFSET = 10;
const ARTWORK_SIZES = ['128x128', '256x256', '512x512'] as const;

function resolve(deps?: MediaSessionDeps): { nav?: Navigator; metadataCtor?: typeof MediaMetadata } {
  const nav = deps?.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const metadataCtor =
    deps?.metadataCtor ?? (typeof MediaMetadata !== 'undefined' ? MediaMetadata : undefined);
  return { nav, metadataCtor };
}

/** True only when both navigator.mediaSession and MediaMetadata are available. */
export function isMediaSessionSupported(deps?: MediaSessionDeps): boolean {
  const { nav, metadataCtor } = resolve(deps);
  return !!nav && 'mediaSession' in nav && typeof metadataCtor === 'function';
}

function imageMime(url: string): string {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.avif')) return 'image/avif';
  return 'image/jpeg'; // .jpg/.jpeg and anything unrecognised
}

/** Expand a single cover URL into the multi-size artwork the OS expects. */
export function artworkFor(cover: string | undefined): MediaImage[] {
  if (!cover) return [];
  const type = imageMime(cover);
  return ARTWORK_SIZES.map((sizes) => ({ src: cover, sizes, type }));
}

export function setMetadata(info: NowPlayingInfo, deps?: MediaSessionDeps): void {
  if (!isMediaSessionSupported(deps)) return;
  const { nav, metadataCtor } = resolve(deps);
  try {
    nav!.mediaSession.metadata = new metadataCtor!({
      title: info.title,
      artist: info.artist,
      album: info.album ?? '',
      artwork: artworkFor(info.artwork),
    });
  } catch {
    /* MediaMetadata construction failed — leave the previous metadata in place */
  }
}

export function setPlaybackState(
  state: MediaSessionPlaybackState,
  deps?: MediaSessionDeps
): void {
  if (!isMediaSessionSupported(deps)) return;
  const { nav } = resolve(deps);
  nav!.mediaSession.playbackState = state;
}

export function setActionHandlers(callbacks: MediaSessionCallbacks, deps?: MediaSessionDeps): void {
  if (!isMediaSessionSupported(deps)) return;
  const { nav } = resolve(deps);
  const ms = nav!.mediaSession;

  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* this browser doesn't support this particular action */
    }
  };

  set('play', () => callbacks.play());
  set('pause', () => callbacks.pause());
  set('previoustrack', () => callbacks.previoustrack());
  set('nexttrack', () => callbacks.nexttrack());
  set('seekto', callbacks.seekto ? (d) => callbacks.seekto!(d.seekTime ?? 0) : null);
  set(
    'seekbackward',
    callbacks.seekbackward ? (d) => callbacks.seekbackward!(d.seekOffset ?? DEFAULT_SEEK_OFFSET) : null
  );
  set(
    'seekforward',
    callbacks.seekforward ? (d) => callbacks.seekforward!(d.seekOffset ?? DEFAULT_SEEK_OFFSET) : null
  );
}

/** Report (or clear) the scrubber position. Clamps position into [0, duration]. */
export function updatePositionState(pos: MediaPosition, deps?: MediaSessionDeps): void {
  if (!isMediaSessionSupported(deps)) return;
  const { nav } = resolve(deps);
  const ms = nav!.mediaSession;
  if (typeof ms.setPositionState !== 'function') return;

  const duration = Number.isFinite(pos.duration) && pos.duration > 0 ? pos.duration : 0;
  if (duration === 0) {
    ms.setPositionState(); // unknown duration → clear the scrubber
    return;
  }
  const raw = Number.isFinite(pos.position) ? pos.position : 0;
  const position = Math.min(Math.max(0, raw), duration);
  ms.setPositionState({ duration, position, playbackRate: 1 });
}

/** Tear everything down — call when playback stops or the player unmounts. */
export function clearMediaSession(deps?: MediaSessionDeps): void {
  if (!isMediaSessionSupported(deps)) return;
  const { nav } = resolve(deps);
  const ms = nav!.mediaSession;
  ms.metadata = null;
  ms.playbackState = 'none';
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'] as const) {
    try {
      ms.setActionHandler(action, null);
    } catch {
      /* unsupported action */
    }
  }
  if (typeof ms.setPositionState === 'function') {
    try {
      ms.setPositionState();
    } catch {
      /* ignore */
    }
  }
}
