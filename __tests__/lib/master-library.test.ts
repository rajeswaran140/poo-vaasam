/** @jest-environment node */
/**
 * Grouping saved masters into songs.
 *
 * Every title below is REAL — taken from the live library on 2026-08-06, which
 * is the only way to test a heuristic over free text that Raj invents on the
 * spot. The bias is deliberate: under-grouping is a cosmetic miss, merging two
 * different songs would hide one behind the other.
 */
import { songKey, groupMastersBySong, describeGroup } from '@/lib/master-library';
import type { MasterJob } from '@/types/masterJob';

const m = (title: string | null, savedAt: string, over: Partial<MasterJob> = {}): MasterJob =>
  ({ id: `${title}-${savedAt}`, title, savedAt, publishedAt: null, archivedAt: null, ...over } as MasterJob);

describe('songKey — real titles from the live library', () => {
  it('collapses the four ஈழத்து மண்ணே takes onto one song', () => {
    const keys = [
      'ஈழத்து_மண்ணே_Tamilagaval',
      'ஈழத்து_மண்ணே_Tamilagaval-ver3.5',
      'ஈழத்து மண்ணே-Female_version',
      'ஈழத்து மண்ணே-Male-version',
    ].map(songKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('ஈழத்து மண்ணே');
  });

  it('collapses the அம்மா என் உயிர்த்துணையே takes, including the odd ones', () => {
    const keys = [
      'அம்மா_என்_உயிர்த்துணையே_Tamilagaval',
      'அம்மா என் உயிர்த்துணையே -zzV.5',
      'அம்மா என் உயிர்த்துணையே - CO-1.1',
      'அம்மா என் உயிர்த்துணையே - NewR-1.3',
    ].map(songKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('அம்மா என் உயிர்த்துணையே');
  });

  it('collapses the மெல்ல மெல்ல takes', () => {
    const keys = [
      'மெல்ல மெல்ல_Tamilagaval',
      'மெல்ல மெல்ல-New-z1.21',
      'மெல்ல மெல்ல-New-z1.23',
      'மெல்ல மெல்ல-New-z1.23-2nd_version',
    ].map(songKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('மெல்ல மெல்ல');
  });

  it('collapses ஒத்த பனங்கீத்தே and the வானவில்லே parts', () => {
    expect(new Set(['ஒத்த_பனங்கீத்தே', 'ஒத்த_பனங்கீத்தே-version-2'].map(songKey)).size).toBe(1);
    const v = ['வானவில்லே வானவில்லே -All-1.7', 'வானவில்லே வானவில்லே PartA-1.9',
      'வானவில்லே வானவில்லே PartB-1.9', 'வானவில்லே வானவில்லே-Ver-1.1'].map(songKey);
    expect(new Set(v).size).toBe(1);
    expect(v[0]).toBe('வானவில்லே வானவில்லே');
  });

  it('NEVER merges two different songs — the failure that would matter', () => {
    const distinct = ['ஈழத்து மண்ணே', 'அம்மா என் உயிர்த்துணையே', 'மெல்ல மெல்ல',
      'ஒத்த பனங்கீத்தே', 'வானவில்லே வானவில்லே', 'அந்தி மேகமே', 'செவ்வந்தி பூவே'];
    expect(new Set(distinct.map(songKey)).size).toBe(distinct.length);
  });

  it('leaves a title it does not understand completely alone', () => {
    // Under-grouping is the safe direction: the row simply stands on its own.
    expect(songKey('காதோட ஆடும் லோலாக்கு')).toBe('காதோட ஆடும் லோலாக்கு');
    expect(songKey('  spaced  out  ')).toBe('spaced out');
  });

  it('never returns empty for a non-empty title', () => {
    // A title that is ENTIRELY a marker must not collapse to "", which would
    // group it with every other such title.
    for (const t of ['ver-1.2', 'Part A', 'Tamilagaval', '- v2']) {
      expect(songKey(t).length).toBeGreaterThan(0);
    }
  });
});

describe('groupMastersBySong', () => {
  const lib = [
    m('ஈழத்து_மண்ணே_Tamilagaval', '2026-07-30T16:23:17Z'),
    m('ஈழத்து மண்ணே-Male-version', '2026-07-30T22:03:00Z'),
    m('வானவில்லே வானவில்லே-Ver-1.1', '2026-08-05T00:36:29Z'),
    m('மெல்ல மெல்ல_Tamilagaval', '2026-08-03T03:07:07Z'),
  ];

  it('orders groups by their newest take, and takes newest-first inside', () => {
    const g = groupMastersBySong(lib);
    expect(g.map((x) => x.song)).toEqual(['வானவில்லே வானவில்லே', 'மெல்ல மெல்ல', 'ஈழத்து மண்ணே']);
    expect(g[2].masters.map((x) => x.title)).toEqual([
      'ஈழத்து மண்ணே-Male-version', 'ஈழத்து_மண்ணே_Tamilagaval',
    ]);
  });

  it('gives every UNTITLED master its own group', () => {
    // Bundling them would imply they are takes of one song, which is a claim
    // there is no evidence for.
    const g = groupMastersBySong([m(null, '2026-08-01T00:00:00Z'), m(null, '2026-08-02T00:00:00Z')]);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.song === '')).toBe(true);
  });

  it('loses nothing — every master appears exactly once', () => {
    const g = groupMastersBySong(lib);
    expect(g.flatMap((x) => x.masters)).toHaveLength(lib.length);
  });

  it('handles an empty library', () => {
    expect(groupMastersBySong([])).toEqual([]);
  });
});

describe('describeGroup', () => {
  it('counts takes, and what has actually shipped', () => {
    const g = groupMastersBySong([
      m('X', '2026-08-01T00:00:00Z', { archivedAt: 'x' }),
      m('X', '2026-08-02T00:00:00Z', { archivedAt: 'x', publishedAt: 'y' }),
    ]);
    expect(describeGroup(g[0])).toBe('2 takes · 2 archived · 1 on site');
    expect(describeGroup(groupMastersBySong([m('Y', '2026-08-01T00:00:00Z')])[0])).toBe('1 take');
  });
});
