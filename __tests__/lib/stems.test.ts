import {
  STEMS_PREFIX, isValidMasterJobId, stemFolderFor, stemUploadKey, stemIdFromKey,
  isStemKeyFor, stemPreviewKey, stemRemixKey, guessStemName,
  planRemix, buildRemixArgs, MIN_GAIN_DB, MAX_GAIN_DB,
} from '@/lib/stems';
import { isMasteringKey } from '@/lib/mastering-storage';
import { isMasterKey } from '@/lib/loudness-measure';
import { isKaraokeMasterKey } from '@/lib/master-peak';
import type { StemSet } from '@/types/stemSet';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';

describe('master job ids', () => {
  it('accepts the ids the master route mints, and nothing path-like', () => {
    expect(isValidMasterJobId(JOB)).toBe(true);
    for (const bad of ['', '../x', 'a/b', 'a'.repeat(65), 7, null]) expect(isValidMasterJobId(bad)).toBe(false);
  });
});

describe('stem keys', () => {
  it('lives in the master\'s own folder inside the mastering workspace', () => {
    expect(stemFolderFor(JOB)).toBe(`${STEMS_PREFIX}${JOB}/`);
    const k = stemUploadKey(JOB, '2_Drums.wav', 1696000000000, 'ab12cd34');
    expect(k).toBe(`audio/mastering/stems/${JOB}/1696000000000_ab12cd34_2_Drums.wav`);
    expect(isMasteringKey(k)).toBe(true);
    expect(isStemKeyFor(JOB, k)).toBe(true);
  });

  it('gives the same file name uploaded twice two different keys and ids', () => {
    const a = stemUploadKey(JOB, 'Vocals.wav', 1, 'aaaaaaaa');
    const b = stemUploadKey(JOB, 'Vocals.wav', 2, 'bbbbbbbb');
    expect(a).not.toBe(b);
    expect(stemIdFromKey(a)).not.toBe(stemIdFromKey(b));
  });

  it('refuses a key in another master\'s folder, outside the workspace, or escaping it', () => {
    const other = stemUploadKey('ffffffff-1111-4222-8333-444455556666', 'x.wav', 1, 'n');
    expect(isStemKeyFor(JOB, other)).toBe(false);
    expect(isStemKeyFor(JOB, 'audio/mastering/x.wav')).toBe(false);
    expect(isStemKeyFor(JOB, `audio/mastering/stems/${JOB}/../../x.wav`)).toBe(false);
    expect(isStemKeyFor(JOB, `audio/mastering/stems/${JOB}/preview/x.m4a`)).toBe(false);
  });

  it('accepts every key stemUploadKey mints, even from a filename full of odd characters', () => {
    const k = stemUploadKey(JOB, '2 Drums (final) — v2.wav', 1696000000000, 'ab12cd34');
    expect(isStemKeyFor(JOB, k)).toBe(true);
  });

  it('accepts the worst case: an 8-char nonce (the upload route\'s randomUUID().slice(0, 8)) with the longest filename safeBase allows', () => {
    const longName = `${'a'.repeat(200)}.wav`; // safeBase caps the base at 80
    const k = stemUploadKey(JOB, longName, 1696000000000, 'ab12cd34');
    expect(k.length - `${STEMS_PREFIX}${JOB}/`.length).toBeLessThanOrEqual(124); // 120 + ".wav"
    expect(isStemKeyFor(JOB, k)).toBe(true);
  });

  it('refuses a crafted key with a space or an extra dot in the base, even though it still ends .wav', () => {
    const folder = stemFolderFor(JOB);
    expect(isStemKeyFor(JOB, `${folder}has space.wav`)).toBe(false);
    expect(isStemKeyFor(JOB, `${folder}has.dot.wav`)).toBe(false);
  });

  it('derives a stable id, a preview key and a remix key', () => {
    const k = stemUploadKey(JOB, '2_Drums.wav', 1696000000000, 'ab12cd34');
    expect(stemIdFromKey(k)).toBe('1696000000000_ab12cd34_2_Drums');
    expect(stemPreviewKey(k)).toBe(`audio/mastering/stems/${JOB}/preview/1696000000000_ab12cd34_2_Drums.m4a`);
    const r = stemRemixKey(JOB, 1696000000000);
    expect(r).toBe(`audio/mastering/stems/${JOB}/remix/1696000000000-remix.wav`);
  });

  it('never makes a remix key the master route would refuse as a mastering output', () => {
    const r = stemRemixKey(JOB, 1696000000000);
    expect(isMasterKey(r)).toBe(false);
    expect(isKaraokeMasterKey(r)).toBe(false);
    expect(isMasteringKey(r)).toBe(true);
  });
});

