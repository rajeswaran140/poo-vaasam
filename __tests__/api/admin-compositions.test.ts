/** @jest-environment node */
/**
 * /api/admin/compositions — admin gate, CSRF bearer requirement, validation,
 * and the separation between saving and versioning.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockUpdate = jest.fn();
const mockAddVersion = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/infrastructure/database/CompositionRepository', () => ({
  CompositionRepository: jest.fn().mockImplementation(() => ({
    list: mockList,
    create: mockCreate,
    findById: mockFindById,
    update: mockUpdate,
    addVersion: mockAddVersion,
    delete: mockDelete,
  })),
}));

import { GET as LIST, POST as CREATE } from '@/app/api/admin/compositions/route';
import { GET as SHOW, PUT, DELETE } from '@/app/api/admin/compositions/[id]/route';
import { POST as ADD_VERSION } from '@/app/api/admin/compositions/[id]/versions/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const BEARER = { Authorization: 'Bearer test-token' };
const URL_BASE = 'https://tamilagaval.com/api/admin/compositions';
const ctx = (id = 'cmp_1') => ({ params: Promise.resolve({ id }) });

const req = (method: string, body?: unknown, withBearer = true) =>
  new NextRequest(URL_BASE, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: withBearer ? BEARER : undefined,
  });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ email: 'raj@example.com' });
});

describe('authorization', () => {
  it('rejects a request that is not from an admin', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }));
    expect((await LIST(new NextRequest(URL_BASE))).status).toBe(401);
  });

  /** Defense-in-depth CSRF: cookie-only auth must not mutate. */
  it('rejects a mutation without a bearer token', async () => {
    const res = await CREATE(req('POST', { title: 'மழை' }, false));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a version write without a bearer token', async () => {
    const res = await ADD_VERSION(req('POST', {}, false), ctx());
    expect(res.status).toBe(401);
    expect(mockAddVersion).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('400s a composition with no title', async () => {
    expect((await CREATE(req('POST', { spec: {} }))).status).toBe(400);
  });

  it('400s an out-of-range tempo rather than storing it', async () => {
    const res = await CREATE(req('POST', { title: 'x', spec: { bpm: 5000 } }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('400s a malformed id before touching the database', async () => {
    const res = await PUT(req('PUT', { title: 'x' }), ctx('not-an-id'));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('400s an empty update', async () => {
    expect((await PUT(req('PUT', {}), ctx())).status).toBe(400);
  });
});

describe('reading', () => {
  it('lists compositions', async () => {
    mockList.mockResolvedValueOnce([{ id: 'cmp_1', title: 'மழை', status: 'idea', versionCount: 2, updatedAt: new Date() }]);
    const res = await LIST(new NextRequest(URL_BASE));
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(1);
  });

  it('404s an unknown composition', async () => {
    mockFindById.mockResolvedValueOnce(null);
    expect((await SHOW(new NextRequest(URL_BASE), ctx())).status).toBe(404);
  });
});

/** ⚠️ §16 — saving and versioning are different acts, on different endpoints. */
describe('saving is not versioning', () => {
  it('PUT updates the working state and creates NO version', async () => {
    mockUpdate.mockResolvedValueOnce({ id: 'cmp_1', title: 'மழை', versions: [] });
    const res = await PUT(req('PUT', { spec: { bpm: 96 } }), ctx());
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('cmp_1', { spec: { bpm: 96 } });
    expect(mockAddVersion).not.toHaveBeenCalled();
  });

  it('a version is only created by the versions endpoint', async () => {
    mockAddVersion.mockResolvedValueOnce({ id: 'cmp_1', versions: [{ version: 1, label: 'V1' }] });
    const res = await ADD_VERSION(req('POST', { label: 'Final' }), ctx());
    expect(res.status).toBe(201);
    expect(mockAddVersion).toHaveBeenCalledWith('cmp_1', { label: 'Final' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('accepts an empty version body — snapshot whatever is current', async () => {
    mockAddVersion.mockResolvedValueOnce({ id: 'cmp_1', versions: [] });
    expect((await ADD_VERSION(req('POST', {}), ctx())).status).toBe(201);
  });

  it('404s a version write against a composition that does not exist', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAddVersion.mockRejectedValueOnce(new Error('Composition cmp_1 not found'));
    expect((await ADD_VERSION(req('POST', {}), ctx())).status).toBe(404);
  });
});

describe('delete', () => {
  it('removes the composition', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('cmp_1');
  });

  it('requires a bearer token', async () => {
    expect((await DELETE(req('DELETE', undefined, false), ctx())).status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
