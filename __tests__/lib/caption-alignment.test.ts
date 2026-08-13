/** @jest-environment node */
/**
 * The alignment engine is the part that can silently ruin a song's captions, so
 * these tests pin the failure modes that have actually happened on the channel:
 *   - placeholder timings shipped verbatim (the whole reason this exists)
 *   - repeated refrains resolving to the wrong occurrence, which made captions
 *     drift progressively later through the back half of a song
 *   - machine words leaking into what is published as Raj's lyric
 */
import {
  alignLyrics,
  similarity,
  isMusicMarker,
  normaliseForMatch,
  verifyRoundTrip,
  toSrt,
  parseSrtCues,
  splitLyricsIntoCards,
  type AsrCue,
  type LyricCard,
} from '@/lib/caption-alignment';

const cue = (startMs: number, endMs: number, text: string): AsrCue => ({ startMs, endMs, text });

describe('isMusicMarker', () => {
  it.each([
    ['[இசை]', true],
    ['[Music]', true],
    ['♪', true],
    ['♪♪♪', true],
    ['   ', true],
    ['---', true],
    ['நெஞ்சக் கூட்டினிலே', false],
    ['[இசை] நெஞ்சக்', false], // has lyric content alongside the marker
  ])('%s -> %s', (text, expected) => {
    expect(isMusicMarker(text)).toBe(expected);
  });
});

describe('normaliseForMatch', () => {
  it('strips the ellipses Raj uses for held notes, keeping the Tamil', () => {
    expect(normaliseForMatch('கொஞ்சம்...  கொஞ்சமாக....')).toBe('கொஞ்சம் கொஞ்சமாக');
  });
  it('leaves Tamil script itself untouched', () => {
    expect(normaliseForMatch('நெஞ்சக் கூட்டினிலே')).toBe('நெஞ்சக் கூட்டினிலே');
  });

  // Observed on the live ta/asr track for 2vgRrCgyOaY: YouTube appends the
  // annotation INSIDE the lyric cue rather than emitting a separate one.
  it('drops inline [பாடுதல்]/[இசை] annotations whole, not just their brackets', () => {
    expect(normaliseForMatch('நெஞ்ச கூட்டினிலே [பாடுதல்]')).toBe('நெஞ்ச கூட்டினிலே');
    expect(normaliseForMatch('நேச பறவை ஒன்று [இசை]')).toBe('நேச பறவை ஒன்று');
  });
});

describe('similarity', () => {
  it('is 1 for identical lines and 0 against empty', () => {
    expect(similarity('நேசப் பறவை ஒன்று', 'நேசப் பறவை ஒன்று')).toBe(1);
    expect(similarity('நேசப் பறவை ஒன்று', '')).toBe(0);
  });

  it('survives a single misheard word — the ASR mishears வாசம் as பாசம்', () => {
    expect(similarity('வாசம் பூத்து வரலயே', 'பாசம் பூத்து வரலயே')).toBeGreaterThan(0.45);
  });

  it('scores a caught fragment above the floor', () => {
    expect(similarity('மரக் கிளையில கூடு', 'கிளையில கூடு')).toBeGreaterThan(0.45);
  });

  it('scores unrelated lines below the floor', () => {
    expect(similarity('நெஞ்சக் கூட்டினிலே', 'மேகம் மோதி கரையுதே')).toBeLessThan(0.45);
  });
});

describe('alignLyrics — the repeated-refrain case that broke the greedy version', () => {
  // The refrain appears three times, far apart. A greedy forward-window matcher
  // resolved all three to the first occurrence and interpolated the rest, which
  // stretched the back half of the song.
  const REFRAIN = ['மரக் கிளையில கூடு', 'அது பறவைக் கூடு'];
  const cards: LyricCard[] = [
    ['நெஞ்சக் கூட்டினிலே', 'நேசப் பறவை ஒன்று'],
    REFRAIN,
    ['காலை வந்து ஓயுதே', 'விடியல் வரலயே'],
    REFRAIN,
    ['காத்து வந்து பேசுதே', 'உந்தன் முகம் தேடுதே'],
    REFRAIN,
  ];
  const asr: AsrCue[] = [
    cue(20_000, 24_000, 'நெஞ்சக் கூட்டினிலே'),
    cue(24_000, 28_000, 'நேசப் பறவை ஒன்று'),
    cue(40_000, 44_000, 'மரக் கிளையில கூடு'),
    cue(44_000, 48_000, 'அது பறவைக் கூடு'),
    cue(90_000, 94_000, 'காலை வந்து ஓயுதே'),
    cue(94_000, 98_000, 'விடியல் வரலயே'),
    cue(120_000, 124_000, 'மரக் கிளையில கூடு'),
    cue(124_000, 128_000, 'அது பறவைக் கூடு'),
    cue(180_000, 184_000, 'காத்து வந்து பேசுதே'),
    cue(184_000, 188_000, 'உந்தன் முகம் தேடுதே'),
    cue(220_000, 224_000, 'மரக் கிளையில கூடு'),
    cue(224_000, 228_000, 'அது பறவைக் கூடு'),
  ];

  it('resolves each repetition to its OWN occurrence', () => {
    const { cues } = alignLyrics(cards, asr);
    expect(cues[1].startMs).toBe(40_000);
    expect(cues[3].startMs).toBe(120_000);
    expect(cues[5].startMs).toBe(220_000);
  });

  it('anchors every line — no interpolation needed here', () => {
    const r = alignLyrics(cards, asr);
    expect(r.anchoredLines).toBe(12);
    expect(r.interpolatedLines).toBe(0);
  });

  it('never emits a start at 0:00 when the song opens on an intro', () => {
    const { cues } = alignLyrics(cards, asr);
    expect(cues[0].startMs).toBe(20_000);
  });
});

