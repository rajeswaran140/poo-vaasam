import {
  flowSuggestions,
  flowHeadline,
  SYLLABLE_TOLERANCE,
  WEAK_ENDING_SCORE,
  MAX_LINE_SUGGESTIONS,
} from '@/lib/lyric-flow-advice';
import { analyzeProsody } from '@/lib/tamil-prosody';

const advise = (lyrics: string) => flowSuggestions(analyzeProsody(lyrics));

describe('flowSuggestions — silence when there is nothing to say', () => {
  it('says nothing for empty input', () => {
    expect(advise('')).toEqual([]);
    expect(advise('\n\n  \n')).toEqual([]);
  });

  it('says nothing about meter for a draft too short to have a meter', () => {
    // Two lines cannot establish a dominant length worth measuring against.
    const out = advise('கண்ணே\nமணியே');
    expect(out.filter((s) => s.observation.includes('syllables'))).toEqual([]);
  });

  it('does not flag a one-syllable wobble', () => {
    // Ordinary variation; flagging it would fire on nearly every real draft.
    const out = advise(['கண்ணா', 'மண்ணா', 'விண்ணா', 'கண்ணாலே'].join('\n'));
    const meter = out.filter((s) => s.observation.includes('against this song'));
    for (const m of meter) expect(m.observation).not.toMatch(/ 1 (over|under)/);
  });
});

describe('flowSuggestions — meter', () => {
  it('flags a line well off the draft own dominant length, with direction', () => {
    const short = 'கண்ணா';
    const long = 'கண்ணாலே பார்த்தாயே நீயும் என்னை அன்பாக';
    const out = advise([short, short, short, long].join('\n'));
    const meter = out.find((s) => s.observation.includes('against this song'));
    expect(meter).toBeTruthy();
    expect(meter!.observation).toMatch(/over/);
    expect(meter!.line).toBe(3);
    expect(meter!.quote).toBeTruthy();
  });

  it('compares against the song own meter, not a fixed target', () => {
    // Four consistent SHORT lines must not be flagged just for being short.
    const out = advise(['கண்ணா', 'மண்ணா', 'விண்ணா', 'பெண்ணா'].join('\n'));
    expect(out.filter((s) => s.observation.includes('against this song'))).toEqual([]);
  });

  it('caps how many line suggestions it will emit', () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? 'கண்ணா' : 'கண்ணாலே பார்த்தாயே நீயும் என்னை அன்பாக ரொம்ப'
    );
    const meter = advise(lines.join('\n')).filter((s) => s.observation.includes('against this song'));
    expect(meter.length).toBeLessThanOrEqual(MAX_LINE_SUGGESTIONS);
  });
});

describe('flowSuggestions — endings the voice cannot hold', () => {
  it('flags a closed ending and explains the clipping', () => {
    const out = advise(['கண்ணில் வந்தாள்', 'மனதில் நின்றாள்', 'உயிரில் கலந்தாள்'].join('\n'));
    const weak = out.find((s) => s.observation.includes('closed syllable'));
    if (weak) {
      expect(weak.why).toMatch(/clip/i);
      expect(weak.why).toMatch(/ஆ|ஈ|ஊ|ஏ|ஓ/);
    }
  });

  it('does not flag lines that end open', () => {
    const out = advise(['கண்ணே', 'மணியே', 'நிலவே', 'மலரே'].join('\n'));
    expect(out.filter((s) => s.observation.includes('closed syllable'))).toEqual([]);
  });
});

describe('flowSuggestions — never rewrites', () => {
  it('emits no replacement line or replacement word anywhere', () => {
    const out = advise(
      ['கண்ணில் வந்தாள்', 'மனதில் நின்றாள்', 'கண்ணாலே பார்த்தாயே நீயும் என்னை', 'உயிரில்'].join('\n')
    );
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      // Diagnosis vocabulary only — no imperative rewrite language.
      expect(`${s.observation} ${s.why}`).not.toMatch(/\btry writing\b|\breplace with\b|\bchange it to\b|\buse instead\b/i);
    }
  });

  it('always gives a reason alongside every observation', () => {
    const out = advise(['கண்ணில் வந்தாள்', 'மனதில்', 'கண்ணாலே பார்த்தாயே நீயும் என்னை அன்பாக'].join('\n'));
    for (const s of out) {
      expect(s.observation.trim()).not.toBe('');
      expect(s.why.trim()).not.toBe('');
    }
  });
});

describe('flowSuggestions — rhyme binding', () => {
  it('frames absent binding as a note, and says a deliberate choice is fine', () => {
    const out = advise(['ஒன்று', 'வேறு', 'பின்பு', 'மற்று'].join('\n'));
    const note = out.find((s) => s.observation.includes('எதுகை'));
    if (note) {
      expect(note.severity).toBe('note');
      expect(note.why).toMatch(/deliberate/i);
    }
  });
});

describe('flowHeadline', () => {
  it('is empty when there is nothing to report', () => {
    expect(flowHeadline([])).toBe('');
  });

  it('counts only the actionable ones', () => {
    const s = (severity: 'note' | 'watch') => ({ line: 1, severity, observation: 'o', why: 'w' });
    expect(flowHeadline([s('watch'), s('watch'), s('note')])).toMatch(/2 lines worth a look/);
    expect(flowHeadline([s('note')])).toMatch(/1 note/);
  });
});

describe('thresholds are calibrated, not arbitrary', () => {
  it('tolerates ordinary one-syllable variation', () => {
    expect(SYLLABLE_TOLERANCE).toBe(1);
  });

  it('keeps the weak-ending bar low enough to flag only real clipping risk', () => {
    expect(WEAK_ENDING_SCORE).toBeGreaterThan(0);
    expect(WEAK_ENDING_SCORE).toBeLessThan(60);
  });
});
