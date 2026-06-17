/** @jest-environment node */
/** Pure transliteration helpers: response parsing, token detection, commit. */

import {
  inputToolsUrl,
  parseInputToolsCandidates,
  activeLatinToken,
  commitCandidate,
} from '@/lib/transliterate';

describe('inputToolsUrl', () => {
  it('builds a Tamil request URL with the text and itc code', () => {
    const url = inputToolsUrl('amma', 'ta', 9);
    expect(url).toContain('inputtools.google.com/request');
    expect(url).toContain('text=amma');
    expect(url).toContain('itc=ta-t-i0-und');
    expect(url).toContain('num=9');
  });
});

describe('parseInputToolsCandidates', () => {
  it('extracts candidates from a SUCCESS response', () => {
    const data = ['SUCCESS', [['amma', ['அம்மா', 'அம்மை', 'அம்ம'], [], { candidate_type: [0, 0, 0] }]]];
    expect(parseInputToolsCandidates(data)).toEqual(['அம்மா', 'அம்மை', 'அம்ம']);
  });

  it('returns [] for a non-SUCCESS or malformed response', () => {
    expect(parseInputToolsCandidates(['FAILED', []])).toEqual([]);
    expect(parseInputToolsCandidates(null)).toEqual([]);
    expect(parseInputToolsCandidates(['SUCCESS', []])).toEqual([]);
    expect(parseInputToolsCandidates('garbage')).toEqual([]);
  });
});

describe('activeLatinToken', () => {
  it('returns the latin run ending at the caret', () => {
    expect(activeLatinToken('amma', 4)).toEqual({ token: 'amma', start: 0 });
  });

  it('finds the token after Tamil text + a space', () => {
    const text = 'வணக்கம் amma';
    expect(activeLatinToken(text, text.length)).toEqual({ token: 'amma', start: text.indexOf('amma') });
  });

  it('returns null when the char before the caret is not a latin letter', () => {
    expect(activeLatinToken('amma ', 5)).toBeNull(); // trailing space
    expect(activeLatinToken('அம்மா', 5)).toBeNull(); // Tamil
    expect(activeLatinToken('', 0)).toBeNull();
  });
});

describe('commitCandidate', () => {
  it('replaces the token with the candidate', () => {
    const r = commitCandidate('type amma', 5, 9, 'அம்மா', false);
    expect(r.text).toBe('type அம்மா');
    expect(r.caret).toBe(5 + 'அம்மா'.length);
  });

  it('appends a trailing space when asked (Space-to-commit)', () => {
    const r = commitCandidate('type amma', 5, 9, 'அம்மா', true);
    expect(r.text).toBe('type அம்மா ');
    expect(r.caret).toBe(5 + 'அம்மா '.length);
  });

  it('keeps text after the caret intact', () => {
    const r = commitCandidate('amma da', 0, 4, 'அம்மா', false);
    expect(r.text).toBe('அம்மா da');
  });
});
