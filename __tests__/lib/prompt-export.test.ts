import {
  buildExportPack,
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

  it('derives exclusions, weirdness and a moderate style influence', () => {
    expect(pack.weirdnessPct).toBe(15); // devotional → low
    expect(pack.styleInfluencePct).toBe(50);
    expect(pack.excludeStyles.length).toBeGreaterThan(0);
  });

  it('falls back to "Untitled" on a blank title', () => {
    expect(buildExportPack({ title: '  ', lyrics: 'x', styleName: 's', stylePrompt: 'p' }).title).toBe('Untitled');
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
