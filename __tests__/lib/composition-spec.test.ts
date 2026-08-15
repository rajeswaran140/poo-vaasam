/** @jest-environment node */
/**
 * Composition spec: validation, version comparison, and the provider-neutral
 * AI-prompt export.
 *
 * Two spec rules are asserted here because they are the ones that would rot
 * quietly: provenance must stay absent rather than defaulting to authorship,
 * and the Suno export must never carry Raj's lyrics out of the building.
 */

import {
  compositionSpecSchema,
  createCompositionSchema,
  addCompositionVersionSchema,
  compareVersions,
  formatForSuno,
  defaultVersionLabel,
  PROVENANCES,
} from '@/types/composition';

describe('validation', () => {
  it('accepts an empty spec — a notebook starts as a title and an idea', () => {
    expect(compositionSpecSchema.safeParse({}).success).toBe(true);
    expect(createCompositionSchema.safeParse({ title: 'மழை' }).success).toBe(true);
  });

  it('defaults a new composition to "idea"', () => {
    const parsed = createCompositionSchema.parse({ title: 'மழை' });
    expect(parsed.status).toBe('idea');
  });

  it('holds the tempo to the same 40-200 range as the metronome', () => {
    expect(compositionSpecSchema.safeParse({ bpm: 90 }).success).toBe(true);
    expect(compositionSpecSchema.safeParse({ bpm: 0 }).success).toBe(false);
    expect(compositionSpecSchema.safeParse({ bpm: 500 }).success).toBe(false);
  });

  it('rejects a song section it does not know', () => {
    expect(compositionSpecSchema.safeParse({ structure: ['chorus', 'verse'] }).success).toBe(true);
    expect(compositionSpecSchema.safeParse({ structure: ['breakdown'] }).success).toBe(false);
  });

  it('accepts every provenance value and rejects invented ones', () => {
    for (const p of PROVENANCES) {
      expect(compositionSpecSchema.safeParse({ sources: { bpm: p } }).success).toBe(true);
    }
    expect(compositionSpecSchema.safeParse({ sources: { bpm: 'vibes' } }).success).toBe(false);
  });

  /** ⚠️ §24 — absence is data. A default would silently assert authorship. */
  it('does NOT default a missing source to user-entered', () => {
    const parsed = compositionSpecSchema.parse({ bpm: 90 });
    expect(parsed.sources).toBeUndefined();
  });

  it('lets a version be created with nothing at all — snapshot the current state', () => {
    expect(addCompositionVersionSchema.safeParse({}).success).toBe(true);
  });
});

describe('compareVersions', () => {
  it('reports what changed between two versions', () => {
    const diff = compareVersions({ bpm: 80, meter: '4/4' }, { bpm: 96, meter: '4/4' });
    expect(diff).toEqual([{ field: 'bpm', before: '80', after: '96' }]);
  });

  it('shows an absent value as — rather than as undefined', () => {
    expect(compareVersions({}, { tonic: 'G' })).toEqual([{ field: 'tonic', before: '—', after: 'G' }]);
  });

  it('renders a structure change readably', () => {
    const diff = compareVersions({ structure: ['verse', 'chorus'] }, { structure: ['intro', 'verse', 'chorus'] });
    expect(diff[0]).toMatchObject({ field: 'structure', before: 'verse → chorus', after: 'intro → verse → chorus' });
  });

  it('returns nothing for identical specs', () => {
    expect(compareVersions({ bpm: 90 }, { bpm: 90 })).toEqual([]);
  });

  /**
   * Prose notes are deliberately NOT diffed — burying "the tempo moved" under
   * three paragraphs of changed mixing notes defeats the purpose.
   */
  it('ignores prose notes, reporting only the decisions', () => {
    expect(compareVersions({ mixingNotes: 'a' }, { mixingNotes: 'b' })).toEqual([]);
  });
});

/** ⚠️ §17 + AI music rights: neutral storage, formatted only on export. */
describe('formatForSuno', () => {
  const spec = {
    aiMusicPrompt: 'warm acoustic Tamil ballad',
    mood: 'nostalgic',
    bpm: 84,
    meter: '6/8',
    tonic: 'G',
    instrumentation: 'flute, guitar',
    lyrics: 'மழை பெய்தால் மண் வாசம்',
  };

  it('assembles the musical decisions into one prompt string', () => {
    const out = formatForSuno({ title: 'மழை', spec });
    expect(out).toContain('warm acoustic Tamil ballad');
    expect(out).toContain('84 BPM');
    expect(out).toContain('Meter: 6/8');
    expect(out).toContain('Key/tonic: G');
  });

  /** Raj's lyrics are his legal anchor and do not go to third parties casually. */
  it('NEVER includes the lyrics', () => {
    expect(formatForSuno({ title: 'மழை', spec })).not.toContain('மழை பெய்தால்');
  });

  it('skips fields that are not set, without leaving empty fragments', () => {
    const out = formatForSuno({ title: 'x', spec: { aiMusicPrompt: 'just this' } });
    expect(out).toBe('just this');
  });

  it('returns an empty string when there is nothing to export', () => {
    expect(formatForSuno({ title: 'x', spec: {} })).toBe('');
  });
});

describe('defaultVersionLabel', () => {
  it('labels versions V1, V2, …', () => {
    expect(defaultVersionLabel(1)).toBe('V1');
    expect(defaultVersionLabel(12)).toBe('V12');
  });
});
