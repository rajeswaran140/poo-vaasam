/**
 * Lyrics value object — structured song words (sections → lines, optional
 * romanisation + timestamps). Pure domain rules: tolerant construction, plain-text
 * parsing with Tamil/latin section markers, serialisation, and LRC export.
 */

import { Lyrics, LYRICS_SECTION_KINDS, type LyricsDTO } from '@/domain/songs/Lyrics';

describe('Lyrics.empty', () => {
  it('is empty, has no lines, is not time-synced, serialises to []', () => {
    const l = Lyrics.empty();
    expect(l.isEmpty()).toBe(true);
    expect(l.lineCount).toBe(0);
    expect(l.isTimeSynced()).toBe(false);
    expect(l.toObject()).toEqual({ sections: [] });
    expect(l.toPlainText()).toBe('');
    expect(l.toLRC()).toBe('');
  });
});

describe('Lyrics.fromObject — tolerant reconstruction', () => {
  it('round-trips a well-formed structured object', () => {
    const dto: LyricsDTO = {
      sections: [
        { kind: 'pallavi', label: 'பல்லவி', lines: [{ text: 'நீ சிரிச்ச நேரம்' }] },
        {
          kind: 'charanam',
          lines: [
            { text: 'வரி ஒன்று', romanized: 'vari ondru', startSeconds: 12.5 },
            { text: 'வரி இரண்டு' },
          ],
        },
      ],
    };
    const l = Lyrics.fromObject(dto);
    expect(l.isEmpty()).toBe(false);
    expect(l.lineCount).toBe(3);
    expect(l.toObject()).toEqual(dto);
  });

  it('returns an Lyrics instance unchanged when given one (idempotent)', () => {
    const original = Lyrics.fromObject({ sections: [{ kind: 'other', lines: [{ text: 'a' }] }] });
    expect(Lyrics.fromObject(original)).toBe(original);
  });

  it.each([null, undefined, 42, 'lyrics', {}, { sections: 'nope' }, { sections: {} }])(
    'treats junk input (%p) as empty',
    (junk) => {
      expect(Lyrics.fromObject(junk as unknown).isEmpty()).toBe(true);
    }
  );

  it('coerces unknown section kinds to "other" and string lines to {text}', () => {
    const l = Lyrics.fromObject({
      sections: [{ kind: 'bridge', lines: ['line as string', '  ', ''] }],
    });
    expect(l.toObject()).toEqual({
      sections: [{ kind: 'other', lines: [{ text: 'line as string' }] }],
    });
  });

  it('drops sections with no usable lines, and empty/whitespace lines', () => {
    const l = Lyrics.fromObject({
      sections: [
        { kind: 'pallavi', lines: [{ text: '   ' }, { text: '' }] },
        { kind: 'charanam', lines: [{ text: 'keeper' }] },
        'not-an-object',
      ],
    });
    expect(l.toObject()).toEqual({ sections: [{ kind: 'charanam', lines: [{ text: 'keeper' }] }] });
  });

  it('ignores invalid romanized / startSeconds but keeps the text', () => {
    const l = Lyrics.fromObject({
      sections: [
        {
          kind: 'other',
          lines: [
            { text: 'a', romanized: 42, startSeconds: -5 },
            { text: 'b', startSeconds: Number.NaN },
            { text: 'c', startSeconds: 3 },
          ],
        },
      ],
    });
    const lines = l.sections[0].lines;
    expect(lines[0]).toEqual({ text: 'a' });
    expect(lines[1]).toEqual({ text: 'b' });
    expect(lines[2]).toEqual({ text: 'c', startSeconds: 3 });
    expect(l.isTimeSynced()).toBe(true);
  });

  it('trims a whitespace-only label to undefined', () => {
    const l = Lyrics.fromObject({ sections: [{ kind: 'pallavi', label: '   ', lines: [{ text: 'x' }] }] });
    expect(l.sections[0].label).toBeUndefined();
  });
});