describe('alignLyrics — invariants that make it safe to publish', () => {
  const cards: LyricCard[] = [['வரி ஒன்று'], ['வரி இரண்டு'], ['வரி மூன்று'], ['வரி நான்கு']];
  const asr: AsrCue[] = [cue(10_000, 13_000, 'வரி ஒன்று'), cue(60_000, 63_000, 'வரி நான்கு')];

  it('interpolates unanchored lines between the anchors', () => {
    const { cues, anchoredLines, interpolatedLines } = alignLyrics(cards, asr);
    expect(anchoredLines).toBe(2);
    expect(interpolatedLines).toBe(2);
    expect(cues[1].startMs).toBeGreaterThan(10_000);
    expect(cues[2].startMs).toBeLessThan(60_000);
  });

  it('produces strictly increasing starts', () => {
    const { cues } = alignLyrics(cards, asr);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBeGreaterThan(cues[i - 1].startMs);
    }
  });

  it('clamps every cue between the flicker floor and the lingering ceiling', () => {
    const { cues } = alignLyrics(cards, asr, { minCueMs: 1200, maxCueMs: 6000 });
    for (const c of cues) {
      const d = c.endMs - c.startMs;
      expect(d).toBeGreaterThanOrEqual(1200);
      expect(d).toBeLessThanOrEqual(6000);
    }
  });

  it('drops music-marker cues rather than anchoring a line to an instrumental', () => {
    const withMarkers = [cue(0, 9_000, '[இசை]'), ...asr];
    const { cues } = alignLyrics(cards, withMarkers);
    expect(cues[0].startMs).toBe(10_000);
  });

  it('warns instead of guessing when there is nothing to align against', () => {
    const r = alignLyrics(cards, [cue(0, 5_000, '[இசை]')]);
    expect(r.cues).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/no usable ASR cues/);
  });

  it('warns when a track appears to belong to a different recording', () => {
    const r = alignLyrics(cards, [cue(1_000, 4_000, 'முற்றிலும் வேறு வரிகள் இங்கே')]);
    expect(r.warnings.join(' ')).toMatch(/no line matched any cue/);
  });
});

describe('verifyRoundTrip — the guard against machine words reaching a caption', () => {
  const cards: LyricCard[] = [['வாசம் பூத்து வரலயே'], ['வானம் பாத்து நின்றேனே']];
  const asr: AsrCue[] = [
    cue(10_000, 14_000, 'பாசம் பூத்து வரலயே'), // ASR misheard வாசம்
    cue(20_000, 24_000, 'வானம் பாத்து நின்றேனே'),
  ];

  it("emits Raj's word, not the recogniser's", () => {
    const { cues } = alignLyrics(cards, asr);
    expect(cues[0].text).toBe('வாசம் பூத்து வரலயே');
    expect(cues[0].text).not.toContain('பாசம்');
    expect(verifyRoundTrip(cues, cards)).toBe(true);
  });

  it('fails closed if a line were ever dropped or reordered', () => {
    const { cues } = alignLyrics(cards, asr);
    expect(verifyRoundTrip(cues.slice(1), cards)).toBe(false);
    expect(verifyRoundTrip([cues[1], cues[0]], cards)).toBe(false);
  });
});

describe('toSrt', () => {
  it('writes SRT with comma-separated milliseconds and blank-line separators', () => {
    const srt = toSrt([
      { startMs: 20_000, endMs: 24_000, text: 'நெஞ்சக் கூட்டினிலே\nநேசப் பறவை ஒன்று', anchored: true },
    ]);
    expect(srt).toContain('00:00:20,000 --> 00:00:24,000');
    expect(srt).toContain('நெஞ்சக் கூட்டினிலே\nநேசப் பறவை ஒன்று');
    expect(srt.startsWith('1\n')).toBe(true);
  });

  it('pads hours and milliseconds correctly past the one-hour mark', () => {
    const srt = toSrt([{ startMs: 3_723_045, endMs: 3_725_000, text: 'x', anchored: true }]);
    expect(srt).toContain('01:02:03,045');
  });
});

