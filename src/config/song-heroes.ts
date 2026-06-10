/**
 * Bespoke per-song hero sections.
 *
 * When a song's content id appears here, its dedicated page (/content/<id>)
 * renders a full-bleed image hero with `heading` as the big visible title,
 * instead of the default in-card title. Everything else — audio player, lyrics,
 * share row, and the song's STORED title (used for <title>/meta/share) — is
 * unchanged. This keeps the special-casing in one documented, data-driven place
 * rather than hard-coding ids into the page component.
 */

import { mediaUrl } from '@/lib/aws-config';

export interface SongHero {
  /** Big visible heading shown in the hero. */
  heading: string;
  /** S3 object key of the full-bleed background image. */
  imageKey: string;
}

export const SONG_HEROES: Record<string, SongHero> = {
  // எங்கள் தேசம் — bespoke designed banner (text baked into the artwork), shown
  // clean and in full. `heading` is kept for assistive tech / future visible use.
  cnt_1781049094952_wstyqacm4: {
    heading: 'தாயகம்',
    imageKey: 'images/song-covers/thayagam-hero.png',
  },
};

export interface ResolvedSongHero {
  heading: string;
  /** Public (CDN) URL of the background image. */
  image: string;
}

/** Resolve a song's hero (with a ready-to-use image URL), or undefined. */
export function getSongHero(id: string): ResolvedSongHero | undefined {
  const hero = SONG_HEROES[id];
  return hero ? { heading: hero.heading, image: mediaUrl(hero.imageKey) } : undefined;
}
