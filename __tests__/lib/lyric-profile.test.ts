/** @jest-environment node */
/**
 * UNIT TESTS — the deterministic lyric profile.
 *
 * The whole point of this module is that the critic stops GUESSING at facts, so
 * these tests assert the facts are right and that the grounding block states
 * them plainly enough that a model cannot talk itself out of them.
 */
import {
  lyricWords,
  normaliseRoot,
  rootMotifs,
  repeatedWords,
  registerSignal,
  lyricSections,
  buildLyricProfile,
  profileGrounding,
  ROOT_PREFIX_GRAPHEMES,
  MIN_WORD_GRAPHEMES,
} from '@/lib/lyric-profile';

// Raj's own opening, the case that motivated root-motif detection:
// சாயங்கால / சாய்ந்த / சாய்ந்து share a root and all three surface forms differ.
const SAAYANGAALA = [
  '[Chorus]',
  'சாயங்கால வானத்திலே',
  'சாய்ந்த வண்ணம் யாரோ',
  'காதல் வந்த எண்ணத்திலே',
  'சாய்ந்து போனேன் நானோ',
].join('\n');

const COLLOQUIAL = ['உன்னோட நினைவுல', 'வரப்பில நடந்து', 'நான் தேடுறது உன்னை'].join('\n');
const LITERARY = ['நெஞ்சம் நிறைந்த காதல்', 'வானம் பொழிந்த மழையே'].join('\n');

describe('lyricWords', () => {
  it('keeps Tamil words and drops punctuation and ellipses', () => {
    expect(lyricWords('சாயங்கால வானத்திலே... யாரோ!')).toEqual([
      'சாயங்கால',
      'வானத்திலே',
      'யாரோ',
    ]);
  });

  it('drops non-Tamil tokens so section tags do not pollute counts', () => {
    expect(lyricWords('[Chorus - Male Lead]')).toEqual([]);
    expect(lyricWords('காதல் Lead 2')).toEqual(['காதல்']);
  });

  it('is safe on empty and whitespace input', () => {
    expect(lyricWords('')).toEqual([]);
    expect(lyricWords('   \n  ')).toEqual([]);
  });
});

describe('normaliseRoot', () => {
  it('drops pulli so an inflected form matches its root', () => {
    expect(normaliseRoot('சாய்ந்து')).toBe('சாயநது');
    expect(normaliseRoot('சாயங்கால')).toBe('சாயஙகால');
  });
});

describe('rootMotifs', () => {
  it('finds one root re-inflected across the song', () => {
    const motifs = rootMotifs(SAAYANGAALA);
    const saai = motifs.find((m) => m.forms.some((f) => f.startsWith('சாய')));
    expect(saai).toBeDefined();
    expect(saai!.forms).toEqual(expect.arrayContaining(['சாயங்கால', 'சாய்ந்த', 'சாய்ந்து']));
  });

  it('needs DISTINCT surface forms — repeating one word is not a motif', () => {
    // Three uses of the same word is repetition; repeatedWords reports that.
    const motifs = rootMotifs('காதல் வந்தது\nகாதல் போனது\nகாதல் மீண்டும்');
    expect(motifs.find((m) => m.forms.length >= 2 && m.forms.every((f) => f === 'காதல்'))).toBeUndefined();
  });

  it('ignores words too short to carry a root', () => {
    expect(MIN_WORD_GRAPHEMES).toBeGreaterThan(ROOT_PREFIX_GRAPHEMES);
    expect(rootMotifs('ஒரு இரு')).toEqual([]);
  });

  it('returns nothing on an empty draft rather than throwing', () => {
    expect(rootMotifs('')).toEqual([]);
  });
});

describe('repeatedWords', () => {
  it('counts words used more than once, most frequent first', () => {
    const r = repeatedWords('காதல் வானம்\nகாதல் மழை\nகாதல் வானம்');
    expect(r[0]).toEqual({ word: 'காதல்', count: 3 });
    expect(r).toContainEqual({ word: 'வானம்', count: 2 });
  });

  it('omits words used once', () => {
    expect(repeatedWords('காதல் வானம் மழை')).toEqual([]);
  });
});