describe('parseSrtCues — real tracks, not idealised ones', () => {
  it('parses CRLF and keeps OVERLAPPING cues (the recogniser emits rolling windows)', () => {
    // Shape observed on the live ta/asr track for 2vgRrCgyOaY.
    const srt =
      '1\r\n00:00:00,000 --> 00:00:05,839\r\nநெஞ்ச கூட்டினிலே [பாடுதல்]\r\n\r\n' +
      '2\r\n00:00:02,879 --> 00:00:08,639\r\nநேச பறவை ஒன்று [இசை]\r\n';
    const cues = parseSrtCues(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0].startMs).toBe(0);
    expect(cues[1].startMs).toBe(2879);
    expect(cues[1].startMs).toBeLessThan(cues[0].endMs); // overlap preserved, not "fixed"
    expect(cues[0].text).toBe('நெஞ்ச கூட்டினிலே [பாடுதல்]');
  });

  it('sorts by start time and skips blocks with no text', () => {
    const srt = '1\n00:00:09,000 --> 00:00:11,000\nlater\n\n2\n00:00:01,000 --> 00:00:02,000\n\n\n3\n00:00:04,000 --> 00:00:06,000\nearlier\n';
    expect(parseSrtCues(srt).map((c) => c.text)).toEqual(['earlier', 'later']);
  });

  it('returns [] for junk rather than throwing', () => {
    expect(parseSrtCues('')).toEqual([]);
    expect(parseSrtCues('not a caption file')).toEqual([]);
  });
});

describe('splitLyricsIntoCards', () => {
  const body = [
    '♪',
    '',
    'நெஞ்சக் கூட்டினிலே',
    'நேசப் பறவை ஒன்று',
    '',
    '[இசை]',
    '',
    'மரக் கிளையில கூடு',
    'அது பறவைக் கூடு',
    '',
  ].join('\n');

  it('splits on blank lines and drops ♪ / [இசை] marker blocks entirely', () => {
    const cards = splitLyricsIntoCards(body);
    expect(cards).toEqual([
      ['நெஞ்சக் கூட்டினிலே', 'நேசப் பறவை ஒன்று'],
      ['மரக் கிளையில கூடு', 'அது பறவைக் கூடு'],
    ]);
  });

  it('produces cards that round-trip through alignment unchanged', () => {
    const cards = splitLyricsIntoCards(body);
    const asr = [
      { startMs: 20_000, endMs: 24_000, text: 'நெஞ்சக் கூட்டினிலே' },
      { startMs: 40_000, endMs: 44_000, text: 'மரக் கிளையில கூடு' },
    ];
    const { cues } = alignLyrics(cards, asr);
    expect(verifyRoundTrip(cues, cards)).toBe(true);
    expect(cues.every((c) => !c.text.includes('\u266a'))).toBe(true);
  });
});

/**
 * CUE DURATION — the defect Raj reported as a viewer on `icH689_JQEM`.
 *
 * Every one of its 28 cues was clamped to exactly 6.0 s while the gaps between
 * them ran a median 4.4 s, so a caption was on screen for only 49% of the sung
 * section: it vanished part-way through nearly every line. His sung lines are
 * simply longer than six seconds. Nothing caught it — round-trip text was true,
 * 52/56 lines anchored, there were no warnings, and the last cue sat inside the
 * duration. Only coverage sees it.
 */
describe('a card holds until the next line, not for a fixed 6 seconds', () => {
  /** Lines 8 s apart — ordinary spacing for a sung Tamil line, not a break. */
  const sung = (n: number, gapMs = 8000): AsrCue[] =>
    Array.from({ length: n }, (_, i) => ({
      startMs: 30000 + i * gapMs,
      endMs: 30000 + i * gapMs + 2000,
      text: `வரி ${i + 1}`,
    }));
  const cards = (n: number): LyricCard[] => Array.from({ length: n }, (_, i) => [`வரி ${i + 1}`]);

  it('holds an 8s line for the full 8s instead of cutting it at 6', () => {
    const r = alignLyrics(cards(5), sung(5));
    const held = r.cues.slice(0, -1).map((c) => c.endMs - c.startMs);
    // Before the fix every one of these was exactly 6000.
    expect(held.every((d) => d === 8000)).toBe(true);
  });

  it('reports coverage, and it is high when lines simply follow each other', () => {
    const r = alignLyrics(cards(5), sung(5));
    expect(r.coverageRatio).toBeGreaterThan(0.9);
    expect(r.warnings.join(' ')).not.toMatch(/cover only/);
  });

  it('STILL clears the screen across a genuine instrumental break', () => {
    // 20 s apart — past instrumentalGapMs, so the card must not sit there.
    const r = alignLyrics(cards(3), sung(3, 20000));
    expect(r.cues[0].endMs - r.cues[0].startMs).toBe(6000);
  });

  it('warns when coverage is poor — the guard icH689_JQEM needed', () => {
    const r = alignLyrics(cards(4), sung(4, 20000));
    expect(r.coverageRatio).toBeLessThan(0.7);
    expect(r.warnings.join(' ')).toMatch(/cover only/);
  });

  it('never emits a cue shorter than the flicker floor', () => {
    const r = alignLyrics(cards(4), sung(4, 1000));
    expect(Math.min(...r.cues.map((c) => c.endMs - c.startMs))).toBeGreaterThanOrEqual(1200);
  });
});
