import {
  buildKaraokeSummary,
  KARAOKE_PRICE,
  KARAOKE_PRICE_LABEL,
  KARAOKE_SUBJECT,
  KARAOKE_TURNAROUND_LABEL,
  KARAOKE_DELIVERABLE,
  KARAOKE_VERSIONS,
} from '@/lib/karaoke';
import { DEFAULT_MAX_DOWNLOADS, DEFAULT_TTL_DAYS } from '@/types/delivery';

describe('karaoke pricing is stated once', () => {
  it('derives the label from the number, so they cannot drift', () => {
    expect(KARAOKE_PRICE).toBe(40);
    expect(KARAOKE_PRICE_LABEL).toBe('CAD $40');
    expect(KARAOKE_PRICE_LABEL).toContain(String(KARAOKE_PRICE));
  });
});

describe('buildKaraokeSummary — the lead must be readable at a glance', () => {
  it('names the song and carries the quoted price and turnaround', () => {
    const s = buildKaraokeSummary({ name: 'A', email: 'a@b.c', song: 'செவ்வந்தி பூவே' });
    expect(s).toContain('Song: செவ்வந்தி பூவே');
    expect(s).toContain(KARAOKE_PRICE_LABEL);
    expect(s).toContain(KARAOKE_TURNAROUND_LABEL);
  });

  it('omits notes entirely when absent, rather than leaving an empty label', () => {
    const s = buildKaraokeSummary({ name: 'A', email: 'a@b.c', song: 'X' });
    expect(s).not.toContain('Notes:');
  });

  it('includes notes when given', () => {
    const s = buildKaraokeSummary({ name: 'A', email: 'a@b.c', song: 'X', notes: 'lower key' });
    expect(s).toContain('Notes: lower key');
  });

  it('says so explicitly when no song was named, rather than showing a blank', () => {
    // A lead with a silently empty song field is one Raj has to chase.
    expect(buildKaraokeSummary({ name: 'A', email: 'a@b.c', song: '   ' })).toContain('(not specified)');
  });

  it('trims whitespace so a padded paste does not misalign the brief', () => {
    expect(buildKaraokeSummary({ name: 'A', email: 'a@b.c', song: '  Y  ' })).toContain('Song: Y');
  });
});

describe('the deliverable is a promise, so it is stated in one place', () => {
  it('promises no vocals — the thing that makes it karaoke', () => {
    expect(KARAOKE_DELIVERABLE.join(' ')).toMatch(/no lead or backing vocals/i);
  });

  /**
   * ⚠️ THIS TEST USED TO PIN A FALSE PROMISE. It asserted "one-time private
   * download", which is not what the system does — a delivery link allows
   * DEFAULT_MAX_DOWNLOADS over DEFAULT_TTL_DAYS, and Anton's were raised to 15
   * over 90. A buyer reading "one-time" would think a second click had cost
   * them the file.
   *
   * The promise is now DERIVED from the delivery defaults, so the page cannot
   * drift from the code that implements it — the same rule the pricing already
   * follows.
   */
  it('promises a private link on the delivery system-s real terms', () => {
    const promise = KARAOKE_DELIVERABLE.join(' ');
    expect(promise).toMatch(/private link/i);
    expect(promise).toContain(String(DEFAULT_MAX_DOWNLOADS));
    expect(promise).toContain(String(DEFAULT_TTL_DAYS));
    expect(promise).not.toMatch(/one-time/i);
  });

  it('promises the two versions that actually ship', () => {
    expect(KARAOKE_DELIVERABLE.join(' ')).toMatch(/two versions/i);
    expect(KARAOKE_VERSIONS.map((v) => v.name)).toEqual(['Studio', 'Standard']);
  });

  /** Each version says which ROOM it is for — that is the whole point of two. */
  it('says what each version is for, not just its name', () => {
    for (const v of KARAOKE_VERSIONS) {
      expect(v.forWhat.length).toBeGreaterThan(3);
      expect(v.why.length).toBeGreaterThan(20);
    }
    expect(KARAOKE_VERSIONS.find((v) => v.name === 'Standard')!.why).toMatch(/louder|room/i);
  });
});

describe('leads are identifiable in /admin/messages', () => {
  it('carries its own subject, distinct from a composition commission', () => {
    expect(KARAOKE_SUBJECT).toBe('Karaoke Request');
  });
});
