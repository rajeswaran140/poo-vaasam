import {
  lyricLines, defaultBlocks, moveBlock, resizeBlock, clampToDuration, syncTextToBlocks,
  validateBlocks, MIN_BLOCK_SEC, unplacedLineCount, tapLyric, endLyricAt, dragEdge, sameBlocks,
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

describe('syncTextToBlocks keeps hand-made timing (audit C1/I1)', () => {
  const D = 344;
  // Hand-timed lyrics: irregular slots with gaps, as Raj would leave them.
  const hand = (texts: string[], startAt = 10): TextBlock[] => {
    let t = startAt;
    return texts.map((text, i) => {
      const len = 3 + (i % 3); // 3, 4, 5 s
      const b: TextBlock = { id: `lyric-${i}`, track: 'lyric', text, startSec: t, endSec: t + len };
      t += len + 1; // 1 s gap
      return b;
    });
  };
  const sync = (b: TextBlock[], lyricsText: string, extra: Partial<{ titleText: string; creditsText: string }> = {}, mem = {}) =>
    syncTextToBlocks(b, { titleText: '', creditsText: '', lyricsText, ...extra }, D, mem);
  const times = (b: TextBlock[]) => lyrics(b).map((x) => [x.text, x.startSec, x.endSec]);
  const six = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

  it('deleting a middle line leaves its gap; every other line keeps its time', () => {
    const b = hand(six);
    const out = sync(b, 'L1\nL3\nL4\nL5\nL6');
    expect(times(out)).toEqual(times(b).filter(([t]) => t !== 'L2'));
  });

  it('inserting a line mid-list fills the gap there; nothing after it moves', () => {
    const b = hand(six);
    const out = sync(b, 'L1\nL2\nNEW\nL3\nL4\nL5\nL6');
    const l = lyrics(out);
    const l2 = get(b, 'lyric-1');
    const l3 = get(b, 'lyric-2');
    const ins = l.find((x) => x.text === 'NEW')!;
    expect(ins.startSec).toBe(l2.endSec);
    expect(ins.endSec).toBe(l3.startSec); // the 1 s gap
    for (const old of b) expect(l.find((x) => x.text === old.text)).toMatchObject({ startSec: old.startSec, endSec: old.endSec });
    expect(validateBlocks(out, D)).toBeNull();
  });

  it('inserting where there is no gap shares the previous line\'s time; only that line changes', () => {
    const tight: TextBlock[] = [
      { id: 'lyric-0', track: 'lyric', text: 'A', startSec: 10, endSec: 14 },
      { id: 'lyric-1', track: 'lyric', text: 'B', startSec: 14, endSec: 18 },
    ];
    const out = sync(tight, 'A\nNEW\nB');
    expect(times(out)).toEqual([['A', 10, 12], ['NEW', 12, 14], ['B', 14, 18]]);
  });

  it('adding a line when the last lyric runs to the end of the video does not re-tile the others', () => {
    const b: TextBlock[] = [
      { id: 'lyric-0', track: 'lyric', text: 'A', startSec: 5, endSec: 40 },
      { id: 'lyric-1', track: 'lyric', text: 'B', startSec: 50, endSec: D },
    ];
    const out = sync(b, 'A\nB\nC');
    expect(times(out).slice(0, 1)).toEqual([['A', 5, 40]]);
    const l = lyrics(out);
    expect(l[1]).toMatchObject({ text: 'B', startSec: 50 });
    expect(l[2]).toMatchObject({ text: 'C', endSec: D });
    expect(validateBlocks(out, D)).toBeNull();
  });

  it('editing one line keeps its slot; typing letter by letter never moves anything', () => {
    const b = hand(six);
    let out = b;
    for (const typed of ['L3x', 'L3xy', 'L3xyz']) out = sync(out, `L1\nL2\n${typed}\nL4\nL5\nL6`);
    expect(times(out).map(([, s, e]) => [s, e])).toEqual(times(b).map(([, s, e]) => [s, e]));
    expect(lyrics(out)[2].text).toBe('L3xyz');
  });

  it('clearing a line then typing it again puts it back in its old slot', () => {
    const b = hand(six);
    const cleared = sync(b, 'L1\nL2\n\nL4\nL5\nL6');
    const old = get(b, 'lyric-2');
    // The editor remembers the removed slot and passes it back.
    const back = sync(cleared, 'L1\nL2\nR\nL4\nL5\nL6', {}, { lyrics: [{ startSec: old.startSec, endSec: old.endSec }] });
    expect(lyrics(back).find((x) => x.text === 'R')).toMatchObject({ startSec: old.startSec, endSec: old.endSec });
    // Without the memory it still lands in that gap, starting where L2 ends.
    const guess = lyrics(sync(cleared, 'L1\nL2\nR\nL4\nL5\nL6')).find((x) => x.text === 'R')!;
    expect(guess.startSec).toBe(get(b, 'lyric-1').endSec);
    expect(guess.endSec).toBeLessThanOrEqual(get(b, 'lyric-3').startSec);
    for (const t of ['L1', 'L2', 'L4', 'L5', 'L6']) {
      expect(lyrics(back).find((x) => x.text === t)).toMatchObject(lyrics(b).find((x) => x.text === t)!);
    }
  });

  it('repeated chorus lines are matched in order', () => {
    const b = hand(['Ch', 'V1', 'Ch', 'V2', 'Ch']);
    const out = sync(b, 'Ch\nV1\nCh\nCh'); // V2 deleted
    expect(times(out)).toEqual([times(b)[0], times(b)[1], times(b)[2], times(b)[4]]);
  });

  it('pasting into an empty lyric track still spreads the lines evenly', () => {
    const out = sync([], 'a\nb\nc\nd', { titleText: 'T', creditsText: 'C' });
    expect(out.filter((x) => x.track === 'lyric')).toEqual(lyrics(defaultBlocks({ titleText: 'T', creditsText: 'C', lyricsText: 'a\nb\nc\nd', durationSec: D })));
  });

  it('a cleared title comes back at its remembered times, not the default', () => {
    const b: TextBlock[] = [{ id: 'title', track: 'title', text: 'Song', startSec: 0, endSec: D }];
    const cleared = sync(b, '', { titleText: '' });
    expect(cleared).toEqual([]);
    const back = sync(cleared, '', { titleText: 'S' }, { title: { startSec: 0, endSec: D } });
    expect(back).toEqual([{ id: 'title', track: 'title', text: 'S', startSec: 0, endSec: D }]);
    // Without a memory it falls back to the default spot.
    expect(sync(cleared, '', { titleText: 'S' })[0]).toMatchObject({ startSec: 0, endSec: 5 });
  });

  it('fuzz: random edits never break validity and never move an unchanged line', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 300; run++) {
      const lines = Array.from({ length: 3 + Math.floor(rnd() * 20) }, (_, i) => `r${run}-${i}`);
      let b = sync([], lines.join('\n'));
      for (let step = 0; step < 15; step++) {
        const before = new Map(lyrics(b).map((x) => [x.text, x]));
        const op = rnd();
        const at = Math.floor(rnd() * (lines.length + 1));
        if (op < 0.4) lines.splice(at, 0, `n${run}-${step}`);
        else if (op < 0.7 && lines.length > 1) lines.splice(Math.min(at, lines.length - 1), 1);
        else if (lines.length) lines[Math.min(at, lines.length - 1)] += 'x';
        b = sync(b, lines.join('\n'));
        expect(validateBlocks(b, D)).toBeNull();
        lyricsOk(b);
        // Lines present before and after, with neighbours that also survived, keep their exact times
        // unless they were the one neighbour that shared time with an inserted line.
        const changed = lyrics(b).filter((x) => before.has(x.text) && (before.get(x.text)!.startSec !== x.startSec || before.get(x.text)!.endSec !== x.endSec));
        expect(changed.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('syncTextToBlocks: emptied box, ids, duplicates (final review)', () => {
  const D = 344;
  const hand: TextBlock[] = [
    { id: 'lyric-0', track: 'lyric', text: 'Ch', startSec: 30, endSec: 33 },
    { id: 'lyric-1', track: 'lyric', text: 'V1', startSec: 50, endSec: 52 },
    { id: 'lyric-2', track: 'lyric', text: 'Ch', startSec: 80, endSec: 90 },
  ];
  const t = (lyricsText: string) => ({ titleText: '', creditsText: '', lyricsText });

  it('refilling an emptied box from the remembered track brings every line back to its time', () => {
    const emptied = syncTextToBlocks(hand, t(''), D);
    expect(lyrics(emptied)).toEqual([]);
    const back = syncTextToBlocks(emptied, t('Ch\nV1\nCh'), D, { lyricTrack: hand });
    expect(lyrics(back).map((b) => [b.text, b.startSec, b.endSec])).toEqual([['Ch', 30, 33], ['V1', 50, 52], ['Ch', 80, 90]]);
  });

  it('a partly different refill keeps the matching lines and places the rest in gaps', () => {
    const back = syncTextToBlocks([], t('Ch\nNEW\nCh'), D, { lyricTrack: hand });
    const l = lyrics(back);
    expect(l[0]).toMatchObject({ text: 'Ch', startSec: 30, endSec: 33 });
    expect(l[2]).toMatchObject({ text: 'Ch', startSec: 80, endSec: 90 });
    expect(l[1]).toMatchObject({ text: 'NEW', startSec: 50, endSec: 52 }); // took V1's slot as an edit
    expect(validateBlocks(back, D)).toBeNull();
  });

  it('without a remembered track, a paste into an empty box still spreads evenly', () => {
    const out = syncTextToBlocks([], t('a\nb'), D);
    expect(lyrics(out)).toEqual(lyrics(defaultBlocks({ titleText: '', creditsText: '', lyricsText: 'a\nb', durationSec: D })));
  });

  it('a new line never reuses the id of a removed line', () => {
    const removed = syncTextToBlocks(hand, t('Ch\nV1'), D); // lyric-2 gone
    const added = syncTextToBlocks(removed, t('Ch\nV1\nX'), D, { lyrics: [{ startSec: 80, endSec: 90, id: 'lyric-2' }] });
    const x = lyrics(added).find((b) => b.text === 'X')!;
    expect(x.id).not.toBe('lyric-2');
    expect(new Set(added.map((b) => b.id)).size).toBe(added.length);
  });

  it('fuzz with repeated chorus lines and empty-then-refill: always valid, never duplicate ids, refill restores', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pool = ['Ch', 'Ch', 'V1', 'V2', 'Br', 'Ch'];
    for (let run = 0; run < 200; run++) {
      const lines = Array.from({ length: 3 + Math.floor(rnd() * 10) }, () => pool[Math.floor(rnd() * pool.length)]);
      let b = syncTextToBlocks([], t(lines.join('\n')), D);
      for (let step = 0; step < 12; step++) {
        const op = rnd();
        if (op < 0.15) {
          // Empty the box, then paste the same text back.
          const track = lyrics(b);
          const emptied = syncTextToBlocks(b, t(''), D);
          const back = syncTextToBlocks(emptied, t(lines.join('\n')), D, { lyricTrack: track });
          expect(lyrics(back).map((x) => [x.text, x.startSec, x.endSec])).toEqual(track.map((x) => [x.text, x.startSec, x.endSec]));
          b = back;
          continue;
        }
        const at = Math.floor(rnd() * (lines.length + 1));
        if (op < 0.5) lines.splice(at, 0, pool[Math.floor(rnd() * pool.length)]);
        else if (op < 0.8 && lines.length > 1) lines.splice(Math.min(at, lines.length - 1), 1);
        else if (lines.length) lines[Math.min(at, lines.length - 1)] += 'x';
        b = syncTextToBlocks(b, t(lines.join('\n')), D);
        expect(validateBlocks(b, D)).toBeNull();
        lyricsOk(b);
        expect(new Set(b.map((x) => x.id)).size).toBe(b.length);
      }
    }
  });
});

describe('tap to time', () => {
  const D = 60;
  const lines = (n: number): TextBlock[] =>
    Array.from({ length: n }, (_, i) => ({ id: `lyric-${i}`, track: 'lyric' as const, text: `L${i}`, startSec: 5 + i * 4, endSec: 8 + i * 4 }));
  const title: TextBlock = { id: 'title', track: 'title', text: 'T', startSec: 0, endSec: 5 };
  const times = (b: TextBlock[]) => lyrics(b).map((x) => [x.startSec, x.endSec]);

  it('a session of taps lays the lines back to back, each starting at its tap', () => {
    let b: TextBlock[] = [title, ...lines(3)];
    b = tapLyric(b, 0, 10.2, D, { closePrevious: false })!;
    b = tapLyric(b, 1, 13.7, D, { closePrevious: true })!;
    b = tapLyric(b, 2, 18.05, D, { closePrevious: true })!;
    b = endLyricAt(b, 2, 21.5, D)!;
    expect(times(b)).toEqual([[10.2, 13.7], [13.7, 18.05], [18.05, 21.5]]);
    expect(get(b, 'title')).toEqual(title); // other tracks untouched
    expect(validateBlocks(b, D)).toBeNull();
  });

  it('later lines are pushed, never overlapped, keeping their length', () => {
    const b = tapLyric(lines(3), 0, 20, D, { closePrevious: false })!;
    expect(times(b)).toEqual([[20, 23], [23, 26], [26, 29]]);
  });

  it('a tap less than half a second after the previous line started is refused', () => {
    let b = tapLyric(lines(2), 0, 10, D, { closePrevious: false })!;
    expect(tapLyric(b, 1, 10.3, D, { closePrevious: true })).toBeNull();
    b = tapLyric(b, 1, 10.5, D, { closePrevious: true })!;
    expect(times(b)[0]).toEqual([10, 10.5]);
  });

  it('starting mid-list without a previous tap only trims the previous line if it overlaps', () => {
    const b = tapLyric(lines(3), 1, 12, D, { closePrevious: false })!;
    expect(times(b)[0]).toEqual([5, 8]); // ended before 12: kept
    const c = tapLyric(lines(3), 1, 6, D, { closePrevious: false })!;
    expect(times(c)[0]).toEqual([5, 6]); // overlapped: cut at the tap
  });

  it('near the end, the remaining lines are squeezed in, or the tap is refused if they cannot fit', () => {
    const b = tapLyric(lines(4), 1, 55, D, { closePrevious: false })!;
    expect(validateBlocks(b, D)).toBeNull();
    expect(lyrics(b).at(-1)!.endSec).toBeLessThanOrEqual(D);
    expect(tapLyric(lines(4), 1, 59.4, D, { closePrevious: false })).toBeNull();
  });

  it('endLyricAt refuses an end less than half a second after the start', () => {
    const b = tapLyric(lines(1), 0, 10, D, { closePrevious: false })!;
    expect(endLyricAt(b, 0, 10.2, D)).toBeNull();
    expect(times(endLyricAt(b, 0, 12, D)!)).toEqual([[10, 12]]);
  });

  it('fuzz: any tap sequence keeps the layout valid', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 300; run++) {
      let b = lines(2 + Math.floor(rnd() * 12));
      let t = rnd() * 10;
      const n = lyrics(b).length;
      for (let k = 0; k < n; k++) {
        t += rnd() * 4;
        const next = tapLyric(b, k, t, D, { closePrevious: k > 0 });
        if (next) b = next;
        expect(validateBlocks(b, D)).toBeNull();
        lyricsOk(b);
      }
    }
  });
});

describe('dragEdge (rolling edit) and resize guards', () => {
  const L = (id: string, s: number, e: number): TextBlock => ({ id, track: 'lyric', text: id, startSec: s, endSec: e });
  const row = [L('a', 0, 10), L('b', 10, 20), L('c', 20, 30)];

  it('end into a touching neighbour moves both; the neighbour keeps half a second', () => {
    expect(get(dragEdge(row, 'b', 'end', 25, 60), 'c')).toMatchObject({ startSec: 25, endSec: 30 });
    const far = dragEdge(row, 'b', 'end', 40, 60);
    expect(get(far, 'b').endSec).toBe(29.5);
    expect(get(far, 'c').startSec).toBe(29.5);
    expect(validateBlocks(far, 60)).toBeNull();
  });

  it('start into a touching neighbour moves both', () => {
    const out = dragEdge(row, 'b', 'start', 4, 60);
    expect(get(out, 'a')).toMatchObject({ startSec: 0, endSec: 4 });
    expect(get(out, 'b')).toMatchObject({ startSec: 4, endSec: 20 });
  });

  it('pulling away, or with a gap, is a plain resize', () => {
    expect(dragEdge(row, 'b', 'end', 15, 60)).toEqual(resizeBlock(row, 'b', 'end', 15, 60));
    const gap = [L('a', 0, 8), L('b', 10, 20)];
    expect(get(dragEdge(gap, 'b', 'start', 2, 60), 'b').startSec).toBe(8);
  });

  it('fuzz: dragEdge never produces a layout validateBlocks rejects', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 3000; n++) {
      let blocks = defaultBlocks({ ...base, lyricsText: 'a\nb\nc\nd\ne', durationSec: 60 });
      for (let k = 0; k < 8; k++) {
        const t = blocks[Math.floor(rnd() * blocks.length)];
        blocks = dragEdge(blocks, t.id, rnd() < 0.5 ? 'start' : 'end', r2(rnd() * 70 - 5), 60);
        expect(validateBlocks(blocks, 60)).toBeNull();
      }
    }
  });

  it('resizeBlock leaves an already-hemmed block alone instead of making it too short', () => {
    const bad = [L('a', 0, 5.8), L('b', 5, 6)];
    expect(resizeBlock(bad, 'b', 'start', 5.2, 10)).toBe(bad);
  });

  it('sameBlocks spots a no-op edit', () => {
    expect(sameBlocks(row, moveBlock(row, 'b', 15, 60))).toBe(true);
    expect(sameBlocks(row, dragEdge(row, 'b', 'end', 25, 60))).toBe(false);
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;
