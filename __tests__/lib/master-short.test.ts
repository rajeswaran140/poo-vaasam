/** @jest-environment node */
import {
  planShort, shortRefusalMessage, shortKeyFor, isShortKey,
  buildShortComposeArgs, buildShortArgs, buildLoudnessArgs,
  SHORT_WIDTH, SHORT_HEIGHT, SHORT_SECONDS, SHORT_FPS, SHORT_FADE_SEC,
  SHORT_PICK_MIN_SECONDS, SHORT_PICK_MAX_SECONDS,
  type ShortRefusal,
} from '@/lib/master-short';
import type { MasterJob } from '@/types/masterJob';

const job = (over: Partial<MasterJob> = {}): MasterJob => ({
  ...({} as MasterJob),
  status: 'done',
  savedAt: '2026-09-16T00:00:00.000Z',
  masterKey: 'audio/mastering/1_a_x-master-14LUFS.wav',
  editedDurationSec: 297,
  ...over,
});
const COVER = 'audio/mastering/1_a_cover.png';

describe('the clip is vertical, because that is the only shape Reels serves', () => {
  it('is 1080×1920', () => {
    expect(SHORT_WIDTH).toBe(1080);
    expect(SHORT_HEIGHT).toBe(1920);
    expect(buildShortComposeArgs({ coverPath: 'c.png', framePath: 'f.png' }).join(' '))
      .toContain('scale=1080:1920');
  });

  it('ALWAYS keeps the blurred backdrop — a 16:9 cover cannot fill 9:16 without losing most of the picture', () => {
    // The long-form render fills the frame for 16:9 art. Doing that here would
    // crop the artwork away, which is the one outcome ruled out outright.
    const f = buildShortComposeArgs({ coverPath: 'c.png', framePath: 'f.png' }).join(' ');
    expect(f).toContain('boxblur');
    expect(f).toContain('overlay=(W-w)/2:(H-h)/2');
  });
});

describe('render cost — the encode must not re-filter every frame', () => {
  const a = buildShortArgs({ framePath: 'f.png', audioPath: 'a.wav', startSec: 61.5, outPath: 'o.mp4' });

  it('THE ENCODE CARRIES NO -filter_complex — this is what keeps it cheap', () => {
    expect(a).not.toContain('-filter_complex');
  });

  it('uses a plain -af for the fade, which is per-sample not per-frame', () => {
    expect(a[a.indexOf('-af') + 1]).toContain('afade=t=in');
    expect(a[a.indexOf('-af') + 1]).toContain('afade=t=out');
  });

  it('runs at 25 fps, not the long render’s 10 — 10 reads as a glitch in a feed', () => {
    expect(SHORT_FPS).toBe(25);
    expect(a[a.indexOf('-r') + 1]).toBe('25');
  });
});

describe('the clip opens on the hook, not the intro', () => {
  it('seeks BEFORE the input so ffmpeg jumps rather than decoding from zero', () => {
    const a = buildShortArgs({ framePath: 'f.png', audioPath: 'a.wav', startSec: 61.5, outPath: 'o.mp4' });
    // -ss must precede the -i it applies to, or the seek is a slow decode.
    expect(a.indexOf('-ss')).toBeLessThan(a.lastIndexOf('-i'));
    expect(a[a.indexOf('-ss') + 1]).toBe('61.500');
  });

  it('fades out ending exactly at the clip end, never past it', () => {
    const a = buildShortArgs({ framePath: 'f.png', audioPath: 'a.wav', startSec: 10, outPath: 'o.mp4' });
    const af = a[a.indexOf('-af') + 1];
    expect(af).toContain(`st=${(SHORT_SECONDS - SHORT_FADE_SEC).toFixed(3)}`);
  });

  it('measures loudness without producing a file — only the log matters', () => {
    const a = buildLoudnessArgs('a.wav');
    expect(a).toContain('ebur128=peak=true');
    expect(a.slice(-2)).toEqual(['null', '-']);
  });
});

describe('planShort', () => {
  it('cuts from the MASTER, never the web MP3', () => {
    const p = planShort(job(), COVER);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.audioKey).toBe(job().masterKey);
      expect(p.shortKey).toBe('audio/mastering/1_a_x-master-14LUFS-short-1920.mp4');
    }
  });

  it('refuses a track shorter than the clip — there is nothing to cut', () => {
    expect(planShort(job({ editedDurationSec: 20 }), COVER)).toEqual({ ok: false, reason: 'too-short' });
  });

  it('allows an unmeasured duration rather than refusing on missing data', () => {
    expect(planShort(job({ editedDurationSec: null }), COVER).ok).toBe(true);
  });

  it('refuses an unsaved master, whose provenance expires in 24h', () => {
    expect(planShort(job({ savedAt: null }), COVER)).toEqual({ ok: false, reason: 'not-saved' });
  });

  it('requires a cover, and requires it to be in the workspace', () => {
    expect(planShort(job(), null)).toEqual({ ok: false, reason: 'no-cover' });
    expect(planShort(job(), 'audio/poem-music/elsewhere.png')).toEqual({ ok: false, reason: 'bad-cover' });
  });

  it('every refusal has actionable wording', () => {
    const all: ShortRefusal[] = ['not-done', 'not-saved', 'no-master', 'no-cover', 'bad-cover', 'too-short'];
    for (const r of all) expect(shortRefusalMessage(r).length).toBeGreaterThan(10);
  });
});

