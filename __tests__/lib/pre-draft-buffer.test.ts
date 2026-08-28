/**
 * Pre-draft buffer — the pure decision + storage logic that protects text
 * typed before a draft record exists.
 */

import {
  PRE_DRAFT_BUFFER_KEY,
  PRE_DRAFT_MAX_AGE_MS,
  readBuffer,
  writeBuffer,
  clearBuffer,
} from '@/lib/pre-draft-buffer';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('writeBuffer', () => {
  it('writes lyrics + title + timestamp under a stable key', () => {
    const s = makeStorage();
    writeBuffer({ lyrics: 'கண்ணே\nஉன்னைக் காண', title: 'கண்ணே' }, s);
    const raw = s.getItem(PRE_DRAFT_BUFFER_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.lyrics).toBe('கண்ணே\nஉன்னைக் காண');
    expect(parsed.title).toBe('கண்ணே');
    expect(typeof parsed.updatedAt).toBe('number');
    expect(parsed.updatedAt).toBeGreaterThan(0);
  });

  it('skips writing empty or whitespace-only lyrics — nothing worth restoring', () => {
    const s = makeStorage();
    writeBuffer({ lyrics: '   \n', title: 'a title' }, s);
    expect(s.getItem(PRE_DRAFT_BUFFER_KEY)).toBeNull();
  });

  it('clears any existing buffer when lyrics go back to empty', () => {
    const s = makeStorage();
    writeBuffer({ lyrics: 'meaningful text', title: '' }, s);
    expect(s.getItem(PRE_DRAFT_BUFFER_KEY)).not.toBeNull();
    writeBuffer({ lyrics: '', title: '' }, s);
    expect(s.getItem(PRE_DRAFT_BUFFER_KEY)).toBeNull();
  });

  it('swallows a quota / storage error rather than interrupting composition', () => {
    const throwing: Storage = {
      ...makeStorage(),
      setItem: () => {
        throw new DOMException('quota exceeded');
      },
    } as Storage;
    expect(() => writeBuffer({ lyrics: 'x', title: 'y' }, throwing)).not.toThrow();
  });
});

describe('readBuffer', () => {
  it('returns null when the store is empty', () => {
    expect(readBuffer(makeStorage())).toBeNull();
  });

  it('round-trips a written buffer', () => {
    const s = makeStorage();
    writeBuffer({ lyrics: 'first line\nsecond', title: 'கண்ணே' }, s);
    const buf = readBuffer(s);
    expect(buf?.lyrics).toBe('first line\nsecond');
    expect(buf?.title).toBe('கண்ணே');
  });

  it('returns null when the stored JSON is corrupt', () => {
    const s = makeStorage();
    s.setItem(PRE_DRAFT_BUFFER_KEY, '{not valid json');
    expect(readBuffer(s)).toBeNull();
  });

  it('returns null when the lyrics field is missing or non-string', () => {
    const s = makeStorage();
    s.setItem(PRE_DRAFT_BUFFER_KEY, JSON.stringify({ title: 'x', updatedAt: Date.now() }));
    expect(readBuffer(s)).toBeNull();
    s.setItem(PRE_DRAFT_BUFFER_KEY, JSON.stringify({ lyrics: 42, updatedAt: Date.now() }));
    expect(readBuffer(s)).toBeNull();
  });

  it('returns null when the lyrics are empty or whitespace — not worth restoring', () => {
    const s = makeStorage();
    s.setItem(PRE_DRAFT_BUFFER_KEY, JSON.stringify({ lyrics: '   \n', title: '', updatedAt: Date.now() }));
    expect(readBuffer(s)).toBeNull();
  });

  it('returns null when the buffer is older than the max age (stale)', () => {
    const s = makeStorage();
    s.setItem(
      PRE_DRAFT_BUFFER_KEY,
      JSON.stringify({
        lyrics: 'stale lyric',
        title: '',
        updatedAt: Date.now() - PRE_DRAFT_MAX_AGE_MS - 1_000,
      })
    );
    expect(readBuffer(s)).toBeNull();
  });

  it('defaults title to empty string when the field is missing', () => {
    const s = makeStorage();
    s.setItem(PRE_DRAFT_BUFFER_KEY, JSON.stringify({ lyrics: 'x', updatedAt: Date.now() }));
    expect(readBuffer(s)?.title).toBe('');
  });
});

describe('clearBuffer', () => {
  it('removes the buffer', () => {
    const s = makeStorage();
    writeBuffer({ lyrics: 'x', title: '' }, s);
    clearBuffer(s);
    expect(s.getItem(PRE_DRAFT_BUFFER_KEY)).toBeNull();
  });

  it('is a no-op when there is nothing to clear', () => {
    expect(() => clearBuffer(makeStorage())).not.toThrow();
  });
});
