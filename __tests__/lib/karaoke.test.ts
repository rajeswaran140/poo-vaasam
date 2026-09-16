import {
  buildKaraokeSummary,
  KARAOKE_PRICE,
  KARAOKE_PRICE_LABEL,
  KARAOKE_SUBJECT,
  KARAOKE_TURNAROUND_LABEL,
  KARAOKE_DELIVERABLE,
} from '@/lib/karaoke';

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

  it('promises a one-time private link, not a public URL', () => {
    expect(KARAOKE_DELIVERABLE.join(' ')).toMatch(/one-time private download/i);
  });
});

describe('leads are identifiable in /admin/messages', () => {
  it('carries its own subject, distinct from a composition commission', () => {
    expect(KARAOKE_SUBJECT).toBe('Karaoke Request');
  });
});
