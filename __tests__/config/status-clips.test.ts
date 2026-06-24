import { existsSync } from 'fs';
import { join } from 'path';
import { STATUS_CLIPS, clipForSong, posterForClip } from '@/config/status-clips';

describe('status-clips config', () => {
  it('has a clip for each staged song with no duplicates', () => {
    const ids = STATUS_CLIPS.map((c) => c.songId);
    const clips = STATUS_CLIPS.map((c) => c.clip);
    expect(new Set(ids).size).toBe(ids.length); // unique songs
    expect(new Set(clips).size).toBe(clips.length); // unique files
    expect(STATUS_CLIPS.length).toBeGreaterThan(0);
  });

  it('every clip is a same-origin /clips path (CORS-free for share + download)', () => {
    for (const { clip } of STATUS_CLIPS) {
      expect(clip).toMatch(/^\/clips\/[\w-]+\.mp4$/);
    }
  });

  it('every referenced clip file actually exists in /public', () => {
    for (const { clip } of STATUS_CLIPS) {
      const onDisk = join(process.cwd(), 'public', clip.replace(/^\//, ''));
      expect(existsSync(onDisk)).toBe(true);
    }
  });

  it('clipForSong returns the file for a known song and undefined otherwise', () => {
    const known = STATUS_CLIPS[0];
    expect(clipForSong(known.songId)).toBe(known.clip);
    expect(clipForSong('cnt_does_not_exist')).toBeUndefined();
  });

  it('posterForClip maps the clip to its same-origin .jpg sibling', () => {
    expect(posterForClip('/clips/engaldesam-short.mp4')).toBe('/clips/engaldesam-short.jpg');
  });

  it("every clip's poster thumbnail (the short's own frame) exists in /public", () => {
    for (const { clip } of STATUS_CLIPS) {
      const poster = posterForClip(clip);
      expect(poster).toMatch(/^\/clips\/[\w-]+\.jpg$/);
      const onDisk = join(process.cwd(), 'public', poster.replace(/^\//, ''));
      expect(existsSync(onDisk)).toBe(true);
    }
  });
});
