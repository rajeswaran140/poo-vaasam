/** @jest-environment node */
/**
 * media-session — pure browser-API glue for the OS lock-screen / notification
 * player. Tested with an injected fake navigator + MediaMetadata so it runs
 * without a DOM and proves the SSR/unsupported-browser guards never throw.
 */

import {
  isMediaSessionSupported,
  artworkFor,
  setMetadata,
  setPlaybackState,
  setActionHandlers,
  updatePositionState,
  clearMediaSession,
} from '@/components/music/media-session';

class FakeMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: unknown;
  constructor(init: { title: string; artist: string; album: string; artwork: unknown }) {
    this.title = init.title;
    this.artist = init.artist;
    this.album = init.album;
    this.artwork = init.artwork;
  }
}

function fakeSession() {
  const handlers: Record<string, ((d?: unknown) => void) | undefined> = {};
  const ms = {
    metadata: null as unknown,
    playbackState: 'none' as string,
    setActionHandler: jest.fn((action: string, handler: ((d?: unknown) => void) | null) => {
      handlers[action] = handler ?? undefined;
    }),
    setPositionState: jest.fn(),
  };
  const nav = { mediaSession: ms } as unknown as Navigator;
  return { nav, ms, handlers };
}

const deps = (nav: Navigator) => ({
  navigator: nav,
  metadataCtor: FakeMediaMetadata as unknown as typeof MediaMetadata,
});

describe('isMediaSessionSupported', () => {
  it('is true only when both navigator.mediaSession and MediaMetadata exist', () => {
    const { nav } = fakeSession();
    expect(isMediaSessionSupported(deps(nav))).toBe(true);
  });
  it('is false when navigator lacks mediaSession', () => {
    expect(isMediaSessionSupported({ navigator: {} as Navigator, metadataCtor: FakeMediaMetadata as unknown as typeof MediaMetadata })).toBe(false);
  });
  it('is false when MediaMetadata is unavailable (older browsers)', () => {
    const { nav } = fakeSession();
    expect(isMediaSessionSupported({ navigator: nav, metadataCtor: undefined })).toBe(false);
  });
  it('is false (no throw) when nothing is provided (SSR)', () => {
    expect(isMediaSessionSupported({ navigator: undefined, metadataCtor: undefined })).toBe(false);
  });
});

describe('artworkFor', () => {
  it('returns an empty array when there is no cover', () => {
    expect(artworkFor(undefined)).toEqual([]);
    expect(artworkFor('')).toEqual([]);
  });
  it('emits multiple sizes, all pointing at the cover', () => {
    const art = artworkFor('https://cdn/cover.jpg');
    expect(art.length).toBeGreaterThan(1);
    expect(art.every((a) => a.src === 'https://cdn/cover.jpg')).toBe(true);
    expect(art.map((a) => a.sizes)).toContain('512x512');
  });
  it('infers the image MIME type from the extension (ignoring query strings)', () => {
    expect(artworkFor('https://cdn/c.jpg')[0].type).toBe('image/jpeg');
    expect(artworkFor('https://cdn/c.jpeg')[0].type).toBe('image/jpeg');
    expect(artworkFor('https://cdn/c.png')[0].type).toBe('image/png');
    expect(artworkFor('https://cdn/c.webp')[0].type).toBe('image/webp');
    expect(artworkFor('https://cdn/c.png?v=2')[0].type).toBe('image/png');
    expect(artworkFor('https://cdn/c.unknown')[0].type).toBe('image/jpeg'); // safe default
  });
});

describe('setMetadata', () => {
  it('builds MediaMetadata with title/artist/album + artwork', () => {
    const { nav, ms } = fakeSession();
    setMetadata({ title: 'காதல்', artist: 'Raj', album: 'தமிழகவல்', artwork: 'https://cdn/c.jpg' }, deps(nav));
    const md = ms.metadata as FakeMediaMetadata;
    expect(md.title).toBe('காதல்');
    expect(md.artist).toBe('Raj');
    expect(md.album).toBe('தமிழகவல்');
    expect((md.artwork as unknown[]).length).toBeGreaterThan(1);
  });
  it('is a no-op (no throw) when unsupported', () => {
    expect(() => setMetadata({ title: 't', artist: 'a' }, { navigator: undefined, metadataCtor: undefined })).not.toThrow();
  });
});

describe('setPlaybackState', () => {
  it('writes the playback state', () => {
    const { nav, ms } = fakeSession();
    setPlaybackState('playing', deps(nav));
    expect(ms.playbackState).toBe('playing');
    setPlaybackState('paused', deps(nav));
    expect(ms.playbackState).toBe('paused');
  });
});

describe('setActionHandlers', () => {
  it('registers transport handlers and routes them to the callbacks', () => {
    const { nav, handlers } = fakeSession();
    const cb = {
      play: jest.fn(),
      pause: jest.fn(),
      previoustrack: jest.fn(),
      nexttrack: jest.fn(),
    };
    setActionHandlers(cb, deps(nav));
    handlers.play!();
    handlers.pause!();
    handlers.previoustrack!();
    handlers.nexttrack!();
    expect(cb.play).toHaveBeenCalled();
    expect(cb.pause).toHaveBeenCalled();
    expect(cb.previoustrack).toHaveBeenCalled();
    expect(cb.nexttrack).toHaveBeenCalled();
  });
  it('passes the OS seek target to seekto and the offset to seek±', () => {
    const { nav, handlers } = fakeSession();
    const seekto = jest.fn();
    const seekbackward = jest.fn();
    const seekforward = jest.fn();
    setActionHandlers(
      { play: jest.fn(), pause: jest.fn(), previoustrack: jest.fn(), nexttrack: jest.fn(), seekto, seekbackward, seekforward },
      deps(nav)
    );
    handlers.seekto!({ seekTime: 42 });
    handlers.seekbackward!({ seekOffset: 5 });
    handlers.seekforward!({}); // no offset → default
    expect(seekto).toHaveBeenCalledWith(42);
    expect(seekbackward).toHaveBeenCalledWith(5);
    expect(seekforward).toHaveBeenCalledWith(expect.any(Number));
  });
});

describe('updatePositionState', () => {
  it('reports a clamped position within the duration', () => {
    const { nav, ms } = fakeSession();
    updatePositionState({ duration: 200, position: 50 }, deps(nav));
    expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 200, position: 50, playbackRate: 1 });
  });
  it('clamps an overshooting position down to the duration', () => {
    const { nav, ms } = fakeSession();
    updatePositionState({ duration: 200, position: 999 }, deps(nav));
    expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 200, position: 200, playbackRate: 1 });
  });
  it('clears the position state when the duration is unknown / zero', () => {
    const { nav, ms } = fakeSession();
    updatePositionState({ duration: 0, position: 10 }, deps(nav));
    expect(ms.setPositionState).toHaveBeenCalledWith();
  });
});

describe('clearMediaSession', () => {
  it('drops metadata, resets state, and unregisters handlers', () => {
    const { nav, ms } = fakeSession();
    setMetadata({ title: 't', artist: 'a' }, deps(nav));
    setActionHandlers({ play: jest.fn(), pause: jest.fn(), previoustrack: jest.fn(), nexttrack: jest.fn() }, deps(nav));
    clearMediaSession(deps(nav));
    expect(ms.metadata).toBeNull();
    expect(ms.playbackState).toBe('none');
    expect(ms.setActionHandler).toHaveBeenCalledWith('play', null);
    expect(ms.setActionHandler).toHaveBeenCalledWith('nexttrack', null);
  });
});
