import { parseSrt, selectWindowCues } from '@/lib/lyric-cues';

const SRT = `1
00:00:41,120 --> 00:00:44,430
அன்னையும் இல்ல...

2
00:00:44,480 --> 00:00:47,150
தந்தையும் இல்ல...

3
00:01:00,640 --> 00:01:03,950
அன்னம் ஊட்ட தாயில்ல...
`;

describe('parseSrt', () => {
  it('parses cues with comma ms separators', () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ start: 41.12, end: 44.43, text: 'அன்னையும் இல்ல...' });
    expect(cues[2].start).toBeCloseTo(60.64, 3);
  });

  it('tolerates CRLF and dot ms separators', () => {
    const cues = parseSrt('1\r\n00:00:01.500 --> 00:00:02.500\r\nhi\r\n');
    expect(cues).toEqual([{ start: 1.5, end: 2.5, text: 'hi' }]);
  });

  it('skips malformed / empty-text blocks', () => {
    expect(parseSrt('not a cue\n\n2\n00:00:01,000 --> 00:00:02,000\n')).toEqual([]);
  });

  it('keeps multi-line cue text', () => {
    const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nline a\nline b\n');
    expect(cues[0].text).toBe('line a\nline b');
  });
});

describe('selectWindowCues', () => {
  const cues = parseSrt(SRT);

  it('shifts overlapping cues to clip-relative time', () => {
    const w = selectWindowCues(cues, 41, 10);
    expect(w).toHaveLength(2);
    expect(w[0].start).toBeCloseTo(0.12, 3); // 41.12 - 41
    expect(w[0].end).toBeCloseTo(3.43, 3);
    expect(w[1].text).toBe('தந்தையும் இல்ல...');
  });

  it('clamps a cue straddling the window edges', () => {
    const w = selectWindowCues(cues, 42, 3); // window 42..45
    expect(w).toHaveLength(2);
    expect(w[0].start).toBe(0); // clamped from 41.12 up to window start
    expect(w[1].end).toBe(3); // clamped from 47.15 down to window end (45)
  });

  it('excludes cues fully outside the window', () => {
    const w = selectWindowCues(cues, 41, 5); // 41..46, cue 3 at 60s excluded
    expect(w.map((c) => c.text)).not.toContain('அன்னம் ஊட்ட தாயில்ல...');
  });

  it('drops cues left with less than minVisible on screen', () => {
    // window 44.3..54.3: cue1 (41.12-44.43) leaves only 0.13s -> dropped
    const w = selectWindowCues(cues, 44.3, 10, 0.3);
    expect(w.map((c) => c.text)).not.toContain('அன்னையும் இல்ல...');
    expect(w[0].text).toBe('தந்தையும் இல்ல...');
  });
});
