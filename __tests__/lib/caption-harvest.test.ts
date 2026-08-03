/** @jest-environment node */
/**
 * Recovering lyrics from uploaded caption tracks.
 *
 * The corpus these feed is the input to prosody analysis and anything built on
 * top of it, so the two rules that matter most are negative: never harvest a
 * machine transcription, and never accept a track that parsed badly. A wrong
 * line here is worse than a missing one, because it looks like Raj's writing.
 */

import {
  parseSrt,
  selectTrack,
  planHarvest,
  looksLikeLyrics,
  harvestFilename,
  COST_CAPTIONS_LIST,
  COST_CAPTIONS_DOWNLOAD,
  HARVEST_UNIT_CEILING,
  MIN_LYRIC_LINES,
  MIN_CHARS_PER_LINE,
} from '@/lib/caption-harvest';

const SRT = `1
00:00:12,500 --> 00:00:17,000
ஈழத்து மண்ணே...

2
00:00:17,000 --> 00:00:21,400
காலத்து பொன்னே...

3
00:00:21,400 --> 00:00:25,900
போய் வரவா...

4
00:00:25,900 --> 00:00:30,000
என்னிரு கண்ணே...
`;

describe('choosing a track', () => {
  /**
   * The load-bearing refusal. YouTube regenerates ASR tracks unprompted, and a
   * machine transcription of sung Tamil is noise shaped like lyrics — it would
   * enter the corpus looking entirely plausible.
   */
  it('never selects an ASR track, even as the only one present', () => {
    expect(selectTrack([{ id: 'a', trackKind: 'asr', language: 'ta' }])).toBeNull();
    expect(selectTrack([{ id: 'a', trackKind: 'asr', language: 'en' }])).toBeNull();
    expect(selectTrack([])).toBeNull();
  });

  it('prefers the Tamil human track when several exist', () => {
    const picked = selectTrack([
      { id: 'x', trackKind: 'asr', language: 'ta' },
      { id: 'y', trackKind: 'standard', language: 'en' },
      { id: 'z', trackKind: 'standard', language: 'ta', name: 'Lyrics' },
    ]);
    expect(picked?.id).toBe('z');
  });

  it('still takes a human English track — an English original is his writing too', () => {
    const picked = selectTrack([{ id: 'y', trackKind: 'standard', language: 'en' }]);
    expect(picked?.id).toBe('y');
  });
});

describe('parsing an authored SRT', () => {
  it('recovers every line with its timing, in order', () => {
    const h = parseSrt(SRT);
    expect(h.lineCount).toBe(4);
    expect(h.cues[0]).toEqual({ startMs: 12_500, endMs: 17_000, text: 'ஈழத்து மண்ணே...' });
    expect(h.text.split('\n')[3]).toBe('என்னிரு கண்ணே...');
    expect(h.lastCueEndMs).toBe(30_000);
  });

  /**
   * These files came from three upload paths over months, by hand. Tolerating
   * the variants is the difference between recovering a song and losing it.
   */
  it.each([
    ['CRLF line endings', SRT.replace(/\n/g, '\r\n')],
    ['a BOM', `﻿${SRT}`],
    ['dot milliseconds', SRT.replace(/,/g, '.')],
    ['no index lines', SRT.replace(/^\d+$/gm, '')],
    ['extra blank lines', SRT.replace(/\n\n/g, '\n\n\n')],
  ])('survives %s', (_label, variant) => {
    expect(parseSrt(variant).lineCount).toBe(4);
  });

  it('sorts cues by start time rather than trusting file order', () => {
    const scrambled = `1\n00:00:20,000 --> 00:00:24,000\nsecond\n\n2\n00:00:10,000 --> 00:00:14,000\nfirst\n`;
    expect(parseSrt(scrambled).cues.map((c) => c.text)).toEqual(['first', 'second']);
  });

  /**
   * A cue with an unreadable timestamp is DROPPED, never guessed. An invented
   * timing corrupts alignment silently; a missing line shows up in the count.
   */
  it('drops an unparseable cue instead of inventing a timing', () => {
    const broken = `1\nGARBAGE --> ALSO GARBAGE\nlost line\n\n2\n00:00:10,000 --> 00:00:14,000\nkept line\n`;
    const h = parseSrt(broken);
    expect(h.lineCount).toBe(1);
    expect(h.text).toBe('kept line');
  });

  it('keeps a multi-line cue together', () => {
    const two = `1\n00:00:10,000 --> 00:00:14,000\nline one\nline two\n`;
    expect(parseSrt(two).cues[0].text).toBe('line one\nline two');
  });

  it('returns empty rather than throwing on junk', () => {
    for (const junk of ['', 'not an srt at all', '\n\n\n']) {
      expect(parseSrt(junk)).toMatchObject({ lineCount: 0, text: '', lastCueEndMs: 0 });
    }
  });
});

