import { existsSync } from 'fs';
import { join } from 'path';
import { STATUS_CLIPS, clipForSong } from '@/config/status-clips';

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
});
