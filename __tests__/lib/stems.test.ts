import {
  STEMS_PREFIX, isValidMasterJobId, stemFolderFor, stemUploadKey, stemIdFromKey,
  isStemKeyFor, stemPreviewKey, stemRemixKey, guessStemName,
} from '@/lib/stems';
import { isMasteringKey } from '@/lib/mastering-storage';
import { isMasterKey } from '@/lib/loudness-measure';
import { isKaraokeMasterKey } from '@/lib/master-peak';

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
