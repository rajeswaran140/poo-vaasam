import { resolveLineage, parseDerivedFrom, lineageLabel } from '@/lib/master-lineage';

const PARENT = { id: 'p1', savedAt: '2026-10-01T00:00:00.000Z', s3Key: 'audio/mastering/1_a_song.wav' };
const REMIX = 'audio/mastering/stems/p1/remix-1.wav';
const SET = { remix: { key: REMIX, renderedAt: 't', mixUsed: { s1: { gainDb: -3, muted: false } }, notes: [], error: null, requestedAt: null } };

describe('resolveLineage', () => {
  it('is a stem remix when the source is the parent\'s remix, and copies the mix it was made with', () => {
    expect(resolveLineage(PARENT, SET, REMIX)).toEqual({
      ok: true, derivedFrom: { jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: -3, muted: false } } },
    });
  });
  it('is a re-master when the source is the parent\'s own source', () => {
    expect(resolveLineage(PARENT, null, PARENT.s3Key)).toEqual({ ok: true, derivedFrom: { jobId: 'p1', via: 're-master' } });
  });
  it('refuses a missing or unsaved parent', () => {
    expect(resolveLineage(null, null, PARENT.s3Key)).toMatchObject({ ok: false, code: 'bad-parent' });
    expect(resolveLineage({ ...PARENT, savedAt: null }, null, PARENT.s3Key)).toMatchObject({ ok: false, code: 'bad-parent' });
  });
  it('refuses a source that is neither', () => {
    expect(resolveLineage(PARENT, SET, 'audio/mastering/9_other.wav')).toMatchObject({ ok: false, code: 'parent-mismatch' });
  });
});

describe('parseDerivedFrom', () => {
  it('reads a stored lineage and degrades anything else to null', () => {
    expect(parseDerivedFrom({ jobId: 'p1', via: 're-master' })).toEqual({ jobId: 'p1', via: 're-master' });
    expect(parseDerivedFrom({ jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: 0, muted: true } } }))
      .toEqual({ jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: 0, muted: true } } });
    expect(parseDerivedFrom(undefined)).toBeNull();
    expect(parseDerivedFrom({ jobId: 'p1', via: 'copy' })).toBeNull();
    expect(parseDerivedFrom({ via: 're-master' })).toBeNull();
  });
});

describe('lineageLabel', () => {
  it('names the parent, or says an earlier master when it is not loaded', () => {
    expect(lineageLabel({ jobId: 'p1', via: 'stem-remix' }, 'பாடல்')).toBe('Remix of பாடல்');
    expect(lineageLabel({ jobId: 'p1', via: 're-master' }, null)).toBe('Re-master of an earlier master');
  });
});
