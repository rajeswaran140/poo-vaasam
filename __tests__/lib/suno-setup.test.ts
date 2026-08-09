import {
  parseSectionTags,
  sungLines,
  styleDescriptors,
  instrumentsInTag,
  checkSetup,
  isReady,
  EXCLUDE_MAX,
  STYLE_TARGET_MIN,
  STYLE_INFLUENCE_DEFAULT,
  WEIRDNESS_DEFAULT,
  type SunoSetup,
} from '@/lib/suno-setup';
import { PROMPT_LIMITS } from '@/lib/prompt-preflight';

const setup = (o: Partial<SunoSetup> = {}): SunoSetup => ({
  lyricsBlock: '[Chorus - Male Lead]\nவரி ஒன்று\nவரி இரண்டு',
  style: 'x'.repeat(STYLE_TARGET_MIN + 50),
  weirdness: WEIRDNESS_DEFAULT,
  styleInfluence: STYLE_INFLUENCE_DEFAULT,
  exclude: [],
  ...o,
});

describe('parseSectionTags', () => {
  it('splits [Kind - Detail] and keeps the raw text', () => {
    const [t] = parseSectionTags('[Chorus - Male Lead]\nவரி');
    expect(t.kind).toBe('Chorus');
    expect(t.detail).toBe('Male Lead');
    expect(t.raw).toBe('Chorus - Male Lead');
    expect(t.line).toBe(0);
  });

  it('accepts en/em dashes as well as hyphens', () => {
    expect(parseSectionTags('[Verse – Female Lead]')[0].detail).toBe('Female Lead');
    expect(parseSectionTags('[Verse — Female Lead]')[0].detail).toBe('Female Lead');
  });

  it('marks a tag instrumental when no voice is named', () => {
    const tags = parseSectionTags(
      ['[Intro - Instrumental]', '[Break - Flute Phrase]', '[Chorus - Male Lead]', '[Chorus - Male and Female Together]'].join('\n')
    );
    expect(tags.map((t) => t.instrumental)).toEqual([true, true, false, false]);
  });

  it('handles a bare tag with no detail', () => {
    const [t] = parseSectionTags('[Outro]');
    expect(t.kind).toBe('Outro');
    expect(t.detail).toBe('');
  });

  it('ignores brackets that are not the whole line', () => {
    expect(parseSectionTags('சொல் [ஒரு] வரி')).toEqual([]);
  });
});

describe('sungLines', () => {
  it('counts lyric lines only, not tags or blanks', () => {
    expect(sungLines('[Chorus - Male Lead]\n\nவரி ஒன்று\nவரி இரண்டு\n\n[Outro]')).toHaveLength(2);
  });
});

describe('styleDescriptors', () => {
  it('flattens pipe groups and commas into individual descriptors', () => {
    expect(styleDescriptors('Tamil duet, 82 BPM | bamboo flute, dholak')).toEqual([
      'tamil duet',
      '82 bpm',
      'bamboo flute',
      'dholak',
    ]);
  });
});

describe('instrumentsInTag', () => {
  it('strips role words and keeps the instrument', () => {
    expect(instrumentsInTag('Flute Phrase')).toEqual(['flute']);
    expect(instrumentsInTag('Dholak and Bass Groove')).toEqual(['dholak', 'bass']);
    expect(instrumentsInTag('Solo Violin')).toEqual(['violin']);
  });

  it('yields nothing for a purely structural detail', () => {
    expect(instrumentsInTag('Instrumental')).toEqual([]);
    expect(instrumentsInTag('Full Band Lift')).toEqual(['band']);
  });
});

describe('checkSetup — style box', () => {
  it('errors when over the hard cap and says how to cut', () => {
    const f = checkSetup(setup({ style: 'a'.repeat(PROMPT_LIMITS.STYLE_MAX + 1) }));
    const e = f.find((x) => x.field === 'style' && x.severity === 'error')!;
    expect(e.message).toMatch(/over the 1000 limit/);
    expect(e.fix).toMatch(/whole descriptors/i);
  });

  it('warns when the box is under-used — the common failure', () => {
    const f = checkSetup(setup({ style: 'Tamil duet, flute' }));
    expect(f.find((x) => x.field === 'style')!.severity).toBe('warning');
  });

  it('accepts the useful band without complaint', () => {
    expect(checkSetup(setup({ style: 'y'.repeat(600) })).filter((x) => x.field === 'style')).toEqual([]);
  });

  it('flags a negative written into the style box', () => {
    const f = checkSetup(setup({ style: `${'y'.repeat(500)}, no synth` }));
    const n = f.find((x) => x.field === 'style' && /negative/i.test(x.message))!;
    expect(n.fix).toMatch(/Exclude field/i);
  });
});