describe('stem names', () => {
  it.each([
    ['2_Drums.wav', 'Drums'],
    ['01 - Lead Vocals.WAV', 'Lead Vocals'],
    ['Bass.wav', 'Bass'],
    ['12_Synth_Pad.wav', 'Synth Pad'],
    ['.wav', 'Stem'],
  ])('%s → %s', (file, name) => {
    expect(guessStemName(file)).toBe(name);
  });
});

const stem = (id: string, over: Record<string, unknown> = {}) => ({
  key: `audio/mastering/stems/J/${id}.wav`, name: id, previewKey: 'p', previewError: null,
  previewRequestedAt: null, durationSec: 200, sampleRate: 48000, channels: 2, ...over,
});
const set = (stems: Record<string, ReturnType<typeof stem>>, mix: StemSet['mix'] = {}): StemSet => ({
  masterJobId: 'J', order: Object.keys(stems), stems, mix, remix: null, createdAt: 't', updatedAt: 't',
});

describe('planning a remix', () => {
  it('uses every unmuted stem at its saved level, 0 dB by default', () => {
    const p = planRemix(set({ a: stem('a'), b: stem('b') }, { b: { gainDb: -3, muted: false } }));
    expect(p.ok && p.inputs.map((i) => [i.stemId, i.gainDb])).toEqual([['a', 0], ['b', -3]]);
  });

  it('leaves muted stems, and stems at the floor, out entirely', () => {
    const p = planRemix(set({ a: stem('a'), b: stem('b'), c: stem('c') }, {
      b: { gainDb: 0, muted: true }, c: { gainDb: MIN_GAIN_DB, muted: false },
    }));
    expect(p.ok && p.inputs.map((i) => i.stemId)).toEqual(['a']);
  });

  it('refuses a mix with nothing audible in it', () => {
    const p = planRemix(set({ a: stem('a') }, { a: { gainDb: 0, muted: true } }));
    expect(p).toEqual({ ok: false, message: 'Every stem is muted — unmute at least one to render a remix.' });
  });

  it('notes resampling and padding, by stem name', () => {
    const p = planRemix(set({ Vox: stem('Vox'), Bass: stem('Bass', { sampleRate: 44100, durationSec: 199.7 }) }));
    expect(p.ok && p.notes).toEqual([
      'Bass resampled from 44.1 kHz to 48 kHz',
      'Bass padded by 0.3 s to match the longest stem',
    ]);
  });

  it('clamps a level outside the fader range', () => {
    const p = planRemix(set({ a: stem('a') }, { a: { gainDb: 40, muted: false } }));
    expect(p.ok && p.inputs[0].gainDb).toBe(MAX_GAIN_DB);
  });
});

describe('the remix encode', () => {
  const args = buildRemixArgs({
    inputs: [
      { path: '/t/0.wav', gainDb: 0, sampleRate: 48000 },
      { path: '/t/1.wav', gainDb: -3.5, sampleRate: 44100 },
    ],
    outPath: '/t/out.wav',
    durationSec: 200,
  });
  const fc = args[args.indexOf('-filter_complex') + 1];

  it('⚠️ never divides the stems down — normalize=0', () => {
    expect(fc).toContain('amix=inputs=2:normalize=0:duration=longest');
  });

  it('changes a level only when it is not 0 dB, and resamples only on a mismatch', () => {
    expect(fc).toContain('[0:a]apad[s0]');
    expect(fc).toContain('[1:a]aresample=48000,volume=-3.5dB,apad[s1]');
  });

  it('writes 32-bit float at 48 kHz, so a sum above full scale is kept, not clipped', () => {
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'pcm_f32le', '-ar', '48000']));
    expect(args).not.toContain('-shortest');
  });

  it('ends at the longest stem — apad would otherwise pad forever', () => {
    const a = buildRemixArgs({ inputs: [{ path: '/t/0.wav', gainDb: 0, sampleRate: 48000 }], outPath: '/o.wav', durationSec: 221.92 });
    expect(a[a.indexOf('-t') + 1]).toBe('221.92');
    expect(a.indexOf('-t')).toBeGreaterThan(a.indexOf('-map'));
  });

  it('with no duration given, omits apad and -t entirely — an unpadded amix already ends on its own', () => {
    const a = buildRemixArgs({
      inputs: [
        { path: '/t/0.wav', gainDb: 0, sampleRate: 48000 },
        { path: '/t/1.wav', gainDb: -3.5, sampleRate: 44100 },
      ],
      outPath: '/t/out.wav',
      durationSec: null,
    });
    const afc = a[a.indexOf('-filter_complex') + 1];
    expect(afc).not.toContain('apad');
    expect(afc).toContain('[0:a]anull[s0]');
    expect(a).not.toContain('-t');
  });
});
