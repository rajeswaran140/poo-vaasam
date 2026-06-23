import {
  splitSections,
  defaultAssignment,
  duetTag,
  toDuetLyrics,
  hasVoiceTags,
  duetWarnings,
  type TaggedSection,
} from '@/lib/duet-tagging';

const LYRICS = `பல்லவி வரி ஒன்று
பல்லவி வரி இரண்டு

சரணம் ஒன்று வரி
சரணம் ஒன்று இன்னொரு வரி

பல்லவி வரி ஒன்று
பல்லவி வரி இரண்டு

சரணம் இரண்டு வரி
சரணம் இரண்டு இன்னொரு வரி`;

describe('splitSections', () => {
  it('splits on blank lines and marks the REPEATED block as chorus', () => {
    const s = splitSections(LYRICS);
    expect(s).toHaveLength(4);
    // blocks 0 and 2 are identical (the pallavi) → chorus; 1 and 3 → verse
    expect(s.map((x) => x.kind)).toEqual(['chorus', 'verse', 'chorus', 'verse']);
  });

  it('treats every block as a verse when nothing repeats', () => {
    const s = splitSections('a\n\nb\n\nc');
    expect(s.map((x) => x.kind)).toEqual(['verse', 'verse', 'verse']);
  });

  it('handles empty / whitespace input', () => {
    expect(splitSections('')).toEqual([]);
    expect(splitSections('   \n\n  ')).toEqual([]);
  });
});

describe('duetTag', () => {
  it('formats SUNO voice tags', () => {
    expect(duetTag('female', 'verse')).toBe('[Female Verse]');
    expect(duetTag('male', 'chorus')).toBe('[Male Chorus]');
    expect(duetTag('duet', 'chorus')).toBe('[Duet Chorus]');
  });
});

describe('defaultAssignment', () => {
  it('alternates verses male→female and gives the chorus to both', () => {
    const out = defaultAssignment(splitSections(LYRICS));
    // chorus, verse, chorus, verse → duet, male, duet, female
    expect(out.map((s) => s.voice)).toEqual(['duet', 'male', 'duet', 'female']);
  });
});

describe('toDuetLyrics', () => {
  it('prefixes each section with its voice tag, blank-line separated', () => {
    const sections: TaggedSection[] = [
      { text: 'male line', kind: 'verse', voice: 'male' },
      { text: 'both line', kind: 'chorus', voice: 'duet' },
    ];
    expect(toDuetLyrics(sections)).toBe('[Male Verse]\nmale line\n\n[Duet Chorus]\nboth line');
  });
});

describe('hasVoiceTags', () => {
  it('detects existing voice tags (so a pre-flight knows the lyrics are tagged)', () => {
    expect(hasVoiceTags('[Female Verse]\nline')).toBe(true);
    expect(hasVoiceTags('[Duet]\nline')).toBe(true);
    expect(hasVoiceTags('[both]\nline')).toBe(true);
  });
  it('returns false for plain lyrics or non-voice tags', () => {
    expect(hasVoiceTags('just lyrics\nno tags')).toBe(false);
    expect(hasVoiceTags('[Verse]\nline')).toBe(false); // structural, not a voice
    expect(hasVoiceTags('')).toBe(false);
  });
});

describe('duetWarnings', () => {
  const verse = (voice: 'male' | 'female' | 'duet'): TaggedSection => ({ text: 'x', kind: 'verse', voice });

  it('no warnings for a valid male+female duet', () => {
    expect(duetWarnings([verse('male'), verse('female')])).toEqual([]);
  });

  it('no warnings when a duet section covers both voices', () => {
    expect(duetWarnings([verse('duet'), verse('male')])).toEqual([]);
  });

  it('flags an all-one-voice assignment as a solo, not a duet', () => {
    const w = duetWarnings([verse('male'), verse('male')]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/solo/i);
  });

  it('flags a missing male or female part', () => {
    expect(duetWarnings([verse('female'), verse('female')])[0]).toMatch(/solo/i);
    // male + (no female, no duet) → missing female
    const w = duetWarnings([verse('male'), verse('male'), verse('female')]);
    expect(w).toEqual([]); // has both now
  });

  it('warns when there are no sections', () => {
    expect(duetWarnings([])[0]).toMatch(/no lyric sections/i);
  });
});
