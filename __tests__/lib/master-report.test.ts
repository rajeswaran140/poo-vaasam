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
  dynamicsLine,
  dynamicsPreserved,
  streamingReadiness,
  dynamicsState,
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
  beforeLra: 6.8,
  afterLra: 6.8,
  normalizationType: 'linear',
  beforeLufs: -17.9,
  beforeTp: -0.3,
  afterLufs: -14.0,
  afterTp: -3.68,
  source: {
    codec: 'pcm_s24le',
    sampleRate: 48000,
    channels: 2,
    channelLayout: 'stereo',
    bitDepth: 24,
    durationSec: 222.1,
  },
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
    // Now EARNED, not asserted: baseJob's LRA is unchanged and ffmpeg reported
    // a linear gain, so the preservation claim is backed by measurement.
    expect(s).toMatch(/✓ Loudness only — dynamics preserved/);
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

describe('the report never claims a check it did not run', () => {
  it('does not call an unmeasured true peak "peak-safe"', () => {
    // Regression: the Result line read "on target (-14 LUFS), peak-safe." when
    // afterTp was null — asserting a safety check that never ran, in the very
    // file the Summary block above says "True peak not reported". This report is
    // the evidence that travels to a distributor; it must not overstate.
    const r = buildMasterReport({ ...baseJob, afterTp: null });
    expect(r).toMatch(/true peak not reported/i);
    expect(r).not.toMatch(/peak-safe/);
    expect(r).not.toMatch(/No clipping detected/);
    // …and it still reports the loudness it DID measure.
    expect(r).toMatch(/on target \(-14 LUFS\)/);
  });

  it('still says peak-safe when the peak was actually measured and is safe', () => {
    expect(buildMasterReport(baseJob)).toMatch(/peak-safe/);
  });
});

