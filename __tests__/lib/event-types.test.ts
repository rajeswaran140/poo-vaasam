import {
  eventBeaconSchema,
  sanitizeTarget,
  derivedSongEvent,
  EVENT_TYPES,
  DERIVED_EVENT_TYPES,
  STORE_EVENT_TYPES,
} from '@/lib/event-types';

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

  it('covers exactly the documented client-sendable event types', () => {
    expect([...EVENT_TYPES]).toEqual(['play', 'share', 'youtube', 'subscribe', 'install', 'inbound']);
  });

  // --- per-song attribution (added in the 2026-07-14 WhatsApp audit) ---
  // trackShare took a songId, passed it to GA4, then dropped it before the
  // beacon — so "which song do people forward?" was unanswerable from our own
  // data, and the only copy that had it (GA4) was never read back.

  it('accepts an optional songId so a share can say WHICH song was forwarded', () => {
    const r = eventBeaconSchema.safeParse({ type: 'share', target: 'whatsapp', songId: 'cnt_9' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.songId).toBe('cnt_9');
  });

  it('rejects an over-long songId', () => {
    expect(
      eventBeaconSchema.safeParse({ type: 'share', target: 'whatsapp', songId: 'x'.repeat(121) }).success
    ).toBe(false);
  });

  // --- target shape validation (2026-07-22 dashboard audit) ---
  // /api/events is public and every distinct target mints its own DynamoDB
  // counter row, so an unconstrained string let a scripted client both inflate
  // the dashboard and grow the table without bound.

  describe('target shape', () => {
    it.each([
      ['share', 'whatsapp'],
      ['share', 'whatsapp_status'],
      ['share', 'whatsapp_status_download'],
      ['share', 'facebook'],
      ['share', 'copy'],
      ['share', 'native'],
      ['subscribe', 'home_hero'],
      ['subscribe', 'content_preview_cta'],
      ['subscribe', 'videos_shorts_link'],
      ['subscribe', 'unknown'],
      ['inbound', 'whatsapp'],
      ['install', 'pwa'],
      ['youtube', 'channel'],
      ['youtube', 'videos-grid'],
      ['youtube', 'video:kOpNZHlE9FE'],
      ['play', 'cnt_1780067292613_jdgzm3ojb'],
      // plays stay wider than a content id so a future player surface can key
      // them its own way rather than being silently dropped
      ['play', 'song:a'],
      ['play', 'preview'],
    ])('accepts the real %s target %s emitted by a live call site', (type, target) => {
      expect(eventBeaconSchema.safeParse({ type, target }).success).toBe(true);
    });

    it.each([
      ['play', 'a b c'],
      ['play', 'song:a:b:c'],
      ['share', 'HTTPS://evil.example/x'],
      ['share', 'a b c'],
      ['share', '<script>'],
      ['subscribe', '../../etc/passwd'],
      ['youtube', 'video:!!'],
      ['inbound', 'Zalgo😈'],
    ])('rejects the junk %s target %s that would mint a stray counter row', (type, target) => {
      expect(eventBeaconSchema.safeParse({ type, target }).success).toBe(false);
    });

    it('rejects a high-cardinality target sweep (the table-growth vector)', () => {
      const attempts = Array.from({ length: 50 }, (_, i) => `X${i}!${i}`);
      for (const target of attempts) {
        expect(eventBeaconSchema.safeParse({ type: 'share', target }).success).toBe(false);
      }
    });

    it('requires songId to be a content id, not free text', () => {
      expect(eventBeaconSchema.safeParse({ type: 'share', target: 'whatsapp', songId: 'cnt_9' }).success).toBe(true);
      expect(eventBeaconSchema.safeParse({ type: 'share', target: 'whatsapp', songId: 'anything' }).success).toBe(false);
    });
  });

  it('refuses a client-supplied DERIVED type — those are server-written only', () => {
    // Otherwise any client could POST arbitrary per-song counters into the store.
    expect(eventBeaconSchema.safeParse({ type: 'share_song', target: 'cnt_9' }).success).toBe(false);
    expect(eventBeaconSchema.safeParse({ type: 'inbound_song', target: 'cnt_9' }).success).toBe(false);
  });
});

describe('derivedSongEvent', () => {
  it('derives a per-song counter from a share carrying a songId', () => {
    expect(derivedSongEvent({ type: 'share', target: 'whatsapp', songId: 'cnt_9' })).toEqual({
      type: 'share_song',
      target: 'cnt_9',
    });
  });

  it('derives a per-song counter from an inbound visit carrying a songId', () => {
    expect(derivedSongEvent({ type: 'inbound', target: 'whatsapp', songId: 'cnt_9' })).toEqual({
      type: 'inbound_song',
      target: 'cnt_9',
    });
  });

  it('derives nothing without a songId', () => {
    expect(derivedSongEvent({ type: 'share', target: 'whatsapp' })).toBeNull();
  });

  it('derives nothing for event types with no per-song meaning', () => {
    expect(derivedSongEvent({ type: 'install', songId: 'cnt_9' })).toBeNull();
    expect(derivedSongEvent({ type: 'subscribe', target: 'footer', songId: 'cnt_9' })).toBeNull();
  });
});

describe('event type sets', () => {
  it('keeps derived types out of the client-sendable set', () => {
    for (const t of DERIVED_EVENT_TYPES) {
      expect(EVENT_TYPES).not.toContain(t as never);
    }
  });

  it('lets the store accept both client-sendable and derived types', () => {
    expect([...STORE_EVENT_TYPES]).toEqual([...EVENT_TYPES, ...DERIVED_EVENT_TYPES]);
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
