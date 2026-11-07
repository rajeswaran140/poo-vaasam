import {
  lyricLines, defaultBlocks, moveBlock, resizeBlock, clampToDuration, syncTextToBlocks,
  validateBlocks, MIN_BLOCK_SEC, unplacedLineCount,
} from '@/lib/video-text/timeline';
import { floorCentis } from '@/lib/video-text/keys';
import type { TextBlock } from '@/types/videoText';

const base = { titleText: 'T', creditsText: 'C', lyricsText: 'l1\nl2\nl3\nl4', durationSec: 344 };
const lyrics = (b: TextBlock[]) => b.filter((x) => x.track === 'lyric');
const get = (b: TextBlock[], id: string) => b.find((x) => x.id === id)!;

describe('lyricLines', () => {
  it('trims and drops empty lines', () => {
    expect(lyricLines('a\n\n  b  \n')).toEqual(['a', 'b']);
    expect(lyricLines('a\r\nb')).toEqual(['a', 'b']);
  });
});

describe('defaultBlocks', () => {
  const blocks = defaultBlocks(base);
  it('places title, credits and tiles lyrics with no gaps', () => {
    const t = blocks.find((b) => b.track === 'title')!;
    const c = blocks.find((b) => b.track === 'credits')!;
    expect([t.startSec, t.endSec]).toEqual([0, 5]);
    expect([c.startSec, c.endSec]).toEqual([334, 344]);
    const l = lyrics(blocks);
    expect(l).toHaveLength(4);
    expect(l[0].startSec).toBe(5);
    expect(l[3].endSec).toBe(334);
    for (let i = 1; i < l.length; i++) expect(l[i].startSec).toBe(l[i - 1].endSec);
  });
  it('is valid and has unique ids', () => {
    expect(validateBlocks(blocks, 344)).toBeNull();
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });
  it('omits empty title and credits', () => {
    const b = defaultBlocks({ ...base, titleText: '  ', creditsText: '' });
    expect(b.some((x) => x.track !== 'lyric')).toBe(false);
  });
});

describe('moveBlock', () => {
  const blocks = defaultBlocks(base);
  it('stops at the next lyric block', () => {
    const l1 = get(blocks, 'lyric-0');
    const l2 = get(blocks, 'lyric-1');
    const out = moveBlock(blocks, 'lyric-0', 200, 344);
    const m = get(out, 'lyric-0');
    expect(m.endSec).toBe(l2.startSec);
    expect(m.endSec - m.startSec).toBeCloseTo(l1.endSec - l1.startSec, 2);
  });
  it('stops at the previous lyric block', () => {
    const l1 = get(blocks, 'lyric-0');
    const out = moveBlock(blocks, 'lyric-1', 0, 344);
    expect(get(out, 'lyric-1').startSec).toBe(l1.endSec);
  });
  it('cannot go below 0 or past the end', () => {
    expect(get(moveBlock(blocks, 'title', -10, 344), 'title').startSec).toBe(0);
    const c = moveBlock(blocks, 'credits', 9999, 344);
    expect(get(c, 'credits').endSec).toBe(344);
  });
  it('does not mutate its input and ignores unknown ids', () => {
    const copy = JSON.stringify(blocks);
    moveBlock(blocks, 'lyric-0', 50, 344);
    expect(JSON.stringify(blocks)).toBe(copy);
    expect(moveBlock(blocks, 'nope', 5, 344)).toEqual(blocks);
  });
});

describe('resizeBlock', () => {
  const blocks = defaultBlocks(base);
  it('enforces the minimum length', () => {
    const a = get(resizeBlock(blocks, 'lyric-0', 'end', 0, 344), 'lyric-0');
    expect(a.endSec - a.startSec).toBeGreaterThanOrEqual(MIN_BLOCK_SEC);
    const b = get(resizeBlock(blocks, 'lyric-0', 'start', 9999, 344), 'lyric-0');
    expect(b.endSec - b.startSec).toBeGreaterThanOrEqual(MIN_BLOCK_SEC);
  });
  it('does not overlap a neighbour', () => {
    const l2 = get(blocks, 'lyric-1');
    expect(get(resizeBlock(blocks, 'lyric-0', 'end', 300, 344), 'lyric-0').endSec).toBe(l2.startSec);
    const l1 = get(blocks, 'lyric-0');
    expect(get(resizeBlock(blocks, 'lyric-1', 'start', 0, 344), 'lyric-1').startSec).toBe(l1.endSec);
  });
  it('stays within the video', () => {
    expect(get(resizeBlock(blocks, 'credits', 'end', 9999, 344), 'credits').endSec).toBe(344);
    expect(get(resizeBlock(blocks, 'title', 'start', -5, 344), 'title').startSec).toBe(0);
  });
});

