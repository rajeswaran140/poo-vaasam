/** @jest-environment node */
/**
 * claude.generateSuggestions — the pure (no-network) part of the Anthropic
 * adapter: it returns poem-specific prompts when context is present, otherwise
 * general ones.
 */
import { generateSuggestions } from '@/services/ai/claude';

describe('generateSuggestions', () => {
  it('returns general suggestions when no poem context is given', () => {
    const s = generateSuggestions();
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
  });

  it('returns poem-specific suggestions when context is provided', () => {
    const general = generateSuggestions();
    const specific = generateSuggestions({ title: 'ஒரு கவிதை', author: 'Raj', body: '...' });
    expect(specific).not.toEqual(general);
    expect(specific.length).toBeGreaterThan(0);
  });
});
