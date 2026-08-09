import {
  buildExportPack,
  buildStyleAnchor,
  exportPackToMarkdown,
  deriveExclusions,
  deriveWeirdness,
  exportFilename,
  analysisToFullMarkdown,
  serializeBriefFile,
  parseBriefFile,
} from '@/lib/prompt-export';
import type { ComposerAnalysis } from '@/services/ai/composerSchema';

const ANALYSIS: ComposerAnalysis = {
  emotion: 'காதல்',
  emotion_breakdown: ['காதல்', 'ஏக்கம்'],
  mood: 'Tender',
  theme: 'Homeland love',
  suggested_key: 'D Minor',
  suggested_bpm: 72,
  suggested_instruments: ['Flute', 'Veena'],
  suggested_ragas: ['Kaapi'],
  recommended_voice: ['Female Adult'],
  song_titles: ['மண்வாசம்', 'ஊர் நினைவு'],
  suno_prompts: [
    { style: 'Devotional', prompt: 'Soft devotional Tamil ballad with flute.' },
    { style: 'Village', prompt: 'Rustic folk with nadaswaram.' },
  ],
  thumbnail_prompt: 'A misty paddy field at dawn, 16:9.',
  youtube_description_tamil: 'தமிழ் விளக்கம் #tamilagaval',
  youtube_description_english: 'English description #tamilagaval',
  reel: { hook: 'மண்வாசம்', caption: 'Homeland', hashtags: ['#tamil', '#amma'] },
};

describe('analysisToFullMarkdown', () => {
  it('renders every section and all style variants', () => {
    const md = analysisToFullMarkdown(ANALYSIS, 'பல்லவி வரிகள்');
    expect(md).toContain('# மண்வாசம்'); // title from first song title
    expect(md).toContain('பல்லவி வரிகள்'); // lyrics
    expect(md).toContain('Dominant: **காதல்**');
    expect(md).toContain('காதல் › ஏக்கம்'); // ranked emotions
    expect(md).toContain('D Minor');
    expect(md).toContain('Flute, Veena');
    // both style variants present
    expect(md).toContain('### 1. Devotional');
    expect(md).toContain('### 2. Village');
    expect(md).toContain('Rustic folk with nadaswaram.');
    expect(md).toContain('A misty paddy field at dawn'); // thumbnail
    expect(md).toContain('#tamilagaval'); // yt descriptions
    expect(md).toContain('Hook:'); // reel
  });
});