describe('source file info', () => {
  it('records what came in and what went out', () => {
    const r = buildMasterReport(baseJob);
    expect(r).toMatch(/Source file: +24-bit · 48 kHz · stereo · 3:42/);
    expect(r).toMatch(/Output file: +24-bit · 48 kHz WAV/);
  });

  it('omits the source line entirely for a job recorded before it was captured', () => {
    // Jobs written by the pre-change worker have source: null — the report must
    // simply not mention it rather than print an empty or "—" row.
    const r = buildMasterReport({ ...baseJob, source: null });
    expect(r).not.toMatch(/Source file:/);
    expect(r).toMatch(/Output file:/); // ours is always known
  });

  it('prints only the fields the header actually yielded', () => {
    const r = buildMasterReport({
      ...baseJob,
      source: { codec: null, sampleRate: 44100, channels: null, channelLayout: null, bitDepth: null, durationSec: null },
    });
    // 44100 keeps its decimal (44.1 kHz); a round 48000 does not (48 kHz).
    expect(r).toMatch(/Source file: +44\.1 kHz$/m);
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

describe('dynamics / loudness range — proving "loudness only, never tone"', () => {
  const withLra = (over: Partial<MasterJob>): MasterJob => ({ ...baseJob, beforeLra: 6.8, afterLra: 6.8, normalizationType: 'linear', ...over });

  it('reports dynamics preserved when LRA survives a linear gain', () => {
    const job = withLra({});
    expect(dynamicsPreserved(job)).toBe(true);
    expect(dynamicsLine(job)).toMatch(/dynamics preserved/i);
    expect(dynamicsLine(job)).toContain('6.8 → 6.8 LU');
  });

  it('tolerates measurement rounding but not real movement', () => {
    expect(dynamicsPreserved(withLra({ afterLra: 6.5 }))).toBe(true);   // 0.3 LU — rounding
    expect(dynamicsPreserved(withLra({ afterLra: 5.0 }))).toBe(false);  // 1.8 LU — compression
    expect(dynamicsLine(withLra({ afterLra: 5.0 }))).toMatch(/moved 1\.8 LU/);
  });

  /**
   * The case the whole feature exists for. ffmpeg accepts `linear=true` and then
   * silently normalizes DYNAMICALLY when a linear gain would clip — no error,
   * no non-zero exit. Before this, the report cheerfully printed "tone, EQ and
   * compression unchanged" for such a master.
   */
  it('REFUSES the preservation claim when ffmpeg fell back to dynamic mode', () => {
    const job = withLra({ normalizationType: 'dynamic' });
    expect(dynamicsPreserved(job)).toBe(false);
    const line = dynamicsLine(job);
    expect(line).toMatch(/dynamic normalization/i);
    expect(line).toMatch(/not preserved/i);
    expect(line).not.toMatch(/✓/);
  });

  it('never claims preservation for a dynamic master even if LRA happens to match', () => {
    // Identical LRA readings must NOT override what ffmpeg reported doing.
    expect(dynamicsPreserved(withLra({ normalizationType: 'dynamic', afterLra: 6.8 }))).toBe(false);
  });

  it('says "not recorded" for jobs mastered before LRA capture, rather than claiming the check ran', () => {
    const legacy = { ...baseJob, beforeLra: null, afterLra: null, normalizationType: null } as MasterJob;
    expect(dynamicsPreserved(legacy)).toBe(false);
    expect(dynamicsLine(legacy)).toMatch(/not recorded/i);
    expect(dynamicsLine(legacy)).not.toMatch(/✓/);
  });

  it('prints both LRA rows and the processing block honestly', () => {
    const ok = buildMasterReport(withLra({}));
    expect(ok).toMatch(/Loudness range \(LRA\)/);
    expect(ok).toMatch(/← unchanged/);
    expect(ok).toMatch(/No compression/);

    const fell = buildMasterReport(withLra({ normalizationType: 'dynamic', afterLra: 4.1 }));
    expect(fell).toMatch(/DYNAMIC fallback/);
    expect(fell).toMatch(/← CHANGED/);
    expect(fell).not.toMatch(/· No compression/);
  });
});

describe('streamingReadiness — the Studio banner and the .txt report share one rule', () => {
  const job = (over: Partial<MasterJob>): MasterJob => ({ ...baseJob, ...over });

  it('says Streaming Ready only when on-target AND peak-safe AND dynamics preserved', () => {
    const r = streamingReadiness(job({}));
    expect(r.ok).toBe(true);
    expect(r.headline).toBe('Streaming Ready');
    expect(r.facts).toContain('-14.0 LUFS');
    expect(r.facts).toContain('LRA 6.8 unchanged');
    expect(r.facts).toContain('24-bit/48 kHz');
  });

  /**
   * The exact bug this replaced: the Studio's old `verdict` compared loudness to
   * target only, so a master that hit -14 LUFS while clipping ABOVE -1 dBTP
   * still showed a green tick — while the .txt report it downloaded said
   * "check for clipping". Screen and file disagreed.
   */
  it('REFUSES ready for a master that is on target but clipping', () => {
    const r = streamingReadiness(job({ afterTp: -0.4 }));
    expect(r.ok).toBe(false);
    expect(r.headline).toMatch(/exceeds -1 dBTP/);
  });

  it('refuses ready for an off-target master', () => {
    const r = streamingReadiness(job({ afterLufs: -11 }));
    expect(r.ok).toBe(false);
    expect(r.headline).toMatch(/measured .* against -14 LUFS/);
  });

  it('treats an unmeasured master as its own state, not a pass', () => {
    const r = streamingReadiness(job({ afterLufs: null }));
    expect(r.ok).toBe(false);
    expect(r.headline).toMatch(/not confirmed/);
  });

  it('omits the "unchanged" marker when dynamics were not preserved', () => {
    const r = streamingReadiness(job({ normalizationType: 'dynamic' }));
    expect(r.facts).toContain('LRA 6.8');
    expect(r.facts).not.toContain('unchanged');
  });
});

describe('readiness checks — the itemised integrity list', () => {
  const job = (over: Partial<MasterJob>): MasterJob => ({ ...baseJob, ...over });
  const byLabel = (j: MasterJob, l: string) => streamingReadiness(j).checks.find((c) => c.label === l)!;

  /**
   * FOUR checks, not five. "Clipping" is NOT an independent test — the true-peak
   * ceiling IS the clipping check. Listing both would imply a second
   * measurement that was never taken.
   */
  it('lists exactly four checks and does not invent a separate clipping test', () => {
    const cs = streamingReadiness(job({})).checks;
    expect(cs.map((c) => c.label)).toEqual(['Loudness target', 'True peak', 'Dynamics', 'Gain type']);
  });

  it('surfaces gain type, which is otherwise recorded but invisible', () => {
    expect(byLabel(job({ normalizationType: 'linear' }), 'Gain type')).toMatchObject({ ok: true });
    expect(byLabel(job({ normalizationType: 'linear' }), 'Gain type').detail).toMatch(/linear/);
  });

  it('marks a dynamic fallback as FAILED, not merely noted', () => {
    const c = byLabel(job({ normalizationType: 'dynamic' }), 'Gain type');
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/compressed/);
  });

  /** Unknown must be its own state — never rendered as a pass. */
  it('uses null (not false) when a value was never recorded', () => {
    expect(byLabel(job({ normalizationType: null }), 'Gain type').ok).toBeNull();
    expect(byLabel(job({ beforeLra: null, afterLra: null }), 'Dynamics').ok).toBeNull();
    expect(byLabel(job({ afterTp: null }), 'True peak').ok).toBeNull();
    expect(byLabel(job({ afterLufs: null }), 'Loudness target').ok).toBeNull();
  });

  it('the saved report names the gain type too, so file and screen agree', () => {
    expect(buildMasterReport(job({ normalizationType: 'linear' }))).toMatch(/Gain type — linear/);
    expect(buildMasterReport(job({ normalizationType: 'dynamic' }))).toMatch(/Gain type — DYNAMIC/);
  });
});

/**
 * The composed verdict, not its ingredients.
 *
 * `dynamicsPreserved` and `dynamicsLine` were already covered exhaustively
 * above — tolerance boundaries, the dynamic-mode refusal, even a coincidental
 * LRA match. What nothing asserted was whether the VERDICT that consumes them
 * actually used them, and it did not: `streamingReadiness` computed the
 * dynamics result, let it reach only the facts string, and returned ok:true for
 * a master ffmpeg had compressed. The Studio then drew a green "Streaming
 * Ready" above its own red ✗ Dynamics row, and the saved .txt carried "range
 * WAS compressed" and "Ready for distribution" in the same file.
 *
 * That is the same shape as the PR #79 escape: units green, composition untested.
 * These tests pin the composition.
 */
describe('readiness is the conjunction it claims to be', () => {
  const dyn = (over: Partial<MasterJob> = {}): MasterJob => ({ ...baseJob, ...over });

  it('refuses a master ffmpeg silently compressed, even on target and peak-safe', () => {
    const job = dyn({ normalizationType: 'dynamic', beforeLra: 6.8, afterLra: 4.1 });
    // The two legs that used to be the whole test still pass...
    expect(streamingReadiness(job).checks.find((c) => c.label === 'Loudness target')?.ok).toBe(true);
    expect(streamingReadiness(job).checks.find((c) => c.label === 'True peak')?.ok).toBe(true);
    // ...and the verdict must still refuse.
    expect(streamingReadiness(job).ok).toBe(false);
    expect(streamingReadiness(job).headline).toMatch(/compressed the range/i);
  });

  it('never shows a green headline above a failing check row', () => {
    for (const job of [
      dyn({ normalizationType: 'dynamic' }),
      dyn({ afterLra: 4.1 }),
      dyn({ afterTp: -0.2 }),
      dyn({ afterLufs: -11 }),
      dyn({ beforeLra: null, afterLra: null, normalizationType: null }),
      dyn({ mp3Key: 'audio/mastering/1_ab_take-master-14LUFS.mp3', mp3Tp: -0.4 }),
    ]) {
      const r = streamingReadiness(job);
      const failing = r.checks.filter((c) => c.ok === false);
      if (failing.length) expect(r.ok).toBe(false);
      if (r.ok) expect(failing).toHaveLength(0);
    }
  });

  it('refuses a linear master whose range drifted more than rounding', () => {
    const r = streamingReadiness(dyn({ afterLra: 4.1 }));
    expect(r.ok).toBe(false);
    expect(r.headline).toMatch(/loudness range moved 2\.7 LU/i);
  });

  it('blocks an unrecorded job without implying it is damaged', () => {
    const r = streamingReadiness(dyn({ beforeLra: null, afterLra: null, normalizationType: null }));
    expect(r.ok).toBe(false);
    expect(r.headline).toMatch(/not recorded/i);
    expect(r.headline).not.toMatch(/compressed|moved/i);
  });

  it('still passes a genuinely clean master', () => {
    const r = streamingReadiness(baseJob);
    expect(r.ok).toBe(true);
    expect(r.headline).toBe('Streaming Ready');
    expect(r.facts).toMatch(/LRA 6\.8 unchanged/);
  });

  it('drops "unchanged" from the facts line when dynamics did not survive', () => {
    expect(streamingReadiness(dyn({ afterLra: 4.1 })).facts).not.toMatch(/unchanged/);
  });
});

describe('the screen and the saved file agree', () => {
  const compressed: MasterJob = { ...baseJob, normalizationType: 'dynamic', beforeLra: 6.8, afterLra: 4.1 };

  it('does not print "Ready for streaming" in a report that also says the range was compressed', () => {
    const lines = summaryLines(compressed);
    expect(lines.some((l) => /Dynamic normalization/i.test(l))).toBe(true);
    expect(lines.some((l) => /✓ Ready for streaming/.test(l))).toBe(false);
    expect(lines.some((l) => /⚠ Review the flags above/.test(l))).toBe(true);
  });

  it('keeps the report and the Studio verdict in lockstep across every case', () => {
    for (const job of [
      baseJob,
      { ...baseJob, normalizationType: 'dynamic' as const },
      { ...baseJob, afterLra: 4.1 },
      { ...baseJob, afterTp: -0.2 },
      { ...baseJob, afterLufs: -11 },
      { ...baseJob, beforeLra: null, afterLra: null, normalizationType: null },
    ]) {
      const screenSaysReady = streamingReadiness(job).ok;
      const fileSaysReady = summaryLines(job).some((l) => /✓ Ready for streaming/.test(l));
      expect(fileSaysReady).toBe(screenSaysReady);
    }
  });

  it('a compressed master reaches the rendered report as a review, not a pass', () => {
    const text = buildMasterReport(compressed);
    expect(text).toMatch(/⚠ Review the flags above before distributing/);
    expect(text).not.toMatch(/✓ Ready for streaming/);
    expect(text).toMatch(/DYNAMIC fallback — range was compressed/);
  });
});

describe('an unmeasured true peak is not an exceeded one', () => {
  const noPeak: MasterJob = { ...baseJob, afterTp: null };

  it('says the peak was not measured rather than printing an em dash as a reading', () => {
    const r = streamingReadiness(noPeak);
    expect(r.ok).toBe(false);
    expect(r.headline).toMatch(/true peak was not measured/i);
    expect(r.headline).not.toMatch(/true peak — exceeds/);
  });

  it('matches the wording the .txt report already used for the same job', () => {
    expect(buildMasterReport(noPeak)).toMatch(/true peak not reported — verify before use/i);
    expect(streamingReadiness(noPeak).checks.find((c) => c.label === 'True peak')?.ok).toBeNull();
  });

  it('still reports an ACTUAL exceedance with its measured value', () => {
    expect(streamingReadiness({ ...baseJob, afterTp: -0.2 }).headline).toMatch(/-0\.20 dBTP exceeds -1 dBTP/);
  });
});

describe('dynamicsState names the reason, not just the verdict', () => {
  it('separates compressed, drifted, unrecorded and preserved', () => {
    expect(dynamicsState(baseJob)).toBe('preserved');
    expect(dynamicsState({ ...baseJob, normalizationType: 'dynamic' })).toBe('compressed');
    expect(dynamicsState({ ...baseJob, afterLra: 4.1 })).toBe('drifted');
    expect(dynamicsState({ ...baseJob, beforeLra: null, afterLra: null, normalizationType: null })).toBe('unrecorded');
  });

  it('reports compressed even when LRA was never captured', () => {
    expect(dynamicsState({ ...baseJob, beforeLra: null, afterLra: null, normalizationType: 'dynamic' })).toBe('compressed');
  });

  it('agrees with dynamicsPreserved on every state', () => {
    for (const job of [
      baseJob,
      { ...baseJob, normalizationType: 'dynamic' as const },
      { ...baseJob, afterLra: 4.1 },
      { ...baseJob, beforeLra: null, afterLra: null, normalizationType: null },
    ]) {
      expect(dynamicsPreserved(job)).toBe(dynamicsState(job) === 'preserved');
    }
  });
});

/**
 * The web MP3 in the verdict.
 *
 * The MP3 is the copy listeners receive, and it is measured separately from the
 * WAV. That makes a NEW way for the module's oldest defect to come back: a
 * green "Streaming Ready" headline printed over a file the same job had just
 * measured as clipping. The verdict and the .txt both consume the MP3 through
 * one function so they cannot disagree — these pin the composition, which is
 * where every mastering defect so far has actually lived.
 */
describe('the web MP3 leg of the verdict', () => {
  const MP3_KEY = 'audio/mastering/1_ab_take-master-14LUFS.mp3';
  const withMp3 = (over: Partial<MasterJob> = {}): MasterJob => ({
    ...baseJob,
    mp3Key: MP3_KEY,
    mp3Lufs: -14.0,
    mp3Tp: -3.55,
    ...over,
  });

  it('adds a fifth check ONLY when a second file was actually produced', () => {
    expect(streamingReadiness(baseJob).checks.map((c) => c.label)).toEqual([
      'Loudness target', 'True peak', 'Dynamics', 'Gain type',
    ]);
    expect(streamingReadiness(withMp3()).checks.map((c) => c.label)).toEqual([
      'Loudness target', 'True peak', 'Dynamics', 'Gain type', 'Web MP3',
    ]);
  });

  it('passes a compliant MP3 and still reads Streaming Ready', () => {
    const r = streamingReadiness(withMp3());
    expect(r.ok).toBe(true);
    expect(r.headline).toBe('Streaming Ready');
    expect(r.checks.find((c) => c.label === 'Web MP3')?.ok).toBe(true);
  });

  it('REFUSES a clean master whose delivered MP3 clips', () => {
    // The master is on target, peak-safe and dynamics-preserved — every leg the
    // verdict used to consider. Only the file that ships is hot.
    const r = streamingReadiness(withMp3({ mp3Tp: -0.4 }));
    expect(r.ok).toBe(false);
    expect(r.headline).toMatch(/web MP3 peaks at -0\.40 dBTP/);
    expect(r.checks.find((c) => c.label === 'Web MP3')?.ok).toBe(false);
  });

  it('does not block on an MP3 that exists but could not be measured', () => {
    // Deliberately unlike the dynamics leg, where `unrecorded` blocks. There the
    // missing value is a claim about the WAV itself; here it is a sibling file,
    // and the master heading to the distributor is unaffected.
    const r = streamingReadiness(withMp3({ mp3Tp: null, mp3Lufs: null }));
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.label === 'Web MP3')?.ok).toBeNull();
    expect(r.checks.find((c) => c.label === 'Web MP3')?.detail).toMatch(/not measured/);
  });

  it('never lets the saved report contradict the screen', () => {
    const hot = withMp3({ mp3Tp: -0.4 });
    const report = buildMasterReport(hot);
    expect(streamingReadiness(hot).ok).toBe(false);
    expect(report).toMatch(/⚠ Review the flags above before distributing/);
    expect(report).not.toMatch(/✓ Ready for streaming/);
    // and it says WHERE the fault lies, because re-encoding would not fix it
    expect(report).toMatch(/Re-master this take|check the file/);
  });

  it('names the delivered MP3 and its own peak in the report', () => {
    const report = buildMasterReport(withMp3());
    expect(report).toMatch(/Web delivery:\s+192k MP3 · true peak -3\.55 dBTP/);
    expect(report).toMatch(/✓ Web MP3 \(192k\)/);
  });

  it('says nothing at all about an MP3 when none was produced', () => {
    // A report for a legacy job must not mention a file that never existed.
    const report = buildMasterReport(baseJob);
    expect(report).not.toMatch(/MP3/);
    expect(summaryLines(baseJob)).toHaveLength(5);
    expect(summaryLines(withMp3())).toHaveLength(6);
  });
});
