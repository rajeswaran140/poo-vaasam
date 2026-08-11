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
  openingSoundFamilies,
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

describe('openingSoundFamilies', () => {
  it('finds one root re-inflected across the song', () => {
    const motifs = openingSoundFamilies(SAAYANGAALA);
    const saai = motifs.find((m) => m.forms.some((f) => f.startsWith('சாய')));
    expect(saai).toBeDefined();
    expect(saai!.forms).toEqual(expect.arrayContaining(['சாயங்கால', 'சாய்ந்த', 'சாய்ந்து']));
  });

  it('needs DISTINCT surface forms — repeating one word is not a motif', () => {
    // Three uses of the same word is repetition; repeatedWords reports that.
    const motifs = openingSoundFamilies('காதல் வந்தது\nகாதல் போனது\nகாதல் மீண்டும்');
    expect(motifs.find((m) => m.forms.length >= 2 && m.forms.every((f) => f === 'காதல்'))).toBeUndefined();
  });

  it('ignores words too short to carry a root', () => {
    expect(MIN_WORD_GRAPHEMES).toBeGreaterThan(ROOT_PREFIX_GRAPHEMES);
    expect(openingSoundFamilies('ஒரு இரு')).toEqual([]);
  });

  it('returns nothing on an empty draft rather than throwing', () => {
    expect(openingSoundFamilies('')).toEqual([]);
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


  it('does NOT flag ordinary words that merely end in ல', () => {
    // சாயங்கால appears in the first line of the song this module was built
    // for, and an earlier rule flagged it as colloquial: any long word ending
    // in ல matched. `ால` is not a locative.
    const s = registerSignal('சாயங்கால வானத்திலே சாய்ந்து போனேன்');
    expect(s.colloquialHits).not.toContain('சாயங்கால');
  });

  it('separates the colloquial locative from the literary one', () => {
    // வரப்பில (spoken) vs வரப்பில் (literary) differ ONLY by the pulli, so the
    // check must run on the raw word — normalising collapses them.
    expect(registerSignal('வரப்பில நடந்து').colloquialHits).toContain('வரப்பில');
    expect(registerSignal('வரப்பில் நடந்து').colloquialHits).toEqual([]);
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
    expect(p.soundFamilies).toEqual([]);
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

  it('gives a line-length figure without calling it the metre', () => {
    // The count is still useful for comparing lines; it just must not be
    // presented as a metre reading. See the metre-humility block below.
    expect(text()).toMatch(/எழுத்து/);
    expect(text()).not.toMatch(/syllables\/line/);
  });

  it('names the sound family with its actual surface forms', () => {
    const t = text();
    expect(t).toMatch(/OPEN WITH THE SAME SOUND/);
    expect(t).toContain('சாய்ந்து');
    // and it must NOT claim etymology
    expect(t).toMatch(/NOT evidence of a shared root or etymology/);
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

/**
 * METRE HUMILITY (added after Raj's review, 2026-08-10).
 *
 * The first version of this block stated the syllable count as settled fact and
 * told the model not to dispute it. That is wrong for Tamil: an எழுத்து count
 * is not metre — அசை (நேர்/நிரை), சீர் and மாத்திரை decide a line's weight, and
 * குறில்/நெடில் and ஒற்று change it without changing the count. The confident
 * numeric framing licensed melodic verdicts the number cannot support.
 */
describe('grounding does not overstate Tamil metre', () => {
  const text = () => profileGrounding(buildLyricProfile(SAAYANGAALA)).join('\n');

  it('names the count a COARSE PROXY rather than a metre reading', () => {
    expect(text()).toMatch(/COARSE PROXY, NOT A METRE READING/);
  });

  it('names the real units of Tamil rhythm so the model knows what it lacks', () => {
    const t = text();
    expect(t).toContain('அசை');
    expect(t).toContain('சீர்');
    expect(t).toContain('மாத்திரை');
  });

  it('forbids using the count to pronounce on the melody', () => {
    expect(text()).toMatch(/never to pronounce on how the melody will sit/i);
  });

  it('describes outlier lines RELATIVELY, not with a bare number', () => {
    // "runs longer than the rest" is defensible; "(9)" invites a verdict.
    const uneven = 'காதல் வா\nமிக நீண்ட ஒரு வரி இது ஆகும் நிஜமாக\nகாதல் வா';
    const t = profileGrounding(buildLyricProfile(uneven)).join('\n');
    expect(t).toMatch(/longer|shorter/);
    expect(t).not.toMatch(/\(\d+\)/); // no naked per-line syllable numbers
  });
});

/**
 * SOUND IS NOT ETYMOLOGY (Raj, 2026-08-10).
 *
 * The detector compares opening graphemes. That groups சாயங்கால/சாய்ந்த/சாய்ந்து
 * (a real shared verb root) AND அகம்/அகப்பை (no shared root at all) — it cannot
 * tell them apart. Labelling every match "same root re-inflected" is what led
 * the critic to assert a shared root between அகம் and அகப்பை. The label was the
 * bug, not the model.
 */
describe('opening-sound families never claim a shared root', () => {
  it('groups அகம் / அகப்பை — which share a SOUND, not a root', () => {
    const fam = openingSoundFamilies('அகம் நிறைந்த வீட்டில்\nஅகப்பை தேடுறது');
    const ak = fam.find((f) => f.forms.includes('அகம்'));
    expect(ak).toBeDefined();
    expect(ak!.forms).toEqual(expect.arrayContaining(['அகம்', 'அகப்பை']));
  });

  it('cannot distinguish a real root motif from a coincidence, and says so', () => {
    // Both of these look identical to the code. The grounding must therefore
    // describe SOUND and hand the judgement to whoever reads the words.
    const real = openingSoundFamilies('சாயங்கால வானம்\nசாய்ந்து போனேன்');
    const coincidence = openingSoundFamilies('அகம் நிறைந்தது\nஅகப்பை இருந்தது');
    expect(real.length).toBeGreaterThan(0);
    expect(coincidence.length).toBeGreaterThan(0);
    const g = profileGrounding(buildLyricProfile('அகம் நிறைந்தது\nஅகப்பை இருந்தது')).join('\n');
    expect(g).toMatch(/SOUND correspondence only/);
    expect(g).toMatch(/NOT evidence of a shared root or etymology/);
    expect(g).toMatch(/never assert a shared root from sound alone/);
  });

  it('no longer uses the word "root" as the label for a match', () => {
    const g = profileGrounding(buildLyricProfile('சாயங்கால வானம்\nசாய்ந்து போனேன்')).join('\n');
    expect(g).not.toMatch(/Root motifs \(same root re-inflected\)/);
  });
});

/**
 * PROSODY LABELS (Raj's fifth review, 2026-08-10).
 *
 * `monai` is the first grapheme's base sound; `etukai` the second grapheme.
 * Positional string matches — real மோனை and எதுகை carry metrical conditions
 * this code does not check. Labelling the groups with the classical names is
 * what produced "'க' மோனை chains" and a "'ண்'/'ன்' எதுகை web" stated as fact.
 */
describe('grounding does not claim classical prosody', () => {
  const SOUNDS = ['கைவளையல் ஒலிக்க', 'காற்றோடு கூந்தல்', 'செவ்விதழ் சிரிக்க', 'சிந்தையில் நிறைய'].join('\n');
  const g = () => profileGrounding(buildLyricProfile(SOUNDS)).join('\n');

  it('describes POSITIONAL matches, not மோனை/எதுகை classifications', () => {
    const t = g();
    expect(t).toMatch(/Lines sharing an OPENING sound/);
    expect(t).not.toMatch(/- மோனை \(/);
    expect(t).not.toMatch(/- எதுகை \(/);
  });

  it('warns that these are not verified classical forms', () => {
    expect(g()).toMatch(/POSITIONAL SOUND MATCHES, not verified மோனை/);
    expect(g()).toMatch(/do NOT name a classical form unless/);
  });

  it('lists the MEMBER words so a line cannot be misattributed', () => {
    // The critic claimed செவ்விதழ் sustained a "க" opening; it begins with ச.
    const t = g();
    expect(t).toContain('கைவளையல்');
    expect(t).toContain('செவ்விதழ்');
    // and the ச words must not appear inside the "க" group
    const kGroup = t.match(/"க[^"]*" in ([^·\n]*)/)?.[1] ?? '';
    expect(kGroup).not.toContain('செவ்விதழ்');
  });

  it('marks word counts as EXACT and forbids inventing others', () => {
    const t = profileGrounding(buildLyricProfile('கலக்க ஒன்று\nகலக்க இரண்டு\nகலக்க மூன்று')).join('\n');
    expect(t).toMatch(/EXACT — state no number that is not in this list/);
    expect(t).toContain('கலக்க ×3');
  });
});
