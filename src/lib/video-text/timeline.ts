/**
 * Timeline logic for the Video Text tool. Pure — no DOM, no AWS.
 *
 * Three tracks: one title block, one credits block, and one block per
 * non-empty lyric line. Blocks on the same track never overlap (two lyric
 * lines must not draw on top of each other); moves and resizes clamp at a
 * neighbour's edge instead. All times are rounded to 0.01 s.
 */
import type { TextBlock, Track } from '@/types/videoText';

export const TITLE_DEFAULT_SEC = 5;
export const CREDITS_DEFAULT_SEC = 10;
export const MIN_BLOCK_SEC = 0.5;

const EPS = 0.005;
const TRACK_ORDER: Track[] = ['title', 'lyric', 'credits'];

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** Trimmed, non-empty lines. */
export function lyricLines(lyricsText: string): string[] {
  return String(lyricsText ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function singleLine(text: string): string[] {
  const t = String(text ?? '').trim();
  return t ? [t] : [];
}

function sorted(blocks: TextBlock[]): TextBlock[] {
  return [...blocks].sort(
    (a, b) =>
      TRACK_ORDER.indexOf(a.track) - TRACK_ORDER.indexOf(b.track) ||
      a.startSec - b.startSec ||
      a.endSec - b.endSec,
  );
}

function trackBlocks(blocks: TextBlock[], track: Track): TextBlock[] {
  return blocks.filter((b) => b.track === track).sort((a, b) => a.startSec - b.startSec);
}

/** Evenly tile `n` lines over [from, to] with shared, 0.01-rounded edges. */
function tile(n: number, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const span = Math.max(0, to - from);
  for (let i = 0; i < n; i++) {
    out.push([r2(from + (span * i) / n), r2(from + (span * (i + 1)) / n)]);
  }
  return out;
}

function lyricRegion(hasTitle: boolean, hasCredits: boolean, durationSec: number): [number, number] {
  const from = hasTitle ? Math.min(TITLE_DEFAULT_SEC, durationSec) : 0;
  const to = hasCredits ? Math.max(from, durationSec - CREDITS_DEFAULT_SEC) : durationSec;
  return [r2(from), r2(to)];
}

function titleBlock(text: string): TextBlock {
  return { id: 'title', track: 'title', text, startSec: 0, endSec: TITLE_DEFAULT_SEC };
}

function creditsBlock(text: string, durationSec: number): TextBlock {
  return {
    id: 'credits',
    track: 'credits',
    text,
    startSec: r2(Math.max(0, durationSec - CREDITS_DEFAULT_SEC)),
    endSec: r2(durationSec),
  };
}

export function defaultBlocks(input: {
  titleText: string;
  creditsText: string;
  lyricsText: string;
  durationSec: number;
}): TextBlock[] {
  const { durationSec } = input;
  const title = singleLine(input.titleText)[0];
  const credits = singleLine(input.creditsText)[0];
  const lines = lyricLines(input.lyricsText);
  const out: TextBlock[] = [];
  if (title !== undefined) out.push({ ...titleBlock(title), endSec: r2(Math.min(TITLE_DEFAULT_SEC, durationSec)) });
  const [from, to] = lyricRegion(title !== undefined, credits !== undefined, durationSec);
  tile(lines.length, from, to).forEach(([s, e], i) =>
    out.push({ id: `lyric-${i}`, track: 'lyric', text: lines[i], startSec: s, endSec: e }),
  );
  if (credits !== undefined) out.push(creditsBlock(credits, durationSec));
  return out;
}

function neighbours(blocks: TextBlock[], target: TextBlock) {
  const same = trackBlocks(blocks, target.track).filter((b) => b.id !== target.id);
  const prev = same.filter((b) => b.startSec < target.startSec || (b.startSec === target.startSec && b.endSec <= target.startSec));
  const next = same.filter((b) => !prev.includes(b));
  return {
    prevEnd: prev.reduce((m, b) => Math.max(m, b.endSec), 0),
    nextStart: next.reduce((m, b) => Math.min(m, b.startSec), Infinity),
  };
}

/** Move a block, keeping its length; stops at the video edges and same-track neighbours. */
export function moveBlock(blocks: TextBlock[], id: string, newStartSec: number, durationSec: number): TextBlock[] {
  const target = blocks.find((b) => b.id === id);
  if (!target || !Number.isFinite(newStartSec)) return blocks;
  const len = target.endSec - target.startSec;
  const { prevEnd, nextStart } = neighbours(blocks, target);
  const lo = prevEnd;
  const hi = Math.min(durationSec, nextStart) - len;
  if (hi < lo) return blocks; // no room to move
  const start = r2(clamp(newStartSec, lo, hi));
  const end = r2(start + len);
  return blocks.map((b) => (b.id === id ? { ...b, startSec: start, endSec: end } : b));
}

/** Drag one edge; the block keeps at least MIN_BLOCK_SEC and never meets a neighbour. */
export function resizeBlock(
  blocks: TextBlock[],
  id: string,
  edge: 'start' | 'end',
  sec: number,
  durationSec: number,
): TextBlock[] {
  const target = blocks.find((b) => b.id === id);
  if (!target || !Number.isFinite(sec)) return blocks;
  const { prevEnd, nextStart } = neighbours(blocks, target);
  let { startSec, endSec } = target;
  if (edge === 'start') {
    startSec = r2(clamp(sec, prevEnd, Math.max(prevEnd, endSec - MIN_BLOCK_SEC)));
  } else {
    const limit = Math.min(durationSec, nextStart);
    endSec = r2(clamp(sec, Math.min(limit, startSec + MIN_BLOCK_SEC), limit));
  }
  return blocks.map((b) => (b.id === id ? { ...b, startSec, endSec } : b));
}

/**
 * Pull blocks inside a (shorter) video. Each overflowing block shifts left,
 * keeping its length where it can, and pushes earlier blocks along. If the
 * lines cannot fit at all, the track is re-tiled evenly. `moved` counts blocks
 * whose times changed.
 */
export function clampToDuration(
  blocks: TextBlock[],
  durationSec: number,
): { blocks: TextBlock[]; moved: number } {
  const result = new Map<string, TextBlock>();
  for (const track of TRACK_ORDER) {
    const list = trackBlocks(blocks, track);
    let limit = durationSec;
    const fixed: TextBlock[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const len = b.endSec - b.startSec;
      const end = Math.min(b.endSec, limit);
      let start = Math.min(b.startSec, end - len);
      let e = end;
      if (start < 0) {
        start = 0;
        e = Math.min(end, Math.max(MIN_BLOCK_SEC, 0 + len));
      }
      fixed.unshift({ ...b, startSec: r2(Math.max(0, start)), endSec: r2(e) });
      limit = Math.max(0, start);
    }
    const bad = fixed.some((b) => b.endSec - b.startSec < MIN_BLOCK_SEC - EPS || b.endSec > durationSec + EPS);
    const retile = bad || fixed.some((b, i) => i > 0 && b.startSec < fixed[i - 1].endSec - EPS);
    const final = retile
      ? tile(fixed.length, 0, durationSec).map(([s, e], i) => ({ ...fixed[i], startSec: s, endSec: e }))
      : fixed;
    final.forEach((b) => result.set(b.id, b));
  }
  let moved = 0;
  const out = blocks.map((b) => {
    const n = result.get(b.id) ?? b;
    if (Math.abs(n.startSec - b.startSec) > EPS || Math.abs(n.endSec - b.endSec) > EPS) moved++;
    return n;
  });
  return { blocks: out, moved };
}

/**
 * Re-key blocks to edited text. Within a track, line i keeps block i's
 * timing (even when its text changed). Extra lines go into the free gap after
 * the previous block; surplus blocks are dropped. If a track has no room for
 * its new lines it is re-tiled evenly.
 */
export function syncTextToBlocks(
  blocks: TextBlock[],
  texts: { titleText: string; creditsText: string; lyricsText: string },
  durationSec: number,
): TextBlock[] {
  const lines: Record<Track, string[]> = {
    title: singleLine(texts.titleText),
    lyric: lyricLines(texts.lyricsText),
    credits: singleLine(texts.creditsText),
  };
  const out: TextBlock[] = [];

  for (const track of TRACK_ORDER) {
    const existing = trackBlocks(blocks, track);
    const want = lines[track];
    const used = new Set(existing.map((b) => b.id));
    const made: TextBlock[] = [];
    let needRetile = false;

    want.forEach((text, i) => {
      const old = existing[i];
      if (old) {
        made.push({ ...old, text });
        return;
      }
      if (track === 'title') return void made.push({ ...titleBlock(text), endSec: r2(Math.min(TITLE_DEFAULT_SEC, durationSec)) });
      if (track === 'credits') return void made.push(creditsBlock(text, durationSec));
      let id = `lyric-${i}`;
      for (let n = i; used.has(id); n++) id = `lyric-${n + 1}`;
      used.add(id);
      const prevEnd = made.length ? made[made.length - 1].endSec : 0;
      const avg = existing.length
        ? existing.reduce((s, b) => s + (b.endSec - b.startSec), 0) / existing.length
        : 3;
      const len = Math.max(MIN_BLOCK_SEC, Math.min(avg, 5));
      const end = r2(Math.min(prevEnd + len, durationSec));
      if (end - prevEnd < MIN_BLOCK_SEC - EPS) needRetile = true;
      made.push({ id, track, text, startSec: r2(prevEnd), endSec: end });
    });

    if (needRetile && track === 'lyric') {
      const [from, to] = lyricRegion(lines.title.length > 0, lines.credits.length > 0, durationSec);
      tile(made.length, from, to).forEach(([s, e], i) => {
        made[i] = { ...made[i], startSec: s, endSec: e };
      });
    }
    out.push(...made);
  }
  return sorted(out);
}

/** A human-readable problem with the layout, or null when it is renderable. */
export function validateBlocks(blocks: TextBlock[], durationSec: number): string | null {
  for (const b of blocks) {
    if (!Number.isFinite(b.startSec) || !Number.isFinite(b.endSec)) return `"${b.text}" has an invalid time.`;
    if (b.startSec < 0) return `"${b.text}" starts before the video begins.`;
    if (b.endSec > durationSec + EPS) return `"${b.text}" runs past the end of the video.`;
    if (b.endSec - b.startSec < MIN_BLOCK_SEC - EPS) return `"${b.text}" is shorter than ${MIN_BLOCK_SEC} seconds.`;
  }
  for (const track of TRACK_ORDER) {
    const list = trackBlocks(blocks, track);
    for (let i = 1; i < list.length; i++) {
      if (list[i].startSec < list[i - 1].endSec - EPS) {
        return `"${list[i - 1].text}" and "${list[i].text}" overlap.`;
      }
    }
  }
  return null;
}