describe('checkSetup — exclude', () => {
  it('warns past the effective ceiling', () => {
    const f = checkSetup(setup({ exclude: Array.from({ length: EXCLUDE_MAX + 2 }, (_, i) => `thing${i}`) }));
    expect(f.find((x) => x.field === 'exclude')!.message).toMatch(/more than/);
  });

  it('ERRORS when an exclusion contradicts the style prompt', () => {
    // The contradiction neither field reveals on its own.
    const f = checkSetup(setup({ style: `bamboo flute motif, ${'y'.repeat(450)}`, exclude: ['bamboo flute'] }));
    const e = f.find((x) => x.field === 'exclude' && x.severity === 'error')!;
    expect(e.message).toMatch(/excluded but the style prompt asks for it/);
    expect(isReady(f)).toBe(false);
  });

  it('does not fire on an unrelated exclusion', () => {
    const f = checkSetup(setup({ style: `bamboo flute motif, ${'y'.repeat(450)}`, exclude: ['heavy metal'] }));
    expect(f.filter((x) => x.field === 'exclude')).toEqual([]);
  });
});

describe('checkSetup — lyrics block', () => {
  it('errors when there are no section tags at all', () => {
    const f = checkSetup(setup({ lyricsBlock: 'வரி ஒன்று\nவரி இரண்டு' }));
    const e = f.find((x) => x.field === 'lyrics' && x.severity === 'error')!;
    expect(e.message).toMatch(/no musical break points/i);
    expect(isReady(f)).toBe(false);
  });

  it('errors past the lyrics character limit', () => {
    const f = checkSetup(setup({ lyricsBlock: `[Chorus - Male Lead]\n${'அ'.repeat(PROMPT_LIMITS.LYRICS_MAX_CHARS)}` }));
    expect(f.some((x) => x.field === 'lyrics' && /over the 5000/.test(x.message))).toBe(true);
  });

  it('errors on tags with no sung lines', () => {
    const f = checkSetup(setup({ lyricsBlock: '[Intro - Instrumental]\n[Outro - Instrumental]' }));
    expect(f.some((x) => x.field === 'lyrics' && /no sung lines/i.test(x.message))).toBe(true);
  });

  it('warns when a break names an instrument the style never mentions', () => {
    const f = checkSetup(
      setup({
        lyricsBlock: '[Break - Sitar Phrase]\n[Chorus - Male Lead]\nவரி',
        style: `bamboo flute motif, acoustic guitar, ${'y'.repeat(430)}`,
      })
    );
    const w = f.find((x) => x.field === 'lyrics' && /sitar/i.test(x.message))!;
    expect(w.severity).toBe('warning');
    expect(w.fix).toMatch(/instrument descriptors/i);
  });

  it('stays silent when the break instrument IS in the style', () => {
    const f = checkSetup(
      setup({
        lyricsBlock: '[Break - Flute Phrase]\n[Chorus - Male Lead]\nவரி',
        style: `bamboo flute motif, ${'y'.repeat(450)}`,
      })
    );
    expect(f.filter((x) => x.field === 'lyrics')).toEqual([]);
  });

  it('does not flag a purely structural break', () => {
    const f = checkSetup(
      setup({ lyricsBlock: '[Intro - Instrumental]\n[Chorus - Male Lead]\nவரி', style: 'y'.repeat(500) })
    );
    expect(f.filter((x) => x.field === 'lyrics')).toEqual([]);
  });
});

describe('checkSetup — sliders', () => {
  it('rejects out-of-range values', () => {
    expect(checkSetup(setup({ weirdness: 101 })).some((f) => f.field === 'weirdness')).toBe(true);
    expect(checkSetup(setup({ styleInfluence: -1 })).some((f) => f.field === 'styleInfluence')).toBe(true);
    expect(checkSetup(setup({ weirdness: NaN })).some((f) => f.field === 'weirdness')).toBe(true);
  });

  it('defaults style influence high, because these prompts are dense', () => {
    expect(STYLE_INFLUENCE_DEFAULT).toBeGreaterThanOrEqual(75);
    expect(WEIRDNESS_DEFAULT).toBe(50);
  });
});

describe('isReady', () => {
  it('passes a clean setup and lets warnings through', () => {
    const clean = checkSetup(
      setup({ lyricsBlock: '[Break - Flute Phrase]\n[Chorus - Male Lead]\nவரி', style: `bamboo flute, ${'y'.repeat(450)}` })
    );
    expect(clean).toEqual([]);
    expect(isReady(clean)).toBe(true);
    expect(isReady([{ severity: 'warning', field: 'style', message: 'm' }])).toBe(true);
    expect(isReady([{ severity: 'error', field: 'style', message: 'm' }])).toBe(false);
  });
});
