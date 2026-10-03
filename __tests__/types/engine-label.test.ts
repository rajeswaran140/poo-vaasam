/**
 * The generation engine is STORED as 'suno' — renaming stored data would need a
 * migration and gains nothing — but it is SHOWN as TamilAgaval Music.
 */
import { engineLabel, GENERATION_ENGINES } from '@/types/generation';

describe('engineLabel', () => {
  it('shows the stored "suno" as TamilAgaval Music', () => {
    expect(engineLabel('suno')).toBe('TamilAgaval Music');
  });

  it('leaves every other engine as it is', () => {
    for (const e of GENERATION_ENGINES.filter((x) => x !== 'suno')) expect(engineLabel(e)).toBe(e);
  });

  it('keeps the stored value itself unchanged', () => {
    expect(GENERATION_ENGINES).toContain('suno');
  });
});
