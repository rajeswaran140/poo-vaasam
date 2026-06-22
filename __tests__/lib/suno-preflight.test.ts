import { preflightSuno, SUNO_LIMITS, type PreflightInput } from '@/lib/suno-preflight';

// A clean, SUNO-ready Tamil love song that should pass with no errors.
const GOOD: PreflightInput = {
  style:
    'Tamil romantic film ballad, mid-tempo, warm and soulful, female solo vocals, with flute, veena and soft strings over gentle tabla.',
  lyrics: `[Verse]
எல்லார்க்கும் அவ ஒரு பேரு எனக்கு மட்டும் ஒரு உலகம்
எல்லார்க்கும் அவ ஒரு முகம் எனக்கு மட்டும் வாழ்க்கை வசந்தம்

[Chorus]
சிரிக்கிற நேரத்துல சின்னஞ்சிறு நிலவாகும்
மௌனம் கலைகிற நேரத்துல கவிதை பூக்கும்`,
  targetSeconds: 240,
};

const codes = (input: PreflightInput) => preflightSuno(input).findings.map((f) => f.code);

describe('preflightSuno — happy path', () => {
  it('a clean prompt + lyrics is ready with a high score and no errors', () => {
    const r = preflightSuno(GOOD);
    expect(r.ready).toBe(true);
    expect(r.findings.some((f) => f.severity === 'error')).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(90);
  });
});

describe('style findings', () => {
  it('flags an empty style as an error (not ready)', () => {
    const r = preflightSuno({ ...GOOD, style: '   ' });
    expect(r.ready).toBe(false);
    expect(codes({ ...GOOD, style: '' })).toContain('STYLE_EMPTY');
  });

  it('errors when the style exceeds the hard cap', () => {
    const long = 'a'.repeat(SUNO_LIMITS.STYLE_MAX + 1);
    expect(codes({ ...GOOD, style: long })).toContain('STYLE_TOO_LONG');
    expect(preflightSuno({ ...GOOD, style: long }).ready).toBe(false);
  });

  it('warns (not error) when the style is between the soft and hard limits', () => {
    const mid = 'soft female vocals flute veena slow ' + 'x'.repeat(SUNO_LIMITS.STYLE_SOFT + 10);
    const r = preflightSuno({ ...GOOD, style: mid });
    expect(r.findings.map((f) => f.code)).toContain('STYLE_LONG');
    expect(r.ready).toBe(true); // a warning doesn't block
  });

  it('errors when lyrics leak into the style box (section tag present)', () => {
    expect(codes({ ...GOOD, style: 'Tamil ballad [Verse] some words here' })).toContain('STYLE_HAS_LYRICS');
  });

  it('warns on conflicting genres', () => {
    expect(codes({ ...GOOD, style: 'aggressive EDM dubstep meets gentle carnatic flute, female vocals, slow' })).toContain('STYLE_GENRE_CONFLICT');
  });

  it('warns when the style is vague (missing >= 2 concrete cues)', () => {
    expect(codes({ ...GOOD, style: 'a nice song' })).toContain('STYLE_VAGUE');
  });
});

describe('lyrics findings', () => {
  it('errors on empty lyrics', () => {
    const r = preflightSuno({ ...GOOD, lyrics: '' });
    expect(r.ready).toBe(false);
    expect(codes({ ...GOOD, lyrics: '' })).toContain('LYRICS_EMPTY');
  });

  it('warns when there are no section tags', () => {
    expect(codes({ ...GOOD, lyrics: 'எல்லார்க்கும் அவ ஒரு பேரு\nஎனக்கு மட்டும் ஒரு உலகம்' })).toContain('LYRICS_NO_STRUCTURE');
  });

  it('recognises DESCRIPTIVE + Carnatic section tags (no false NO_STRUCTURE)', () => {
    // Regression: "[Chorus — Pallavi]" / "[Verse 1 — Anupallavi]" are structure.
    const lyrics = '[Chorus — Pallavi]\nஅம்மா உந்தன் நினைவுகள்\n[Verse 1 — Anupallavi]\nகண்ணயரும் வேளையில';
    expect(codes({ ...GOOD, lyrics })).not.toContain('LYRICS_NO_STRUCTURE');
  });

  it('does not count [Break — …] production-note lines toward the line limit', () => {
    const sung = Array.from({ length: 40 }, (_, i) => `வரி ${i}`); // 40 sung lines < 60
    const withNotes = ['[Intro — flute]', '[Chorus]', ...sung, '[Break — 2 bars]', '[Outro — fade]'];
    expect(codes({ ...GOOD, lyrics: withNotes.join('\n') })).not.toContain('LYRICS_MANY_LINES');
  });

  it('errors when lyrics exceed the char cap', () => {
    const huge = '[Verse]\n' + 'வரி '.repeat(SUNO_LIMITS.LYRICS_MAX_CHARS);
    const r = preflightSuno({ ...GOOD, lyrics: huge });
    expect(r.ready).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain('LYRICS_TOO_LONG');
  });

  it('warns when there are too many lines for one render', () => {
    const many = '[Verse]\n' + Array.from({ length: SUNO_LIMITS.LYRICS_SOFT_LINES + 5 }, (_, i) => `வரி ${i}`).join('\n');
    expect(codes({ ...GOOD, lyrics: many })).toContain('LYRICS_MANY_LINES');
  });

  it('warns on mixed Tamil + heavy English', () => {
    const mixed = `[Verse]\nஎல்லார்க்கும் அவ ஒரு பேரு\n${'this is an english sentence inside the lyrics body '.repeat(2)}`;
    expect(codes({ ...GOOD, lyrics: mixed })).toContain('LYRICS_MIXED_LANG');
  });

  it('warns on emoji in the lyrics', () => {
    expect(codes({ ...GOOD, lyrics: '[Verse]\nஎல்லார்க்கும் அவ ஒரு பேரு ❤️' })).toContain('LYRICS_EMOJI');
  });

  it('gives a duration info note when lyrics overshoot the target', () => {
    const lines = '[Verse]\n' + Array.from({ length: 20 }, (_, i) => `வரி ${i}`).join('\n');
    // 20 lines * 6s = 120s, target 30s → > 1.5x → info
    expect(codes({ style: GOOD.style, lyrics: lines, targetSeconds: 30 })).toContain('LYRICS_OVER_DURATION');
  });
});

describe('scoring', () => {
  it('an error caps readiness false and lowers the score below a clean run', () => {
    const clean = preflightSuno(GOOD).score;
    const broken = preflightSuno({ style: '', lyrics: '' });
    expect(broken.ready).toBe(false);
    expect(broken.score).toBeLessThan(clean);
    expect(broken.score).toBeGreaterThanOrEqual(0);
  });

  it('score never leaves the 0–100 range under many findings', () => {
    const r = preflightSuno({ style: 'EDM metal rap', lyrics: 'x'.repeat(SUNO_LIMITS.LYRICS_MAX_CHARS + 1) + ' ❤️' });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