describe('serializeBriefFile / parseBriefFile', () => {
  it('round-trips lyrics + analysis through a JSON file', () => {
    const json = serializeBriefFile('lyrics here', ANALYSIS);
    const parsed = parseBriefFile(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.lyrics).toBe('lyrics here');
      expect(parsed.analysis.song_titles[0]).toBe('மண்வாசம்');
      expect(parsed.analysis.suno_prompts).toHaveLength(2);
    }
  });

  it('rejects non-JSON', () => {
    const r = parseBriefFile('not json {{{');
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects a JSON file that is not a Tamilagaval brief', () => {
    const r = parseBriefFile(JSON.stringify({ hello: 'world' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Tamilagaval brief/i);
  });

  it('rejects a brief with an invalid/incompatible analysis', () => {
    const bad = JSON.stringify({ format: 'tamilagaval-brief', version: 1, lyrics: 'x', analysis: { emotion: 'காதல்' } });
    const r = parseBriefFile(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid|incompatible/i);
  });
});

describe('deriveExclusions', () => {
  it('returns the default exclusions for a melodic style', () => {
    const ex = deriveExclusions('Tamil romantic ballad, flute and veena, soft vocals');
    expect(ex).toContain('EDM');
    expect(ex).toContain('rap');
  });

  it('drops an exclusion the style actually asks for', () => {
    // A rap-styled prompt should NOT list "rap" as an exclusion (check the
    // list entries, not a substring — "trap beats" legitimately contains "rap").
    const list = deriveExclusions('modern Tamil rap with heavy beats').split(', ');
    expect(list).not.toContain('rap');
  });
});

describe('deriveWeirdness', () => {
  it('is low for traditional/devotional styles', () => {
    expect(deriveWeirdness('Carnatic devotional ballad in raga Abheri')).toBe(15);
  });
  it('is higher for experimental styles', () => {
    expect(deriveWeirdness('experimental electronic fusion')).toBe(35);
  });
  it('defaults to 20 otherwise', () => {
    expect(deriveWeirdness('a pop song')).toBe(20);
  });
});

describe('buildExportPack', () => {
  const pack = buildExportPack({
    title: 'அம்மா உந்தன் நினைவுகள்',
    lyrics: '[Chorus]\nஅம்மா உந்தன் நினைவுகள்',
    styleName: 'Carnatic Devotional Ballad',
    stylePrompt: 'A Carnatic devotional ballad in raga Abheri with flute and veena.',
    mood: 'Melancholic',
  });

  it('carries the title, lyrics and style through', () => {
    expect(pack.title).toBe('அம்மா உந்தன் நினைவுகள்');
    expect(pack.lyrics).toContain('அம்மா');
    expect(pack.style).toContain('raga Abheri');
    expect(pack.styleName).toBe('Carnatic Devotional Ballad');
  });

  it('derives exclusions and weirdness', () => {
    expect(pack.weirdnessPct).toBe(15); // devotional → low
    expect(pack.excludeStyles.length).toBeGreaterThan(0);
  });

  it('scales style influence to how much the prompt actually specifies', () => {
    // Was hardcoded 50 — which tells the generator to follow a dense, carefully
    // built prompt only loosely, discarding the detail it was built for.
    const thin = buildExportPack({ title: 'T', lyrics: 'L', styleName: 'S', stylePrompt: 'A ballad.' });
    const dense = buildExportPack({
      title: 'T', lyrics: 'L', styleName: 'S',
      stylePrompt:
        'Tamil film romantic duet, secular love song, melody-driven playback idiom, 1980s arrangement, 82 BPM, ' +
        'buoyant 6/8 lilt | male and female alternating leads, soulful baritone, sweet clear female lead, ' +
        'call-and-response duet, clear Tamil diction | bamboo flute motif, acoustic guitar, warm strings, ' +
        'solo violin, mandolin, dholak groove | tape saturation, plate reverb | uplifting, radiant, playful',
    });
    expect(thin.styleInfluencePct).toBeLessThan(dense.styleInfluencePct);
    expect(dense.styleInfluencePct).toBeGreaterThanOrEqual(75);
  });

  it('caps exclusions — a long negative list dilutes every item in it', () => {
    expect(pack.excludeStyles.split(', ').length).toBeLessThanOrEqual(3);
  });

  it('reports whether the lyric was arranged, and checks the pack', () => {
    expect(pack.arranged).toBe(false); // fixture passes a bare lyric
    expect(Array.isArray(pack.findings)).toBe(true);
    const tagged = buildExportPack({
      title: 'T', lyrics: 'raw', styleName: 'S', stylePrompt: 'A ballad.',
      lyricsBlock: '[Chorus - Male Lead]\nவரி',
    });
    expect(tagged.arranged).toBe(true);
    expect(tagged.lyrics).toContain('[Chorus - Male Lead]');
  });

  it('falls back to "Untitled" on a blank title', () => {
    expect(buildExportPack({ title: '  ', lyrics: 'x', styleName: 's', stylePrompt: 'p' }).title).toBe('Untitled');
  });
});

// Suno support (2026-07) confirmed a model-side regression in prompt adherence
// and advised naming exact genre, BPM, instrumentation and VOCAL CHARACTER. The
// brief already computed all four; only the model's prose paragraph was reaching
// the style box, and recommended_voice was being dropped entirely.
describe('buildStyleAnchor', () => {
  const full = {
    title: 'T',
    lyrics: 'L',
    styleName: 'S',
    stylePrompt: 'A Carnatic devotional ballad with flute and veena.',
    bpm: 78,
    key: 'D Minor',
    ragas: ['Abheri', 'Todi'],
    instruments: ['bansuri', 'veena', 'tabla'],
    voice: ['Male Baritone', 'Male Tenor'],
  };

  it('states BPM, key, raga, instruments and vocal character explicitly', () => {
    const anchor = buildStyleAnchor(full);
    expect(anchor).toContain('78 BPM');
    expect(anchor).toContain('key D Minor');
    expect(anchor).toContain('raga Abheri');
    expect(anchor).toContain('bansuri, veena, tabla');
    expect(anchor).toContain('vocal Male Baritone');
  });

  it('uses only the top-ranked raga and voice, not the whole ranked list', () => {
    const anchor = buildStyleAnchor(full);
    expect(anchor).not.toContain('Todi');
    expect(anchor).not.toContain('Male Tenor');
  });

  it('omits sections the brief did not supply', () => {
    const anchor = buildStyleAnchor({ title: 'T', lyrics: 'L', styleName: 'S', stylePrompt: 'p', bpm: 90 });
    expect(anchor).toBe('90 BPM.');
  });

  it('returns empty for a brief with no structured direction', () => {
    expect(buildStyleAnchor({ title: 'T', lyrics: 'L', styleName: 'S', stylePrompt: 'p' })).toBe('');
  });

  it('ignores blank entries rather than emitting empty fragments', () => {
    const anchor = buildStyleAnchor({
      title: 'T', lyrics: 'L', styleName: 'S', stylePrompt: 'p',
      key: '   ', ragas: ['', '  '], instruments: ['veena', ''], voice: [],
    });
    expect(anchor).toBe('lead instruments veena.');
  });
});

describe('buildExportPack — style anchor', () => {
  it('appends the anchor to the style the user pastes into the generator', () => {
    const pack = buildExportPack({
      title: 'T', lyrics: 'L', styleName: 'S',
      stylePrompt: 'A Carnatic devotional ballad.',
      bpm: 78, voice: ['Male Baritone'], instruments: ['veena'],
    });
    expect(pack.style).toBe('A Carnatic devotional ballad. 78 BPM. lead instruments veena. vocal Male Baritone.');
  });

  it('leaves the style untouched when the brief carries no structured direction', () => {
    const pack = buildExportPack({ title: 'T', lyrics: 'L', styleName: 'S', stylePrompt: 'A ballad.' });
    expect(pack.style).toBe('A ballad.');
  });

  it('still derives exclusions from the original prompt, not the anchor', () => {
    // The anchor names instruments; it must not accidentally cancel an exclusion.
    const pack = buildExportPack({
      title: 'T', lyrics: 'L', styleName: 'S',
      stylePrompt: 'A gentle acoustic ballad.',
      instruments: ['electric guitar'],
      exclude: ['distorted electric guitar'],
    });
    expect(pack.excludeStyles).toContain('distorted electric guitar');
  });
});

describe('exportPackToMarkdown', () => {
  it('emits one section per SUNO field', () => {
    const md = exportPackToMarkdown(
      buildExportPack({ title: 'T', lyrics: 'L', styleName: 'S', stylePrompt: 'flute ballad' })
    );
    expect(md).toContain('# T');
    expect(md).toContain('## 🎤 Lyrics');
    expect(md).toContain('## 🎚️ Style of Music');
    expect(md).toContain('## 🚫 Exclude Styles');
    expect(md).toContain('## 🎛️ Weirdness');
    expect(md).toContain('## 🌟 Style Influence');
  });
});

describe('exportFilename', () => {
  it('produces a safe ascii filename with the extension', () => {
    expect(exportFilename('My Song!! ❤️', 'md')).toBe('my-song.md');
  });
  it('falls back when the title has no ascii (e.g. pure Tamil)', () => {
    expect(exportFilename('அம்மா', 'md')).toBe('suno-pack.md');
  });
});
