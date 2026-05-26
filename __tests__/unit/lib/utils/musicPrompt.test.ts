import { buildMusicPrompt } from '@/lib/utils/musicPrompt';

describe('buildMusicPrompt', () => {
  it('always requests instrumental music with no vocals', () => {
    for (const emotion of ['sad', 'joyful', 'devotional', undefined, null]) {
      const p = buildMusicPrompt(emotion as string | null | undefined).toLowerCase();
      expect(p).toContain('instrumental');
      expect(p).toContain('no vocals');
    }
  });

  it('maps a known emotion to a matching description', () => {
    expect(buildMusicPrompt('sad').toLowerCase()).toContain('melancholic');
    expect(buildMusicPrompt('joyful').toLowerCase()).toMatch(/uplifting|cheerful|bright/);
    expect(buildMusicPrompt('devotional').toLowerCase()).toContain('devotional');
  });

  it('falls back to mood when the emotion is unknown', () => {
    expect(buildMusicPrompt('nonsense', 'peaceful').toLowerCase()).toContain('peaceful');
  });

  it('uses a sensible default when both emotion and mood are unknown', () => {
    const p = buildMusicPrompt(null, null);
    expect(p.length).toBeGreaterThan(10);
    expect(p.toLowerCase()).toContain('instrumental');
  });
});