describe('shortKeyFor / isShortKey', () => {
  it('sits beside the master and is recognisable as its own output', () => {
    const k = shortKeyFor('audio/mastering/x-master-14LUFS.wav');
    expect(isShortKey(k)).toBe(true);
  });

  it('does not claim the long-form video or the master', () => {
    expect(isShortKey('audio/mastering/x-master-14LUFS-1440p.mp4')).toBe(false);
    expect(isShortKey('audio/mastering/x-master-14LUFS.wav')).toBe(false);
  });
});

/**
 * The operator's own window.
 *
 * The loudness pass finds the chorus, which is not the same question as "where
 * are the best lines". These rules exist so a chosen window is either used as
 * chosen or refused out loud — never silently adjusted into something the
 * operator did not audition.
 */
describe('planShort with a chosen window', () => {

  it('carries the window through, rounded to the tenth a waveform can express', () => {
    const plan = planShort(job(), COVER, { startSec: 96.04, seconds: 45 });
    expect(plan).toMatchObject({ ok: true, window: { startSec: 96, seconds: 45 } });
  });

  it('means "you decide" when neither field is given', () => {
    expect(planShort(job(), COVER)).toMatchObject({ ok: true, window: null });
    expect(planShort(job(), COVER, {})).toMatchObject({ ok: true, window: null });
    expect(planShort(job(), COVER, null)).toMatchObject({ ok: true, window: null });
  });

  it('refuses a half-given window rather than inventing the other half', () => {
    // Guessing a length for a start the operator chose is how a clip nobody
    // auditioned gets posted.
    expect(planShort(job(), COVER, { startSec: 96 })).toEqual({ ok: false, reason: 'bad-window' });
    expect(planShort(job(), COVER, { seconds: 45 })).toEqual({ ok: false, reason: 'bad-window' });
  });

  it.each([
    ['shorter than the editorial floor', { startSec: 10, seconds: SHORT_PICK_MIN_SECONDS - 1 }],
    ['longer than the ceiling', { startSec: 10, seconds: SHORT_PICK_MAX_SECONDS + 1 }],
    ['a negative start', { startSec: -1, seconds: 30 }],
    ['a non-finite start', { startSec: Number.NaN, seconds: 30 }],
    ['a non-finite length', { startSec: 10, seconds: Number.POSITIVE_INFINITY }],
  ])('refuses %s', (_label, want) => {
    expect(planShort(job(), COVER, want)).toEqual({ ok: false, reason: 'bad-window' });
  });

  it('accepts both ends of the allowed range', () => {
    expect(planShort(job(), COVER, { startSec: 0, seconds: SHORT_PICK_MIN_SECONDS })).toMatchObject({ ok: true });
    expect(planShort(job(), COVER, { startSec: 0, seconds: SHORT_PICK_MAX_SECONDS })).toMatchObject({ ok: true });
  });

  it('REFUSES a window running past the end — never quietly shortens it', () => {
    // The operator heard those seconds. Handing back a different clip than the
    // one they auditioned is the worst of both.
    const plan = planShort(job({ editedDurationSec: 100 }), COVER, { startSec: 80, seconds: 30 });
    expect(plan).toEqual({ ok: false, reason: 'window-past-end' });
    expect(shortRefusalMessage('window-past-end')).toMatch(/past the end/i);
  });

  it('allows a window on a track whose duration was never measured', () => {
    // The worker re-checks against the file's own header; refusing here on
    // missing data would block the exact jobs that predate the measurement.
    expect(planShort(job({ editedDurationSec: null }), COVER, { startSec: 80, seconds: 30 }))
      .toMatchObject({ ok: true, window: { startSec: 80, seconds: 30 } });
  });

  it('does not apply the too-short refusal to a chosen window', () => {
    // `too-short` asks "is there room for the DEFAULT clip"; a chosen window
    // answers that question itself.
    const plan = planShort(job({ editedDurationSec: 35 }), COVER, { startSec: 0, seconds: 30 });
    expect(plan).toMatchObject({ ok: true });
  });

  it('every refusal reason still has wording', () => {
    for (const reason of [
      'not-done', 'not-saved', 'no-master', 'no-cover', 'bad-cover', 'too-short',
      'bad-window', 'window-past-end',
    ] as const) {
      expect(shortRefusalMessage(reason).trim().length).toBeGreaterThan(0);
    }
  });
});
