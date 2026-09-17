/** @jest-environment node */
/**
 * Where a song has got to, and what to do next.
 *
 * The line exists because the library row showed download links and left the
 * state to be inferred from them — which on 2026-09-16 cost a 3-minute render
 * on a song that was already uploaded and scheduled to premiere. These tests
 * pin the two properties that make the line trustworthy: it never disagrees
 * with the buttons, and it never implies a release is finished when the only
 * remaining steps are ones no API can perform.
 */
import { pipelineFor, nextAction, pipelineSummary } from '@/lib/release-pipeline';
import type { MasterJob } from '@/types/masterJob';

const job = (over: Partial<MasterJob> = {}): MasterJob => ({
  ...({} as MasterJob),
  status: 'done',
  savedAt: '2026-09-16T00:00:00.000Z',
  masterKey: 'audio/mastering/a-master-14LUFS.wav',
  mp3Key: null, videoKey: null, shortKey: null, coverKey: null,
  youtubeVideoId: null, uploadStatus: null, title: 'ஒரு பாடல்',
  target: -14, editedDurationSec: 300,
  ...over,
});

const FULL = {
  mp3Key: 'audio/mastering/a-master-14LUFS.mp3',
  coverKey: 'audio/mastering/1_c_cover.jpg',
  videoKey: 'audio/mastering/a-master-14LUFS-1440p.mp4',
  shortKey: 'audio/mastering/a-master-14LUFS-short-1920.mp4',
  youtubeVideoId: 'abc123',
};

describe('the dots', () => {
  it('reports every stage, in release order', () => {
    expect(pipelineFor(job()).map((s) => s.id)).toEqual(['master', 'mp3', 'video', 'short', 'youtube']);
  });

  it('a fresh saved master has only its first stage done', () => {
    expect(pipelineFor(job()).filter((s) => s.done).map((s) => s.id)).toEqual(['master']);
    expect(pipelineSummary(job())).toBe('1 of 5');
  });

  it('a finished release has them all', () => {
    expect(pipelineFor(job(FULL)).every((s) => s.done)).toBe(true);
    expect(pipelineSummary(job(FULL))).toBe('5 of 5');
  });

  it('reads presence, not truthiness of an empty string', () => {
    expect(pipelineFor(job({ mp3Key: '' })).find((s) => s.id === 'mp3')!.done).toBe(false);
  });
});

describe('the next action', () => {
  it('walks the release in order', () => {
    expect(nextAction(job())!.label).toMatch(/Encode the web MP3/);
    expect(nextAction(job({ mp3Key: FULL.mp3Key }))!.label).toMatch(/Add a cover/);
    expect(nextAction(job({ mp3Key: FULL.mp3Key, coverKey: FULL.coverKey }))!.label).toMatch(/Render the video/);
    expect(nextAction(job({ ...FULL, youtubeVideoId: null, shortKey: null }))!.label).toMatch(/Upload to YouTube/);
  });

  it('asks for the cover BEFORE offering the render, matching planRender', () => {
    // If these two ever disagree the line points at a disabled button.
    const j = job({ mp3Key: FULL.mp3Key });
    expect(nextAction(j)!.stage).toBe('video');
    expect(nextAction(j)!.label).toMatch(/Add a cover/);
  });

  it('never proposes a short before the song is on YouTube', () => {
    // A clip for a song nobody can watch yet is work in the wrong order.
    const j = job({ mp3Key: FULL.mp3Key, coverKey: FULL.coverKey, videoKey: FULL.videoKey });
    expect(nextAction(j)!.stage).toBe('youtube');
    expect(nextAction(j)!.label).not.toMatch(/short/i);
  });

  it('proposes the short once the release is up', () => {
    const j = job({ ...FULL, shortKey: null });
    expect(nextAction(j)!.stage).toBe('short');
  });

  /**
   * ⚠️ The panel must never imply a release is finished when Studio-only steps
   * remain. Pinning a comment and creating a Premiere cannot be done by any
   * API, permanently.
   */
  it('ends by pointing OUTSIDE the portal, and says so', () => {
    const a = nextAction(job(FULL))!;
    expect(a.label).toMatch(/Studio/);
    expect(a.external).toBe(true);
    expect(a.stage).toBe('studio');
  });

  it('never returns null for a saved master — there is always a next thing', () => {
    for (const over of [{}, { mp3Key: FULL.mp3Key }, FULL]) {
      expect(nextAction(job(over))).not.toBeNull();
    }
  });

  it('catches the two states that are not ready for any of it', () => {
    expect(nextAction(job({ status: 'processing' }))!.label).toMatch(/Finish mastering/);
    // An unsaved job expires in 24h, so saving is genuinely the next thing.
    expect(nextAction(job({ savedAt: null }))!.label).toMatch(/expire/);
  });

  /**
   * The case that motivated this. A song already uploaded and premiering must
   * not read as something still to be worked on.
   */
  it('a song already on YouTube is never told to render or upload again', () => {
    const a = nextAction(job(FULL))!;
    expect(a.label).not.toMatch(/Render|Upload|Encode/i);
  });
});
