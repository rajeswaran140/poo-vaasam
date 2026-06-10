/** @jest-environment node */
import { getSongHero, SONG_HEROES } from '@/config/song-heroes';

describe('getSongHero', () => {
  it('returns a resolved hero (heading + image URL) for a configured song', () => {
    const id = 'cnt_1781049094952_wstyqacm4'; // எங்கள் தேசம் → தாயகம்
    const hero = getSongHero(id);
    expect(hero).toBeDefined();
    expect(hero!.heading).toBe('தாயகம்');
    // image resolves through mediaUrl → ends with the encoded key path
    expect(hero!.image).toContain('images/song-covers/thayagam-hero.png');
    expect(hero!.image).toMatch(/^https?:\/\//);
  });

  it('returns undefined for a song without a bespoke hero', () => {
    expect(getSongHero('cnt_does_not_exist')).toBeUndefined();
  });

  it('every configured hero has a heading and an image key', () => {
    for (const [id, hero] of Object.entries(SONG_HEROES)) {
      expect(id).toMatch(/^cnt_/);
      expect(hero.heading.length).toBeGreaterThan(0);
      expect(hero.imageKey).toMatch(/^images\//);
    }
  });
});
