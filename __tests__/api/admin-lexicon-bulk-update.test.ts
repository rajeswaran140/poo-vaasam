/** @jest-environment node */
/**
 * POST /api/admin/lexicon/bulk-update — apply one change to many entries.
 *
 * Two behaviours carry the weight: themes must ADD rather than replace (a
 * wholesale set across 200 rows would silently erase what each already had),
 * and partial failure must be REPORTED rather than reported as success.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockUpdate = jest.fn();
const mockFindById = jest.fn();
jest.mock('@/infrastructure/database/LexiconRepository', () => ({
  LexiconRepository: jest.fn().mockImplementation(() => ({
    update: mockUpdate,
    findById: mockFindById,
  })),
}));

import { POST } from '@/app/api/admin/lexicon/bulk-update/route';
import * as auth from '@/lib/auth-helper';
import { BULK_UPDATE_MAX_IDS } from '@/types/lexicon';

const requireAdmin = auth.requireAdmin as jest.Mock;
const post = (body: unknown, withBearer = true) =>
  POST(new NextRequest('https://tamilagaval.com/api/admin/lexicon/bulk-update', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: withBearer ? { Authorization: 'Bearer t' } : undefined,
  }));

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ email: 'raj@example.com' });
  mockUpdate.mockResolvedValue({});
});

describe('authorization', () => {
  it('rejects a non-admin', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
    expect((await post({ ids: ['lex_1'], usage: 'fresh' })).status).toBe(401);
  });

  it('rejects cookie-only auth on this mutation', async () => {
    const res = await post({ ids: ['lex_1'], usage: 'fresh' }, false);
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('400s when nothing would change', async () => {
    const res = await post({ ids: ['lex_1'] });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('400s an empty id list', async () => {
    expect((await post({ ids: [], usage: 'fresh' })).status).toBe(400);
  });

  it('400s beyond the id cap rather than accepting an unbounded write', async () => {
    const ids = Array.from({ length: BULK_UPDATE_MAX_IDS + 1 }, (_, i) => `lex_${i}`);
    expect((await post({ ids, usage: 'fresh' })).status).toBe(400);
  });

  it('rejects a register outside the taxonomy', async () => {
    expect((await post({ ids: ['lex_1'], registers: ['gorgeous'] })).status).toBe(400);
  });

  it('migrates a legacy value forward instead of rejecting it', async () => {
    const res = await post({ ids: ['lex_1'], usage: 'retire' });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('lex_1', { usage: 'overused' });
  });
});

describe('applying a change', () => {
  it('applies the same field to every id', async () => {
    const res = await post({ ids: ['lex_1', 'lex_2'], registers: ['modern-poetic'], confidence: 'high' });
    expect((await res.json()).updated).toBe(2);
    expect(mockUpdate).toHaveBeenCalledWith('lex_1', { registers: ['modern-poetic'], confidence: 'high' });
    expect(mockUpdate).toHaveBeenCalledWith('lex_2', { registers: ['modern-poetic'], confidence: 'high' });
  });

  it('does not read entries when no theme change is requested', async () => {
    await post({ ids: ['lex_1'], usage: 'fresh' });
    expect(mockFindById).not.toHaveBeenCalled();
  });
});

/** ⚠️ Adding a theme must not erase the themes an entry already carries. */
describe('themes add, they do not replace', () => {
  it('merges the new theme into each entry’s existing list', async () => {
    mockFindById.mockResolvedValue({ id: 'lex_1', themes: ['love', 'memory'] });
    await post({ ids: ['lex_1'], addThemes: ['nature'] });
    expect(mockUpdate).toHaveBeenCalledWith('lex_1', { themes: ['love', 'memory', 'nature'] });
  });

  it('does not duplicate a theme the entry already has', async () => {
    mockFindById.mockResolvedValue({ id: 'lex_1', themes: ['nature'] });
    await post({ ids: ['lex_1'], addThemes: ['nature'] });
    expect(mockUpdate).toHaveBeenCalledWith('lex_1', { themes: ['nature'] });
  });

  it('removes only the named theme', async () => {
    mockFindById.mockResolvedValue({ id: 'lex_1', themes: ['love', 'nature'] });
    await post({ ids: ['lex_1'], removeThemes: ['love'] });
    expect(mockUpdate).toHaveBeenCalledWith('lex_1', { themes: ['nature'] });
  });

  it('reads each entry separately, so two rows keep their own themes', async () => {
    mockFindById
      .mockResolvedValueOnce({ id: 'lex_1', themes: ['love'] })
      .mockResolvedValueOnce({ id: 'lex_2', themes: ['sorrow'] });
    await post({ ids: ['lex_1', 'lex_2'], addThemes: ['nature'] });
    expect(mockUpdate).toHaveBeenCalledWith('lex_1', { themes: ['love', 'nature'] });
    expect(mockUpdate).toHaveBeenCalledWith('lex_2', { themes: ['sorrow', 'nature'] });
  });

  /** There is deliberately no way to say "replace the themes on all of these". */
  it('offers no wholesale theme replacement', async () => {
    const res = await post({ ids: ['lex_1'], themes: ['nature'] });
    expect(res.status).toBe(400); // `themes` is not an accepted bulk field
  });
});

/** ⚠️ "Updated 140 of 200" is the truth; a green tick would not be. */
describe('partial failure is reported, not swallowed', () => {
  it('reports which ids failed and does not claim success', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('throttled'));
    const res = await post({ ids: ['lex_ok', 'lex_bad'], usage: 'fresh' });
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.updated).toBe(1);
    expect(body.requested).toBe(2);
    expect(body.failed).toEqual(['lex_bad']);
  });

  it('keeps going after one entry fails rather than aborting the rest', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdate.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({});
    const body = await (await post({ ids: ['lex_bad', 'lex_ok'], usage: 'fresh' })).json();
    expect(body.updated).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('counts an entry that vanished mid-edit as failed', async () => {
    mockFindById.mockResolvedValueOnce(null);
    const body = await (await post({ ids: ['lex_gone'], addThemes: ['nature'] })).json();
    expect(body.failed).toEqual(['lex_gone']);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reports success only when everything applied', async () => {
    const body = await (await post({ ids: ['lex_1', 'lex_2'], usage: 'fresh' })).json();
    expect(body.success).toBe(true);
    expect(body.failed).toEqual([]);
  });
});