describe('registerSignal', () => {
  it('reads a colloquial draft as colloquial and shows the evidence', () => {
    const s = registerSignal(COLLOQUIAL);
    expect(s.register).toBe('colloquial');
    expect(s.colloquialHits).toEqual(expect.arrayContaining(['உன்னோட', 'தேடுறது']));
  });

  it('reads a literary draft as literary with no hits', () => {
    const s = registerSignal(LITERARY);
    expect(s.register).toBe('literary');
    expect(s.colloquialHits).toEqual([]);
  });

  it('returns evidence, not just a label — the model must be able to disagree', () => {
    // A verdict with no evidence is unarguable, which is exactly wrong for a
    // signal that decides whether colloquial forms count as a defect.
    const s = registerSignal(COLLOQUIAL);
    expect(s.wordCount).toBeGreaterThan(0);
    expect(s.colloquialHits.length).toBeGreaterThan(0);
  });

  it('is unknown on an empty draft rather than guessing literary', () => {
    expect(registerSignal('').register).toBe('unknown');
  });

  it('does not double-count the same word twice', () => {
    const s = registerSignal('உன்னோட உன்னோட உன்னோட');
    expect(s.colloquialHits).toEqual(['உன்னோட']);
  });

  it('catches the spoken present-tense marker MID-word, not just as a suffix', () => {
    // Regression: தேடுறது carries ுற medially, so a suffix-only check missed
    // every spoken verb form. This test found that bug.
    expect(registerSignal('நான் தேடுறது உன்னை').colloquialHits).toContain('தேடுறது');
  });

  it('does not flag literary words merely for containing ற', () => {
    // Precision matters more than recall here: a FALSE colloquial reading makes
    // the critic judge the song against the wrong register, which is the exact
    // failure this signal exists to prevent.
    const s = registerSignal('உறவு நிறைந்த வானம் மறைந்த நிலவு');
    expect(s.colloquialHits).toEqual([]);
    expect(s.register).toBe('literary');
  });

  /**
   * KNOWN LIMITATION, pinned deliberately so nobody "fixes" it by broadening
   * the pattern. போறது / ஆறது carry ோ+ற, not ு+ற. Matching ோற would also hit
   * தோற்று, and ிற would hit நிறைந்த — both literary. The signal is
   * precision-favoured and under-reports; that is the right trade, because it
   * is grounding for a model that can still read the lyric itself.
   */
  it('UNDER-REPORTS some spoken forms rather than risk a false positive', () => {
    expect(registerSignal('அவன் போறது எங்கே').colloquialHits).toEqual([]);
    // And the literary words it protects by staying narrow:
    expect(registerSignal('தோற்று நிறைந்த').colloquialHits).toEqual([]);
  });
});

describe('lyricSections', () => {
  it('splits on blank lines and attaches a heading', () => {
    const secs = lyricSections('பல்லவி\nவரி ஒன்று\nவரி இரண்டு\n\nசரணம்\nவரி மூன்று');
    expect(secs).toHaveLength(2);
    expect(secs[0].heading).toBe('பல்லவி');
    expect(secs[0].lineCount).toBe(2);
    expect(secs[1].heading).toBe('சரணம்');
    expect(secs[1].lineCount).toBe(1);
  });

  it('starts a new section at a heading even without a blank line', () => {
    const secs = lyricSections('பல்லவி\nவரி ஒன்று\nசரணம்\nவரி இரண்டு');
    expect(secs).toHaveLength(2);
    expect(secs.map((s) => s.heading)).toEqual(['பல்லவி', 'சரணம்']);
  });

  it('records the first line so a section is identifiable', () => {
    expect(lyricSections(SAAYANGAALA)[0].firstLine).toBe('சாயங்கால வானத்திலே');
  });

  it('handles a draft with no headings at all', () => {
    const secs = lyricSections('வரி ஒன்று\nவரி இரண்டு');
    expect(secs).toHaveLength(1);
    expect(secs[0].heading).toBeNull();
  });
});

describe('buildLyricProfile', () => {
  it('carries the real prosody report rather than re-implementing it', () => {
    const p = buildLyricProfile(SAAYANGAALA);
    expect(p.prosody.lyricLineCount).toBe(4);
    expect(p.prosody.dominantSyllables).not.toBeNull();
  });

  it('is safe on an empty draft', () => {
    const p = buildLyricProfile('');
    expect(p.prosody.lyricLineCount).toBe(0);
    expect(p.repeatedWords).toEqual([]);
    expect(p.rootMotifs).toEqual([]);
    expect(p.registerSignal.register).toBe('unknown');
  });
});

describe('profileGrounding', () => {
  const text = () => profileGrounding(buildLyricProfile(SAAYANGAALA)).join('\n');

  it('labels the block as measured fact, not suggestion', () => {
    // If this reads as advice the model will argue with it; it must read as data.
    expect(text()).toMatch(/MEASURED FACTS/);
    expect(text()).toMatch(/do not re-derive or dispute/i);
  });

  it('states the meter as a number so the model cannot guess at it', () => {
    expect(text()).toMatch(/syllables\/line/);
  });

  it('names the root motif with its actual surface forms', () => {
    const t = text();
    expect(t).toMatch(/Root motifs/);
    expect(t).toContain('சாய்ந்து');
  });

  it('tells the critic to judge register against the SONG, not literary Tamil', () => {
    const t = profileGrounding(buildLyricProfile(COLLOQUIAL)).join('\n');
    expect(t).toMatch(/Register signal: colloquial/);
    expect(t).toMatch(/Judge consistency against THIS register/);
  });

  it('reports the rhyme families that were computed', () => {
    const t = profileGrounding(buildLyricProfile(SAAYANGAALA)).join('\n');
    expect(t).toMatch(/மோனை|எதுகை|இயைபு/);
  });

  it('stays compact — it rides ahead of the lyric on every call', () => {
    const long = Array.from({ length: 80 }, (_, i) => `வரிசை${i} காதல் வானம் மழையே`).join('\n');
    expect(profileGrounding(buildLyricProfile(long)).join('\n').length).toBeLessThan(2500);
  });

  it('produces a well-formed block for an empty draft rather than throwing', () => {
    expect(() => profileGrounding(buildLyricProfile(''))).not.toThrow();
    expect(profileGrounding(buildLyricProfile('')).length).toBeGreaterThan(0);
  });
});
