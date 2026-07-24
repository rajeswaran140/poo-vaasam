/** @jest-environment node */
/**
 * buildMasterReport — the saved text summary that travels with the WAV. Pure and
 * deterministic (timestamp comes from the job, not Date), so it is fully pinned.
 */

import {
  buildMasterReport,
  reportFilename,
  platformsForTarget,
  summaryLines,
  turnaroundLabel,
  platformLandingLines,
} from '@/lib/master-report';
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

describe('summaryLines', () => {
  it('passes a clean master on every check', () => {
    const s = summaryLines(baseJob).join('\n');
    expect(s).toMatch(/✓ Streaming ready/);
    expect(s).toMatch(/✓ Peak-safe/);
    expect(s).toMatch(/✓ Loudness only/);
    expect(s).toMatch(/✓ Ready for streaming, video editing and distribution/);
  });

  it('warns — never "ready" — when off target', () => {
    const s = summaryLines({ ...baseJob, afterLufs: -11 }).join('\n');
    expect(s).toMatch(/⚠ Off target/);
    expect(s).not.toMatch(/✓ Ready for streaming/);
  });

  it('flags clipping and withholds the ready tick', () => {
    const s = summaryLines({ ...baseJob, afterTp: -0.2 }).join('\n');
    expect(s).toMatch(/✗ True peak .* exceeds -1 dBTP/);
    expect(s).not.toMatch(/✓ Ready for streaming/);
  });

  it('handles an unmeasured master without claiming success', () => {
    const s = summaryLines({ ...baseJob, afterLufs: null, afterTp: null }).join('\n');
    expect(s).toMatch(/⚠ Loudness not confirmed/);
    expect(s).toMatch(/True peak not reported/);
  });
});

describe('turnaroundLabel', () => {
  it('formats short and long waits', () => {
    expect(turnaroundLabel('2026-07-24T00:00:00Z', '2026-07-24T00:00:41Z')).toBe('41s');
    expect(turnaroundLabel('2026-07-24T00:00:00Z', '2026-07-24T00:02:05Z')).toBe('2m 5s');
  });
  it('omits an implausible or unparseable span rather than mislead', () => {
    expect(turnaroundLabel('2026-07-24T00:05:00Z', '2026-07-24T00:00:00Z')).toBeNull(); // negative
    expect(turnaroundLabel('2026-07-24T00:00:00Z', '2026-07-24T02:00:00Z')).toBeNull(); // > 1h
    expect(turnaroundLabel('nope', '2026-07-24T00:00:00Z')).toBeNull();
  });
});

describe('platformLandingLines', () => {
  it('shows how a −14 master lands, with glance marks and reassuring copy', () => {
    const s = platformLandingLines(baseJob).join('\n');
    expect(s).toMatch(/Streaming readiness/);
    expect(s).toMatch(/✓.*Spotify/);
    expect(s).toMatch(/plays exactly as mastered/);
    expect(s).toMatch(/↓.*Apple Music.*playback normalised ~2\.0 LU · original audio unchanged/);
  });
  it('is omitted entirely when the output was not measured', () => {
    expect(platformLandingLines({ ...baseJob, afterLufs: null })).toEqual([]);
  });
});

describe('buildMasterReport', () => {
  it('records the summary, loudness numbers, job id, target, per-platform landing and the no-tone-change note', () => {
    const r = buildMasterReport(baseJob, 'Amma En Agame');
    expect(r).toMatch(/Summary/);
    expect(r).toMatch(/✓ Streaming ready/);
    expect(r).toContain('Title:              Amma En Agame');
    expect(r).toContain('Job ID:             j1');
    expect(r).toMatch(/Streaming readiness/);
    expect(r).toMatch(/Apple Music.*playback normalised/);
    expect(r).toContain('-14 LUFS');
    expect(r).toContain('Spotify');
    expect(r).toContain('-17.9 LUFS'); // before
    expect(r).toContain('-14.0 LUFS'); // after
    expect(r).toContain('-3.68 dBTP'); // after true peak
    expect(r).toContain('2026-07-24T00:05:00.000Z');
    expect(r).toContain('turnaround 5m 0s'); // createdAt→updatedAt
    expect(r).toMatch(/on target/i);
    expect(r).toMatch(/loudness only/i);
    expect(r).toMatch(/No EQ .* No compression .* No stereo widening .* No limiting/);
  });

  it('reassures a non-engineer: no clipping + expanded hand-off', () => {
    const r = buildMasterReport(baseJob);
    expect(r).toMatch(/No clipping detected/);
    expect(r).toMatch(/Adobe hand-off/);
    expect(r).toMatch(/Disable Essential Sound "Auto-Match"/);
    expect(r).toMatch(/Export PCM or high-bitrate AAC/);
  });

  it('omits the "no clipping" reassurance when the peak is unsafe', () => {
    expect(buildMasterReport({ ...baseJob, afterTp: -0.2 })).not.toMatch(/No clipping detected/);
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
