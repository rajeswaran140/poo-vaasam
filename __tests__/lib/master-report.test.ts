/** @jest-environment node */
/**
 * buildMasterReport — the saved text summary that travels with the WAV. Pure and
 * deterministic (timestamp comes from the job, not Date), so it is fully pinned.
 */

import { buildMasterReport, reportFilename, platformsForTarget } from '@/lib/master-report';
import type { MasterJob } from '@/types/masterJob';

const baseJob: MasterJob = {
  id: 'j1',
  status: 'done',
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:05:00.000Z',
  s3Key: 'audio/mastering/1_ab_take.wav',
  target: -14,
  masterKey: 'audio/mastering/1_ab_take-master-14LUFS.wav',
  beforeLufs: -17.9,
  beforeTp: -0.3,
  afterLufs: -14.0,
  afterTp: -3.68,
  error: null,
};

describe('platformsForTarget', () => {
  it('names the platforms that normalise at a target', () => {
    expect(platformsForTarget(-14)).toContain('Spotify');
    expect(platformsForTarget(-14)).toContain('YouTube');
    expect(platformsForTarget(-16)).toBe('Apple Music');
    expect(platformsForTarget(-11)).toBe('custom target');
  });
});

describe('buildMasterReport', () => {
  it('records the loudness numbers, the target and the no-tone-change note', () => {
    const r = buildMasterReport(baseJob, 'Amma En Agame');
    expect(r).toContain('Title:              Amma En Agame');
    expect(r).toContain('-14 LUFS');
    expect(r).toContain('Spotify');
    expect(r).toContain('-17.9 LUFS'); // before
    expect(r).toContain('-14.0 LUFS'); // after
    expect(r).toContain('-3.68 dBTP'); // after true peak
    expect(r).toContain('2026-07-24T00:05:00.000Z');
    expect(r).toMatch(/on target/i);
    expect(r).toMatch(/Loudness normalisation only/i);
    expect(r).toMatch(/Unchanged/i);
  });

  it('omits the title line when no name is given', () => {
    expect(buildMasterReport(baseJob)).not.toMatch(/^Title:/m);
  });

  it('flags an off-target or unmeasured result honestly', () => {
    expect(buildMasterReport({ ...baseJob, afterLufs: -11 })).toMatch(/off target/i);
    expect(buildMasterReport({ ...baseJob, afterLufs: null })).toMatch(/did not return/i);
  });

  it('flags a true peak above the -1 dBTP ceiling', () => {
    expect(buildMasterReport({ ...baseJob, afterTp: -0.2 })).toMatch(/above -1 dBTP/i);
  });
});

describe('reportFilename', () => {
  it('derives from the title and ends in a report .txt', () => {
    expect(reportFilename('Amma En Agame')).toBe('Amma En Agame — master report.txt');
  });
  it('falls back to "master" with no title', () => {
    expect(reportFilename()).toBe('master — master report.txt');
    expect(reportFilename('   ')).toBe('master — master report.txt');
  });
});
