/** Space typed into a field is text, not a tap. Sliders, checkboxes and buttons are not fields. */
const TEXT_INPUT = /^(text|search|email|url|tel|password|number|date|time|datetime-local|month|week)$/;

/** True when a key press is typing into a field, so a page shortcut must leave it alone. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && TEXT_INPUT.test((el as HTMLInputElement).type || 'text');
}
