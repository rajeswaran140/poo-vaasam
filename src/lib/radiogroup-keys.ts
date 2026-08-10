/**
 * Keyboard navigation for a custom ARIA radiogroup.
 *
 * WHY THIS EXISTS. `MasteringWaveform` states the rule this module kept only
 * there: *"A role="slider" that ignores arrow keys is a slider in name only."*
 * The same applies to radios. Two groups in the mastering studio — the loudness
 * target and the A/B compare switch — carried `role="radio"` with no key
 * handling, so every option was a separate tab stop and the arrows did nothing.
 *
 * The A/B switch is the one that matters: comparing before and after is the
 * core mastering gesture, and by keyboard it cost two tab stops and a space
 * while you were trying to hear a difference.
 *
 * The ARIA pattern this implements:
 *   - Arrow Right/Down  → next option, wrapping
 *   - Arrow Left/Up     → previous option, wrapping
 *   - Home / End        → first / last
 *   - SELECTION FOLLOWS FOCUS — moving with an arrow also selects. That is the
 *     radiogroup pattern (unlike a tablist, where it is optional), and it is
 *     what makes the A/B switch a single keypress.
 *   - Only the checked option is tabbable (roving tabindex), so the group is
 *     ONE tab stop, not one per option.
 *
 * Pure: returns the index to move to, or null when the key means nothing here.
 * The component owns focusing and selecting.
 */

/** Keys this helper acts on. Anything else returns null and must pass through. */
const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREV = new Set(['ArrowLeft', 'ArrowUp']);

export function nextRadioIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  // A current index outside the group still resolves, so a group whose
  // selection was cleared elsewhere stays operable from the keyboard.
  const at = Number.isInteger(current) && current >= 0 && current < count ? current : 0;

  if (NEXT.has(key)) return (at + 1) % count;
  if (PREV.has(key)) return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Roving tabindex: the checked option is the group's single tab stop.
 *
 * When nothing is checked the FIRST option takes the 0 — otherwise the group
 * becomes unreachable by keyboard entirely, which is worse than the bug this
 * fixes.
 */
export function radioTabIndex(index: number, selectedIndex: number, count: number): 0 | -1 {
  const anySelected = selectedIndex >= 0 && selectedIndex < count;
  if (anySelected) return index === selectedIndex ? 0 : -1;
  return index === 0 ? 0 : -1;
}
