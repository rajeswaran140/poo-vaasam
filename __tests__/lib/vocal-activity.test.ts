import { activeSpans, placeInSinging, type VocalActivity } from '@/lib/vocal-activity';
import type { AlignedCue } from '@/lib/caption-alignment';

/** Loudness every 0.1 s: -20 dB where `sung` covers the instant, -70 dB elsewhere. */
function activity(seconds: number, sung: Array<[number, number]>): VocalActivity {
  const db = Array.from({ length: Math.round(seconds * 10) }, (_, i) =>
    sung.some(([a, b]) => i / 10 >= a && i / 10 < b) ? -20 : -70
  );
  return { hopSec: 0.1, db };
}
const cue = (startSec: number, endSec: number, anchored: boolean, text = 'x'): AlignedCue => ({
  startMs: startSec * 1000, endMs: endSec * 1000, text, anchored,
});

describe('activeSpans', () => {
  it('finds the sung stretches and bridges a breath', () => {
    const a = activity(60, [[10, 20], [20.8, 30], [45, 55]]);
    expect(activeSpans(a)).toEqual([{ startSec: 10, endSec: 30 }, { startSec: 45, endSec: 55 }]);
  });

  it('drops a click shorter than a line', () => {
    expect(activeSpans(activity(20, [[5, 5.2], [10, 15]]))).toEqual([{ startSec: 10, endSec: 15 }]);
  });

  it('is empty for silence or no data', () => {
    expect(activeSpans({ hopSec: 0.1, db: [] })).toEqual([]);
    expect(activeSpans({ hopSec: 0.1, db: Array(100).fill(-90) })).toEqual([]);
  });
});

describe('placeInSinging', () => {
  // Singing 10-30 s and 50-70 s, a music break 30-50 s in between.
  const spans = activeSpans(activity(80, [[10, 30], [50, 70]]));

  it('keeps unheard lines out of a music break', () => {
    // Heard line at 10 s, four unheard, heard line at 66 s. Evenly spread they
    // would start at 21, 32, 43, 54: two inside the break.
    const cues = [cue(10, 21, true), cue(21, 32, false), cue(32, 43, false), cue(43, 54, false), cue(54, 66, false), cue(66, 70, true)];
    const placed = placeInSinging(cues, spans);
    for (const c of placed.slice(1, 5)) {
      const s = c.startMs / 1000;
      expect((s >= 10 && s < 30) || (s >= 50 && s < 70)).toBe(true);
    }
    // Text, order and heard starts are untouched.
    expect(placed.map((c) => c.text)).toEqual(cues.map((c) => c.text));
    expect(placed[0].startMs).toBe(10_000);
    expect(placed[5].startMs).toBe(66_000);
    for (let k = 1; k < placed.length; k++) expect(placed[k].startMs).toBeGreaterThan(placed[k - 1].startMs);
  });

  it('ends a line soon after its singing stops, not at the next line across a break', () => {
    const cues = [cue(20, 50, true), cue(50, 60, true)];
    const placed = placeInSinging(cues, spans);
    expect(placed[0].endMs).toBe(31_000); // sung until 30 s, held 1 s
    expect(placed[1].startMs).toBe(50_000);
  });

  it('snaps an unheard start to a nearby singing onset', () => {
    // Heard at 20 s and 62 s: the unheard line's equal share lands 1 s into the
    // second stretch (51 s), and snaps back to where that singing begins.
    const cues = [cue(20, 40, true), cue(40, 62, false), cue(62, 70, true)];
    const placed = placeInSinging(cues, spans);
    expect(placed[1].startMs).toBe(50_000);
  });

  it('starts an unheard verse opening after the music break, not before it', () => {
    // Heard at 20 s and 60 s. Lines 1-2 unheard; line 2 opens a new verse.
    // Equal shares would put both before the break (10-30 s singing).
    const cues = [cue(20, 30, true), cue(30, 40, false), cue(40, 60, false), cue(60, 70, true)];
    const placed = placeInSinging(cues, spans, { verseStarts: new Set([2]) });
    expect(placed[2].startMs).toBe(50_000); // first singing after the 30-50 s break
    expect(placed[1].startMs).toBeLessThan(31_000); // the line before it stays in the first stretch
  });

  it('changes nothing without singing data', () => {
    const cues = [cue(1, 2, false), cue(2, 3, true)];
    expect(placeInSinging(cues, [])).toEqual(cues);
  });
});
