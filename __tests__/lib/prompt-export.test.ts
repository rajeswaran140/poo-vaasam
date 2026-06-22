import {
  buildExportPack,
  exportPackToMarkdown,
  deriveExclusions,
  deriveWeirdness,
  exportFilename,
} from '@/lib/prompt-export';

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