describe('Lyrics.fromObject — defensive caps', () => {
  it('caps the number of sections', () => {
    const sections = Array.from({ length: 80 }, (_, i) => ({
      kind: 'other' as const,
      lines: [{ text: `s${i}` }],
    }));
    expect(Lyrics.fromObject({ sections }).sections.length).toBe(50);
  });

  it('caps lines per section', () => {
    const lines = Array.from({ length: 500 }, (_, i) => ({ text: `l${i}` }));
    expect(Lyrics.fromObject({ sections: [{ kind: 'other', lines }] }).sections[0].lines.length).toBe(200);
  });

  it('truncates an individual line to the max length', () => {
    const long = 'அ'.repeat(5000);
    const l = Lyrics.fromObject({ sections: [{ kind: 'other', lines: [{ text: long }] }] });
    expect(l.sections[0].lines[0].text.length).toBe(1000);
  });

  it('stops accumulating once the total-character budget is exceeded', () => {
    // 100 sections × 1 line × 1000 chars = 100k, well over the 50k budget.
    const sections = Array.from({ length: 100 }, (_, i) => ({
      kind: 'other' as const,
      lines: [{ text: 'அ'.repeat(1000) + i }],
    }));
    const total = Lyrics.fromObject({ sections }).lineCount;
    expect(total).toBeLessThanOrEqual(50);
    expect(total).toBeGreaterThan(0);
  });
});

describe('Lyrics.fromPlainText', () => {
  it('returns empty for blank / non-string input', () => {
    expect(Lyrics.fromPlainText('').isEmpty()).toBe(true);
    expect(Lyrics.fromPlainText('   \n  ').isEmpty()).toBe(true);
    expect(Lyrics.fromPlainText(undefined as unknown).isEmpty()).toBe(true);
  });

  it('splits blank-line-separated blocks into "other" sections', () => {
    const l = Lyrics.fromPlainText('line a\nline b\n\nline c');
    expect(l.toObject()).toEqual({
      sections: [
        { kind: 'other', lines: [{ text: 'line a' }, { text: 'line b' }] },
        { kind: 'other', lines: [{ text: 'line c' }] },
      ],
    });
  });

  it('recognises a marker as the first line of a block (Tamil + latin)', () => {
    const l = Lyrics.fromPlainText('பல்லவி\nநீ சிரிச்ச நேரம்\n\nCharanam 2:\nவரி ஒன்று');
    expect(l.sections.map((s) => s.kind)).toEqual(['pallavi', 'charanam']);
    expect(l.sections[0].label).toBe('பல்லவி');
    expect(l.sections[0].lines).toEqual([{ text: 'நீ சிரிச்ச நேரம்' }]);
    expect(l.sections[1].label).toBe('Charanam 2:');
    expect(l.sections[1].lines).toEqual([{ text: 'வரி ஒன்று' }]);
  });

  it('attaches a header-only block to the following block', () => {
    const l = Lyrics.fromPlainText('சரணம்\n\nவரி ஒன்று\nவரி இரண்டு');
    expect(l.toObject()).toEqual({
      sections: [
        { kind: 'charanam', label: 'சரணம்', lines: [{ text: 'வரி ஒன்று' }, { text: 'வரி இரண்டு' }] },
      ],
    });
  });

  it('normalises CRLF line endings', () => {
    const l = Lyrics.fromPlainText('a\r\nb\r\n\r\nc');
    expect(l.sections.length).toBe(2);
    expect(l.sections[0].lines).toEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('does not mistake a normal lyric line for a marker', () => {
    const l = Lyrics.fromPlainText('நீ சிரிச்ச நேரம் தான்');
    expect(l.sections[0].kind).toBe('other');
  });
});

describe('Lyrics.toPlainText', () => {
  it('round-trips structure that carries labels', () => {
    const text = 'பல்லவி\nநீ சிரிச்ச நேரம்\n\nசரணம்\nவரி ஒன்று';
    expect(Lyrics.fromPlainText(text).toPlainText()).toBe(text);
  });
});

describe('Lyrics.toLRC', () => {
  it('emits only timestamped lines in [mm:ss.cc] form', () => {
    const l = Lyrics.fromObject({
      sections: [
        {
          kind: 'pallavi',
          lines: [
            { text: 'first', startSeconds: 5 },
            { text: 'untimed' },
            { text: 'second', startSeconds: 72.5 },
          ],
        },
      ],
    });
    expect(l.toLRC()).toBe('[00:05.00]first\n[01:12.50]second');
  });

  it('returns "" when nothing is timestamped', () => {
    expect(Lyrics.fromPlainText('a\nb').toLRC()).toBe('');
  });
});

describe('LYRICS_SECTION_KINDS', () => {
  it('exposes the supported kinds', () => {
    expect(LYRICS_SECTION_KINDS).toEqual(['pallavi', 'anupallavi', 'charanam', 'intro', 'other']);
  });
});
