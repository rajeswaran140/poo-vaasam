import { buildCommissionSummary, OCCASIONS, MOODS, COMMISSION_SUBJECT } from '@/lib/commission';

describe('buildCommissionSummary', () => {
  it('renders a structured brief with name, fields, and lyrics', () => {
    const out = buildCommissionSummary({
      name: 'Anbu',
      email: 'anbu@example.com',
      occasion: 'திருமணம் / Wedding',
      mood: 'மகிழ்ச்சி / Happy',
      length: '4 min',
      reference: 'https://youtu.be/x',
      details: 'காதல் வரிகள்...',
    });
    expect(out).toContain('🎼 Music Composition Request');
    expect(out).toContain('Name: Anbu');
    expect(out).toContain('Contact: anbu@example.com');
    expect(out).toContain('Occasion: திருமணம் / Wedding');
    expect(out).toContain('Mood / Style: மகிழ்ச்சி / Happy');
    expect(out).toContain('Length: 4 min');
    expect(out).toContain('Reference: https://youtu.be/x');
    expect(out).toContain('Lyrics / Details:');
    expect(out).toContain('காதல் வரிகள்...');
  });

  it('omits empty optional fields (no blank "Occasion:" lines)', () => {
    const out = buildCommissionSummary({ name: 'A', email: 'a@b.com', details: 'lyrics' });
    expect(out).not.toContain('Occasion:');
    expect(out).not.toContain('Mood');
    expect(out).not.toContain('Reference:');
    expect(out).toContain('Name: A');
    expect(out).toContain('lyrics');
  });

  it('trims whitespace on the values', () => {
    const out = buildCommissionSummary({ name: '  A  ', email: ' a@b.com ', details: '  hi  ' });
    expect(out).toContain('Name: A');
    expect(out).toContain('Contact: a@b.com');
    expect(out.trimEnd().endsWith('hi')).toBe(true);
  });

  it('exposes bilingual option lists and a stable subject', () => {
    expect(OCCASIONS.some((o) => /Wedding/.test(o))).toBe(true);
    expect(MOODS.some((m) => /Happy/.test(m))).toBe(true);
    expect(COMMISSION_SUBJECT).toBe('Music Composition Commission');
  });
});
