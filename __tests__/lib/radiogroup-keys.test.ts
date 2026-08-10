/** @jest-environment node */
/**
 * UNIT TESTS — pure radiogroup keyboard navigation.
 */
import { nextRadioIndex, radioTabIndex } from '@/lib/radiogroup-keys';

describe('nextRadioIndex', () => {
  it('moves forward on Right and Down', () => {
    expect(nextRadioIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextRadioIndex('ArrowDown', 0, 3)).toBe(1);
  });

  it('moves backward on Left and Up', () => {
    expect(nextRadioIndex('ArrowLeft', 2, 3)).toBe(1);
    expect(nextRadioIndex('ArrowUp', 2, 3)).toBe(1);
  });

  it('wraps in both directions — a radiogroup is a loop, not a list', () => {
    expect(nextRadioIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextRadioIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the ends on Home and End', () => {
    expect(nextRadioIndex('Home', 2, 3)).toBe(0);
    expect(nextRadioIndex('End', 0, 3)).toBe(2);
  });

  it('returns null for keys that mean nothing here, so they pass through', () => {
    for (const k of ['Tab', 'Enter', ' ', 'a', 'Escape', 'PageDown']) {
      expect(nextRadioIndex(k, 0, 3)).toBeNull();
    }
  });

  it('is a no-op on an empty group rather than dividing by zero', () => {
    expect(nextRadioIndex('ArrowRight', 0, 0)).toBeNull();
    expect(nextRadioIndex('Home', 0, 0)).toBeNull();
  });

  it('still resolves when the current index is out of range or unset', () => {
    // A group whose selection was cleared elsewhere must stay operable.
    expect(nextRadioIndex('ArrowRight', -1, 3)).toBe(1);
    expect(nextRadioIndex('ArrowRight', 99, 3)).toBe(1);
  });

  it('handles a two-option group, which is what the A/B switch is', () => {
    expect(nextRadioIndex('ArrowRight', 0, 2)).toBe(1);
    expect(nextRadioIndex('ArrowRight', 1, 2)).toBe(0);
  });
});

describe('radioTabIndex', () => {
  it('makes the group ONE tab stop — only the checked option is tabbable', () => {
    expect(radioTabIndex(0, 1, 3)).toBe(-1);
    expect(radioTabIndex(1, 1, 3)).toBe(0);
    expect(radioTabIndex(2, 1, 3)).toBe(-1);
  });

  it('falls back to the first option when nothing is checked', () => {
    // Otherwise the group is unreachable by keyboard — worse than the bug.
    expect(radioTabIndex(0, -1, 3)).toBe(0);
    expect(radioTabIndex(1, -1, 3)).toBe(-1);
  });

  it('treats an out-of-range selection as nothing checked', () => {
    expect(radioTabIndex(0, 99, 3)).toBe(0);
    expect(radioTabIndex(2, 99, 3)).toBe(-1);
  });
});
