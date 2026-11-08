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

/**
 * Slots for `n` blocks of one track: evenly over [from, to] when that gives
 * each at least MIN_BLOCK_SEC, else evenly over the whole video (the track may
 * then overlap the others, never itself). A video too short for all of them
 * gets floor(d / MIN_BLOCK_SEC) slots; the remaining lines stay unplaced.
 * Rounded edges keep every slot >= MIN_BLOCK_SEC: r2 is monotone and
 * r2(x + 0.5) = r2(x) + 0.5, so a step of at least 0.5 s survives rounding.
 */
function slots(n: number, from: number, to: number, durationSec: number): Array<[number, number]> {
  if (n <= 0) return [];
  if (to - from >= n * MIN_BLOCK_SEC) return tile(n, from, to);
  const fit = Math.min(n, Math.floor(durationSec / MIN_BLOCK_SEC));
  return tile(fit, 0, durationSec);
}

/**
 * Default title and credits lengths: 5 s and 10 s, shrunk on short videos
 * (15% and 20% of the length) so lyrics keep room, and never under
 * MIN_BLOCK_SEC or past the end.
 */
function edgeLengths(durationSec: number): { title: number; credits: number } {
  const fit = (want: number) => r2(clamp(want, MIN_BLOCK_SEC, durationSec));
  return {
    title: fit(Math.min(TITLE_DEFAULT_SEC, durationSec * 0.15)),
    credits: fit(Math.min(CREDITS_DEFAULT_SEC, durationSec * 0.2)),
  };
}

function lyricRegion(hasTitle: boolean, hasCredits: boolean, durationSec: number): [number, number] {
  const { title, credits } = edgeLengths(durationSec);
  const from = hasTitle ? title : 0;
  const to = hasCredits ? Math.max(from, r2(durationSec - credits)) : durationSec;
  return [r2(from), r2(to)];
}

function titleBlock(text: string, durationSec: number): TextBlock {
  return { id: 'title', track: 'title', text, startSec: 0, endSec: edgeLengths(durationSec).title };
}

function creditsBlock(text: string, durationSec: number): TextBlock {
  return {
    id: 'credits',
    track: 'credits',
    text,
    startSec: r2(Math.max(0, durationSec - edgeLengths(durationSec).credits)),
    endSec: r2(durationSec),
  };
}

/** Blocks that cannot be made at least MIN_BLOCK_SEC long are not made at all. */
const tooShort = (durationSec: number) => !(durationSec >= MIN_BLOCK_SEC);

/**
 * How many text lines (title, lyric lines, credits) have no block: the video
 * is too short to give each one MIN_BLOCK_SEC. The editor says so.
 */
export function unplacedLineCount(
  blocks: TextBlock[],
  texts: { titleText: string; creditsText: string; lyricsText: string },
): number {
  const want =
    singleLine(texts.titleText).length + singleLine(texts.creditsText).length + lyricLines(texts.lyricsText).length;
  return Math.max(0, want - blocks.length);
}

