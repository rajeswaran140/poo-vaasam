import { eventBeaconSchema, sanitizeTarget, EVENT_TYPES } from '@/lib/event-types';

describe('eventBeaconSchema', () => {
  it('accepts a known type with a target', () => {
    const r = eventBeaconSchema.safeParse({ type: 'share', target: 'whatsapp' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ type: 'share', target: 'whatsapp' });
  });

  it('accepts a known type with no target', () => {
    expect(eventBeaconSchema.safeParse({ type: 'install' }).success).toBe(true);
  });

  it('rejects an unknown event type', () => {
    expect(eventBeaconSchema.safeParse({ type: 'hack', target: 'x' }).success).toBe(false);
  });

  it('rejects a missing type and an over-long target', () => {
    expect(eventBeaconSchema.safeParse({ target: 'x' }).success).toBe(false);
    expect(eventBeaconSchema.safeParse({ type: 'play', target: 'a'.repeat(121) }).success).toBe(false);
  });

  it('covers exactly the documented event types', () => {
    expect([...EVENT_TYPES]).toEqual(['play', 'share', 'youtube', 'subscribe', 'install', 'inbound']);
  });
});

describe('sanitizeTarget', () => {
  it('replaces the sort-key delimiter so a target cannot forge a key', () => {
    expect(sanitizeTarget('a#b#c')).toBe('a_b_c');
  });
  it('collapses empty/whitespace to a stable "-"', () => {
    expect(sanitizeTarget(undefined)).toBe('-');
    expect(sanitizeTarget('   ')).toBe('-');
    expect(sanitizeTarget('')).toBe('-');
  });
  it('caps length at 120 chars', () => {
    expect(sanitizeTarget('x'.repeat(200)).length).toBe(120);
  });
});
