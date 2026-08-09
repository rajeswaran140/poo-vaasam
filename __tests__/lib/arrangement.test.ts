import {
  layerLine,
  toArrangementBlock,
  balance,
  instrumentsUsed,
  themeStatements,
  HEALTHY_INSTRUMENTAL_MIN,
  type ArrangedSection,
} from '@/lib/arrangement';
import { parseSectionTags, sungLines } from '@/lib/suno-setup';

const section = (o: Partial<ArrangedSection> & { kind: string }): ArrangedSection => ({
  detail: '',
  layers: [],
  ...o,
});

describe('layerLine', () => {
  it('reads instrument-first, the way the files do', () => {
    expect(layerLine({ instrument: 'Bamboo flute', role: 'answers in counterpoint' })).toBe(
      'Bamboo flute answers in counterpoint'
    );
  });

  it('drops the role when there is none, and yields nothing without an instrument', () => {
    expect(layerLine({ instrument: 'Santoor', role: '' })).toBe('Santoor');
    expect(layerLine({ instrument: '  ', role: 'swells' })).toBe('');
  });
});

describe('toArrangementBlock', () => {
  it('emits [Kind - Detail] then bracketed directions then the lyric', () => {
    const out = toArrangementBlock([
      section({
        kind: 'Chorus',
        detail: 'Male Lead',
        layers: [{ instrument: 'Strings', role: 'sustains beneath' }],
        lyrics: 'சாயங்கால வானத்திலே...',
      }),
    ]);
    expect(out).toBe('[Chorus - Male Lead]\n[Strings sustains beneath]\nசாயங்கால வானத்திலே...');
  });

  it('omits the dash when a section has no detail', () => {
    expect(toArrangementBlock([section({ kind: 'Outro' })])).toBe('[Outro]');
  });

  it('lets a free-text direction WIN over composed layers', () => {
    // The poet writing the line himself is the stronger signal; appending
    // generated layers under his wording would corrupt his phrasing.
    const out = toArrangementBlock([
      section({
        kind: 'Intro',
        detail: 'Instrumental',
        freeDirection: 'Ambient pad swell, distant village dusk texture',
        layers: [{ instrument: 'Tabla', role: 'enters' }],
      }),
    ]);
    expect(out).toContain('[Ambient pad swell, distant village dusk texture]');
    expect(out).not.toContain('Tabla');
  });

  it('separates sections with a blank line and survives a round trip', () => {
    const block = toArrangementBlock([
      section({ kind: 'Intro', detail: 'Instrumental', layers: [{ instrument: 'Bamboo flute', role: 'enters' }] }),
      section({ kind: 'Chorus', detail: 'Male Lead', lyrics: 'வரி ஒன்று' }),
    ]);
    const parsed = parseSectionTags(block);
    expect(parsed).toHaveLength(2); // directions must NOT be counted as sections
    expect(parsed[0].directions).toEqual(['Bamboo flute enters']);
    expect(sungLines(block)).toEqual(['வரி ஒன்று']);
  });
});

describe('balance', () => {
  it('flags a wall of vocal with nowhere to hand the melody on', () => {
    const b = balance([{ lyrics: 'a' }, { lyrics: 'b' }, { lyrics: 'c' }, { lyrics: 'd' }]);
    expect(b.instrumental).toBe(0);
    expect(b.note).toMatch(/nowhere for the melody/i);
  });

  it('is quiet at a real arrangement ratio', () => {
    // His finished song ran 13 instrumental against 14 sung.
    const b = balance([{ lyrics: '' }, { lyrics: 'a' }, { lyrics: '' }, { lyrics: 'b' }]);
    expect(b.ratio).toBe(0.5);
    expect(b.note).toBe('');
  });

  it('warns the other way when the words have gone missing', () => {
    expect(balance([{ lyrics: '' }, { lyrics: '' }, { lyrics: '' }, { lyrics: 'a' }]).note).toMatch(
      /words still carry/i
    );
  });

  it('accepts parsed section tags as well as arranged sections', () => {
    const parsed = parseSectionTags('[Intro - Instrumental]\n[Chorus - Male Lead]\nவரி');
    const b = balance(parsed);
    expect(b.total).toBe(2);
    expect(b.instrumental).toBe(1);
  });

  it('is safe on an empty arrangement', () => {
    expect(balance([]).note).toBe('');
    expect(HEALTHY_INSTRUMENTAL_MIN).toBeGreaterThan(0);
  });
});

describe('instrumentsUsed', () => {
  it('collects leads and layers, deduped', () => {
    const out = instrumentsUsed([
      section({ kind: 'Theme A', detail: 'Flute Lead', layers: [{ instrument: 'Strings', role: 'sustains beneath' }] }),
      section({ kind: 'Theme A', detail: 'Violin Lead', layers: [{ instrument: 'Strings', role: 'swells' }] }),
    ]);
    expect(out).toEqual(['Flute', 'Strings', 'Violin']);
  });

  it('does not turn a vocal lead into an instrument name', () => {
    expect(instrumentsUsed([section({ kind: 'Chorus', detail: 'Instrumental' })])).toEqual([]);
  });
});

describe('themeStatements', () => {
  it('shows a recurring theme and the leads that carried it', () => {
    const out = themeStatements([
      section({ kind: 'Theme A', detail: 'Flute Lead' }),
      section({ kind: 'Break', detail: 'Guitar Fill' }),
      section({ kind: 'Theme A', detail: 'Violin Lead' }),
      section({ kind: 'Theme A', detail: 'Flute and Violin Together' }),
    ]);
    expect(out).toEqual([
      { theme: 'Theme A', leads: ['Flute Lead', 'Violin Lead', 'Flute and Violin Together'] },
    ]);
  });

  it('ignores sections stated only once', () => {
    expect(themeStatements([section({ kind: 'Bridge', detail: 'Mandolin Lead' })])).toEqual([]);
  });
});