export function defaultBlocks(input: {
  titleText: string;
  creditsText: string;
  lyricsText: string;
  durationSec: number;
}): TextBlock[] {
  const { durationSec } = input;
  if (tooShort(durationSec)) return [];
  const title = singleLine(input.titleText)[0];
  const credits = singleLine(input.creditsText)[0];
  const lines = lyricLines(input.lyricsText);
  const out: TextBlock[] = [];
  if (title !== undefined) out.push(titleBlock(title, durationSec));
  const [from, to] = lyricRegion(title !== undefined, credits !== undefined, durationSec);
  slots(lines.length, from, to, durationSec).forEach(([s, e], i) =>
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
 * keeping its length where it can, and pushes earlier blocks along. If a
 * track's lines cannot fit that way it is re-tiled evenly: title and credits
 * at their default spots, lyrics between the (clamped) title end and credits
 * start — or over the whole video when that region is too small. A video too
 * short for every line keeps only the lines that fit. `moved` counts kept
 * blocks whose times changed.
 */
export function clampToDuration(
  blocks: TextBlock[],
  durationSec: number,
): { blocks: TextBlock[]; moved: number } {
  if (tooShort(durationSec)) return { blocks: [], moved: 0 };
  const result = new Map<string, TextBlock>();
  const { title: titleLen, credits: creditsLen } = edgeLengths(durationSec);
  // Title and credits first: the lyric region is built from where they land.
  const original = (track: Track) => blocks.find((b) => b.track === track);
  const placed = (track: Track) => [...result.values()].find((b) => b.track === track);
  for (const track of ['title', 'credits', 'lyric'] as Track[]) {
    const list = trackBlocks(blocks, track);
    // Lyrics that sat between the title and the credits stay between them.
    let floor = 0;
    let limit = durationSec;
    if (track === 'lyric' && list.length > 0) {
      const t0 = original('title');
      const c0 = original('credits');
      const t = placed('title');
      const c = placed('credits');
      if (t0 && t && list[0].startSec >= t0.endSec - EPS) floor = t.endSec;
      if (c0 && c && list[list.length - 1].endSec <= c0.startSec + EPS) limit = Math.max(floor, c.startSec);
    }
    const fixed: TextBlock[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const len = b.endSec - b.startSec;
      const end = Math.min(b.endSec, limit);
      let start = Math.min(b.startSec, end - len);
      let e = end;
      if (start < floor) {
        start = floor;
        e = Math.min(end, Math.max(floor + MIN_BLOCK_SEC, floor + len));
      }
      fixed.unshift({ ...b, startSec: r2(Math.max(floor, start)), endSec: r2(e) });
      limit = Math.max(floor, start);
    }
    const bad = fixed.some((b) => b.endSec - b.startSec < MIN_BLOCK_SEC - EPS || b.endSec > durationSec + EPS);
    const retile = bad || fixed.some((b, i) => i > 0 && b.startSec < fixed[i - 1].endSec - EPS);
    let final = fixed;
    if (retile) {
      let from = 0;
      let to = durationSec;
      if (track === 'title') to = titleLen;
      else if (track === 'credits') from = r2(durationSec - creditsLen);
      else {
        const t = placed('title');
        const c = placed('credits');
        if (t) from = t.endSec;
        if (c) to = Math.max(from, c.startSec);
      }
      // slots() falls back to the whole video when [from, to] is too small.
      final = slots(fixed.length, from, to, durationSec).map(([s, e], i) => ({ ...fixed[i], startSec: s, endSec: e }));
    }
    final.forEach((b) => result.set(b.id, b));
  }
  let moved = 0;
  const out = blocks.flatMap((b) => {
    const n = result.get(b.id);
    if (!n) return [];
    if (Math.abs(n.startSec - b.startSec) > EPS || Math.abs(n.endSec - b.endSec) > EPS) moved++;
    return [n];
  });
  return { blocks: out, moved };
}

/** Index pairs [oldIndex, newIndex] of a longest common subsequence of equal strings, ascending. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

type Slot = { kind: 'kept'; block: TextBlock } | { kind: 'new'; text: string };

/**
 * Lyric lines → blocks, keeping hand-made timing. Lines whose text is
 * unchanged keep their block (matched by text, so inserting or deleting a line
 * never shifts the others); an edited line keeps the slot of the line it
 * replaced; a deleted line leaves its gap. New lines fill the free gap where
 * they were inserted, or share the previous (else next) block's time when
 * there is no gap. A line with no room anywhere near is left unplaced
 * (unplacedLineCount reports it) — the track is never re-tiled.
 */
function syncLyrics(
  existing: TextBlock[],
  want: string[],
  makeId: () => string,
  durationSec: number,
  removed: { startSec: number; endSec: number }[] = [],
): TextBlock[] {
  const pairs = lcsPairs(
    existing.map((b) => b.text),
    want,
  );
  const slots: Slot[] = [];
  let oi = 0;
  let ni = 0;
  for (const [ao, an] of [...pairs, [existing.length, want.length] as [number, number]]) {
    // Unmatched run: old [oi, ao), new [ni, an). Pair positionally = edits.
    const oldRun = existing.slice(oi, ao);
    const newRun = want.slice(ni, an);
    newRun.forEach((text, k) =>
      slots.push(k < oldRun.length ? { kind: 'kept', block: { ...oldRun[k], text } } : { kind: 'new', text }),
    );
    if (ao < existing.length) slots.push({ kind: 'kept', block: { ...existing[ao], text: want[an] } });
    oi = ao + 1;
    ni = an + 1;
  }

  const avg = existing.length ? existing.reduce((s, b) => s + (b.endSec - b.startSec), 0) / existing.length : 3;
  const maxLen = Math.max(5, avg);
  const out: (TextBlock | null)[] = slots.map((s) => (s.kind === 'kept' ? s.block : null));

  for (let i = 0; i < slots.length; ) {
    if (slots[i].kind === 'kept') {
      i++;
      continue;
    }
    let j = i;
    while (j < slots.length && slots[j].kind === 'new') j++;
    const k = j - i;
    const prevIdx = (() => {
      for (let x = i - 1; x >= 0; x--) if (out[x]) return x;
      return -1;
    })();
    const nextIdx = (() => {
      for (let x = j; x < out.length; x++) if (out[x]) return x;
      return -1;
    })();
    const prev = prevIdx >= 0 ? out[prevIdx]! : null;
    const next = nextIdx >= 0 ? out[nextIdx]! : null;
    const lo = prev ? prev.endSec : 0;
    const hi = next ? next.startSec : durationSec;
    const place = (from: number, each: number) => {
      for (let n = 0; n < k; n++) {
        const st = r2(from + each * n);
        const en = n === k - 1 && from + each * k >= hi - EPS ? r2(hi) : r2(from + each * (n + 1));
        out[i + n] = { id: makeId(), track: 'lyric', text: (slots[i + n] as { text: string }).text, startSec: st, endSec: en };
      }
    };
    const gap = hi - lo;
    // A single line typed back into a gap a removed line left: its old slot.
    const ghost =
      k === 1 ? [...removed].reverse().find((r) => r.startSec >= lo - EPS && r.endSec <= hi + EPS) : undefined;
    if (ghost) {
      out[i] = { id: makeId(), track: 'lyric', text: (slots[i] as { text: string }).text, startSec: ghost.startSec, endSec: ghost.endSec };
    } else if (gap / k >= MIN_BLOCK_SEC) {
      place(lo, Math.min(gap / k, maxLen));
    } else if (prev && (hi - prev.startSec) / (k + 1) >= MIN_BLOCK_SEC) {
      // Share the previous block's time (and the gap) evenly with it.
      const each = (hi - prev.startSec) / (k + 1);
      out[prevIdx] = { ...prev, endSec: r2(prev.startSec + each) };
      place(prev.startSec + each, each);
    } else if (next && (next.endSec - lo) / (k + 1) >= MIN_BLOCK_SEC) {
      // No room before: share the next block's time; it keeps its end.
      const each = (next.endSec - lo) / (k + 1);
      const nextStart = r2(lo + each * k);
      // place() stops at hi = old next start; use the new boundary instead.
      for (let n = 0; n < k; n++) {
        out[i + n] = {
          id: makeId(),
          track: 'lyric',
          text: (slots[i + n] as { text: string }).text,
          startSec: r2(lo + each * n),
          endSec: n === k - 1 ? nextStart : r2(lo + each * (n + 1)),
        };
      }
      out[nextIdx] = { ...next, startSec: nextStart };
    }
    // else: no room — these lines stay unplaced.
    i = j;
  }
  return out.filter((b): b is TextBlock => b !== null);
}

export type RememberedTimes = Partial<Record<'title' | 'credits', { startSec: number; endSec: number }>> & {
  /** Slots of lyric lines removed recently (oldest first); a line typed back into that gap reuses one. */
  lyrics?: { startSec: number; endSec: number; id?: string }[];
  /**
   * The whole lyric track as it was just before the box was emptied (select
   * all + delete, cut). Refilling it (undo, paste) matches lines against this
   * instead of spreading them evenly, so the timing comes back.
   */
  lyricTrack?: TextBlock[];
};

/**
 * Re-key blocks to edited text without disturbing hand-made timing.
 * - Lyrics: see syncLyrics. The first lines pasted into an empty track are
 *   spread evenly between the title and the credits, as on a fresh project.
 * - Title / credits: an existing block keeps its times. A block that was
 *   cleared and is typed again comes back at `remembered` times when given
 *   (the editor remembers them), else at the default spot.
 */
export function syncTextToBlocks(
  blocks: TextBlock[],
  texts: { titleText: string; creditsText: string; lyricsText: string },
  durationSec: number,
  remembered: RememberedTimes = {},
): TextBlock[] {
  if (tooShort(durationSec)) return [];
  const title = singleLine(texts.titleText)[0];
  const credits = singleLine(texts.creditsText)[0];
  const lines = lyricLines(texts.lyricsText);
  const out: TextBlock[] = [];

  const edge = (track: 'title' | 'credits', text: string | undefined) => {
    if (text === undefined) return;
    const old = trackBlocks(blocks, track)[0];
    if (old) return void out.push({ ...old, text });
    const mem = remembered[track];
    if (mem && mem.startSec >= 0 && mem.endSec <= durationSec + EPS && mem.endSec - mem.startSec >= MIN_BLOCK_SEC - EPS) {
      return void out.push({ id: track, track, text, startSec: mem.startSec, endSec: Math.min(mem.endSec, r2(durationSec)) });
    }
    out.push(track === 'title' ? titleBlock(text, durationSec) : creditsBlock(text, durationSec));
  };
  edge('title', title);
  edge('credits', credits);

  const onTrack = trackBlocks(blocks, 'lyric');
  const restored = onTrack.length === 0 && remembered.lyricTrack?.length ? [...remembered.lyricTrack].sort((a, b) => a.startSec - b.startSec) : null;
  const existing = restored ?? onTrack;
  if (existing.length === 0) {
    const [from, to] = lyricRegion(title !== undefined, credits !== undefined, durationSec);
    slots(lines.length, from, to, durationSec).forEach(([s, e], i) =>
      out.push({ id: `lyric-${i}`, track: 'lyric', text: lines[i], startSec: s, endSec: e }),
    );
  } else {
    // New ids never reuse one still in play or remembered, so a block that
    // was selected (or a removed line) is never confused with a new one.
    const used = new Set([
      ...blocks.map((b) => b.id),
      ...existing.map((b) => b.id),
      ...(remembered.lyrics ?? []).flatMap((r) => (r.id ? [r.id] : [])),
    ]);
    let n = Math.max(-1, ...[...used].map((id) => Number(/^lyric-(\d+)$/.exec(id)?.[1] ?? -1))) + 1;
    const makeId = () => {
      let id = `lyric-${n}`;
      while (used.has(id)) id = `lyric-${++n}`;
      used.add(id);
      return id;
    };
    out.push(...syncLyrics(existing, lines, makeId, durationSec, remembered.lyrics));
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