describe('clampToDuration', () => {
  it('pulls everything inside a shorter video and reports the moves', () => {
    const { blocks, moved } = clampToDuration(defaultBlocks(base), 300);
    expect(moved).toBeGreaterThan(0);
    for (const b of blocks) expect(b.endSec).toBeLessThanOrEqual(300);
    expect(validateBlocks(blocks, 300)).toBeNull();
  });
  it('moves nothing when all blocks fit', () => {
    const b = defaultBlocks(base);
    const r = clampToDuration(b, 400);
    expect(r.moved).toBe(0);
    expect(r.blocks).toEqual(b);
  });
  it('stays valid when the lines cannot keep their length', () => {
    const many = defaultBlocks({ ...base, lyricsText: Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n') });
    const { blocks } = clampToDuration(many, 60);
    expect(validateBlocks(blocks, 60)).toBeNull();
  });
});

describe('syncTextToBlocks', () => {
  const blocks = defaultBlocks(base);
  const texts = { titleText: 'T', creditsText: 'C', lyricsText: 'l1\nl2\nl3\nl4' };
  it('keeps timings when only line 3 text changed', () => {
    const out = syncTextToBlocks(blocks, { ...texts, lyricsText: 'l1\nl2\nCHANGED\nl4' }, 344);
    const l = lyrics(out);
    expect(l.map((b) => b.text)).toEqual(['l1', 'l2', 'CHANGED', 'l4']);
    expect(l[1].startSec).toBe(lyrics(blocks)[1].startSec);
    expect(l[1].endSec).toBe(lyrics(blocks)[1].endSec);
    expect(l[2].startSec).toBe(lyrics(blocks)[2].startSec);
  });
  it('puts a new line in the free gap after the previous block', () => {
    const trimmed = moveBlock(resizeBlock(blocks, 'lyric-3', 'end', 200, 344), 'lyric-3', 200, 344);
    const out = syncTextToBlocks(trimmed, { ...texts, lyricsText: 'l1\nl2\nl3\nl4\nl5' }, 344);
    const l = lyrics(out);
    expect(l).toHaveLength(5);
    expect(l[4].startSec).toBe(l[3].endSec);
    expect(validateBlocks(out, 344)).toBeNull();
  });
  it('drops removed lines and adds/removes title and credits', () => {
    const out = syncTextToBlocks(blocks, { titleText: '', creditsText: 'C', lyricsText: 'l1' }, 344);
    expect(out.some((b) => b.track === 'title')).toBe(false);
    expect(lyrics(out)).toHaveLength(1);
    const back = syncTextToBlocks(out, texts, 344);
    expect(get(back, 'title').endSec).toBe(5);
    expect(validateBlocks(back, 344)).toBeNull();
  });
  it('stays valid when a new line has no room', () => {
    const out = syncTextToBlocks(blocks, { ...texts, lyricsText: 'a\nb\nc\nd\ne\nf' }, 344);
    expect(lyrics(out)).toHaveLength(6);
    expect(validateBlocks(out, 344)).toBeNull();
  });
});

describe('validateBlocks', () => {
  const ok = defaultBlocks(base);
  it('accepts default output', () => expect(validateBlocks(ok, 344)).toBeNull());
  it('flags an overlap', () => {
    const bad = ok.map((b) => (b.id === 'lyric-1' ? { ...b, startSec: b.startSec - 5 } : b));
    expect(validateBlocks(bad, 344)).toEqual(expect.any(String));
  });
  it('flags a negative start', () => {
    expect(validateBlocks(ok.map((b) => (b.id === 'title' ? { ...b, startSec: -1 } : b)), 344)).toEqual(expect.any(String));
  });
  it('flags a block past the end', () => {
    expect(validateBlocks(ok.map((b) => (b.id === 'credits' ? { ...b, endSec: 345 } : b)), 344)).toEqual(expect.any(String));
  });
  it('flags a too-short block', () => {
    expect(validateBlocks([{ id: 'title', track: 'title', text: 'T', startSec: 1, endSec: 1.1 }], 344)).toEqual(expect.any(String));
  });
});

const nLines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`).join('\n');
const lyricsOk = (b: TextBlock[]) => {
  const l = lyrics(b);
  for (let i = 1; i < l.length; i++) expect(l[i].startSec).toBeGreaterThanOrEqual(l[i - 1].endSec - 0.005);
};

describe('F5: clampToDuration re-tiles lyrics inside the lyric region', () => {
  it('344 -> 300 keeps every lyric between the title end and the credits start', () => {
    const { blocks } = clampToDuration(defaultBlocks(base), 300);
    expect(validateBlocks(blocks, 300)).toBeNull();
    const t = get(blocks, 'title');
    const c = get(blocks, 'credits');
    const l = lyrics(blocks);
    expect(l).toHaveLength(4);
    for (const b of l) {
      expect(b.startSec).toBeGreaterThanOrEqual(t.endSec);
      expect(b.endSec).toBeLessThanOrEqual(c.startSec);
    }
  });
  it('falls back to the whole video when the region cannot hold the lines', () => {
    const many = defaultBlocks({ ...base, lyricsText: nLines(40) });
    const { blocks } = clampToDuration(many, 25);
    expect(validateBlocks(blocks, 25)).toBeNull();
    expect(lyrics(blocks)).toHaveLength(40);
  });
});

describe('F6: the generator never produces a layout validateBlocks rejects', () => {
  it.each([
    [12, 3],
    [30, 40],
    [5, 20],
    [3, 4],
    [0.5, 3],
  ])('defaultBlocks at %s s with %s lines', (d, n) => {
    const b = defaultBlocks({ ...base, lyricsText: nLines(n), durationSec: d });
    expect(validateBlocks(b, d)).toBeNull();
    lyricsOk(b);
  });
  it('shrinks title and credits on a short video so lyrics get room', () => {
    const b = defaultBlocks({ ...base, lyricsText: nLines(3), durationSec: 12 });
    expect(get(b, 'title').endSec).toBeLessThan(5);
    expect(get(b, 'credits').endSec - get(b, 'credits').startSec).toBeLessThan(10);
    expect(get(b, 'title').endSec).toBeLessThanOrEqual(get(b, 'credits').startSec);
    for (const l of lyrics(b)) {
      expect(l.startSec).toBeGreaterThanOrEqual(get(b, 'title').endSec);
      expect(l.endSec).toBeLessThanOrEqual(get(b, 'credits').startSec);
    }
  });
  it('keeps the 5 s / 10 s defaults on a full-length video', () => {
    const b = defaultBlocks(base);
    expect(get(b, 'title').endSec).toBe(5);
    expect(get(b, 'credits').startSec).toBe(334);
  });
  it('caps lyrics at what fits and reports the rest as unplaced', () => {
    const texts = { ...base, lyricsText: nLines(20), durationSec: 5 };
    const b = defaultBlocks(texts);
    expect(lyrics(b)).toHaveLength(10);
    expect(unplacedLineCount(b, texts)).toBe(10);
    expect(unplacedLineCount(defaultBlocks(base), base)).toBe(0);
  });
  it('places nothing in a video shorter than the minimum block', () => {
    const b = defaultBlocks({ ...base, durationSec: 0.29 });
    expect(b).toEqual([]);
    expect(validateBlocks(b, 0.29)).toBeNull();
  });
  it('syncTextToBlocks stays valid as lines are added to a short video', () => {
    for (const [d, n] of [[12, 3], [30, 40], [5, 20]] as const) {
      let b = defaultBlocks({ ...base, lyricsText: nLines(1), durationSec: d });
      for (let k = 2; k <= n; k++) {
        b = syncTextToBlocks(b, { titleText: 'T', creditsText: 'C', lyricsText: nLines(k) }, d);
        expect(validateBlocks(b, d)).toBeNull();
        lyricsOk(b);
      }
    }
  });
  it('syncTextToBlocks adds title and credits that fit a short video', () => {
    const b = defaultBlocks({ titleText: '', creditsText: '', lyricsText: nLines(3), durationSec: 4 });
    const out = syncTextToBlocks(b, { titleText: 'T', creditsText: 'C', lyricsText: nLines(3) }, 4);
    expect(validateBlocks(out, 4)).toBeNull();
  });
  it('clampToDuration stays valid down to a very short video', () => {
    const from = defaultBlocks({ ...base, lyricsText: nLines(20) });
    for (const d of [60, 12, 5, 3, 1, 0.5]) {
      const { blocks } = clampToDuration(from, d);
      expect(validateBlocks(blocks, d)).toBeNull();
      lyricsOk(blocks);
    }
  });
});

describe('F1 + F6 property: every 0.01 s length from 0.29 s to 600 s', () => {
  it('defaultBlocks(d) is valid against floorCentis(d)', () => {
    const texts = { titleText: 'T', creditsText: 'C', lyricsText: nLines(6) };
    const specials = [0.29, 128.14, 343.99];
    const ds: number[] = [...specials];
    for (let c = 29; c <= 60000; c += 1) ds.push(c / 100);
    for (const raw of ds) {
      const d = floorCentis(raw);
      expect(floorCentis(d)).toBe(d);
      const problem = validateBlocks(defaultBlocks({ ...texts, durationSec: d }), d);
      if (problem !== null) throw new Error(`d=${d}: ${problem}`);
    }
  });
});