describe('is it worth importing', () => {
  it('accepts a real song', () => {
    expect(looksLikeLyrics(parseSrt(SRT))).toBe(true);
  });

  it('rejects a stub that would enter the corpus as if it were a song', () => {
    const thin = `1\n00:00:10,000 --> 00:00:14,000\nஈழம்\n`;
    expect(parseSrt(thin).lineCount).toBeLessThan(MIN_LYRIC_LINES);
    expect(looksLikeLyrics(parseSrt(thin))).toBe(false);
  });

  it('judges density, not total length — a short Tamil verse is still a song', () => {
    // An earlier 80-char total floor rejected this real four-line verse.
    const h = parseSrt(SRT);
    expect(h.text.replace(/\s/g, '').length).toBeLessThan(80);
    expect(looksLikeLyrics(h)).toBe(true);
    expect(MIN_CHARS_PER_LINE).toBeLessThan(10);
  });

  it('rejects enough lines but almost no words', () => {
    const sparse = ['1', '2', '3', '4', '5']
      .map((n, i) => `${n}\n00:00:1${i},000 --> 00:00:1${i + 1},000\n♪`)
      .join('\n\n');
    expect(looksLikeLyrics(parseSrt(sparse))).toBe(false);
  });
});

describe('quota is checked before anything runs', () => {
  it('prices list and download at their real cost', () => {
    expect(COST_CAPTIONS_LIST).toBe(50);
    expect(COST_CAPTIONS_DOWNLOAD).toBe(200);
  });

  it('refuses a full-catalogue pass that would starve the daily crons', () => {
    const plan = planHarvest(57);
    expect(plan.maxUnits).toBeGreaterThan(HARVEST_UNIT_CEILING);
    expect(plan.affordable).toBe(false);
    expect(plan.reason).toMatch(/--limit/);
  });

  it('allows a batch that fits', () => {
    const plan = planHarvest(20);
    expect(plan.affordable).toBe(true);
    expect(plan.maxUnits).toBeLessThanOrEqual(HARVEST_UNIT_CEILING);
  });

  it('prices the worst case, not the hoped-for one', () => {
    // Every video listed AND downloaded — the plan must not assume only 25%
    // have a track just because a sample suggested it.
    const plan = planHarvest(10, 2);
    expect(plan.maxUnits).toBeGreaterThanOrEqual(10 * (COST_CAPTIONS_LIST + COST_CAPTIONS_DOWNLOAD));
  });
});

describe('output filenames', () => {
  it('keeps the Tamil hook and tags the video id', () => {
    expect(harvestFilename('KpWeuW_l9xc', 'ஈழத்து மண்ணே காலத்து பொன்னே | Eelathu Manne | Tamil Melody'))
      .toBe('ஈழத்து மண்ணே காலத்து பொன்னே [KpWeuW_l9xc]');
  });

  it('strips emoji and path characters that would break a write', () => {
    const name = harvestFilename('abc12345678', '❤️ ஒத்த பனங்கீத்தே / ஒன் நினைப்பு | Otha');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
    expect(name).toContain('[abc12345678]');
  });

  it('never produces an empty stem', () => {
    expect(harvestFilename('abc12345678', '❤️❤️')).toBe('untitled [abc12345678]');
  });
});
