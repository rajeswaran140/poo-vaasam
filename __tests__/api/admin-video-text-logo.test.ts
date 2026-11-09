/** @jest-environment node */
/** The saved logo: its route, the PATCH logo settings and the logo overlay upload. */

const requireAdminMock = jest.fn().mockResolvedValue({ email: 'admin@test' });
const requireBearerMock = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  requireBearer: (...a: unknown[]) => requireBearerMock(...a),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: (err as { status?: number }).status ?? 401 })),
}));

const repo = { get: jest.fn(), saveEdits: jest.fn() };
const logoRepo = { get: jest.fn(), set: jest.fn() };
jest.mock('@/infrastructure/database/VideoTextRepository', () => ({
  VideoTextRepository: jest.fn().mockImplementation(() => repo),
  VideoTextLogoRepository: jest.fn().mockImplementation(() => logoRepo),
}));

const presignPost = jest.fn();
const presignGet = jest.fn();
const contentLength = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    getSignedUploadPost: (...a: unknown[]) => presignPost(...a),
    getSignedUrl: (...a: unknown[]) => presignGet(...a),
    getContentLength: (...a: unknown[]) => contentLength(...a),
  },
}));

import type { NextRequest } from 'next/server';
import { GET as logoGET, POST as logoPOST, PUT as logoPUT } from '@/app/api/admin/video-text/logo/route';
import { PATCH } from '@/app/api/admin/video-text/[id]/route';
import { POST as overlaysPOST } from '@/app/api/admin/video-text/[id]/overlays/route';
import { LOGO_OVERLAY_ID, MAX_LOGO_BYTES } from '@/lib/video-text/logo';

const ID = 'p1';
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (body?: unknown, method = 'POST') =>
  new Request('http://localhost/x', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  }) as unknown as NextRequest;
const KEY = 'audio/mastering/video-text-logo/1700000000000_abc123.png';
const SAVED = { key: KEY, contentType: 'image/png', width: 800, height: 800, uploadedAt: '2026-11-09T00:00:00.000Z' };
const project = (style: Record<string, unknown> = {}) => ({
  id: ID, name: 'S', titleText: '', creditsText: '', lyricsText: '',
  blocks: [{ id: 'b1', track: 'lyric', text: 'x', startSec: 0, endSec: 5 }],
  style: { sizeScale: 1, lyricPosition: 'lower', ...style }, source: null,
  render: { renderId: null, status: 'idle' }, version: 3,
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAdminMock.mockResolvedValue({ email: 'admin@test' });
  requireBearerMock.mockImplementation(() => undefined);
  presignPost.mockResolvedValue({ url: 'https://s3', fields: { a: 'b' } });
  presignGet.mockResolvedValue('https://s3/get');
  contentLength.mockResolvedValue(1000);
  logoRepo.get.mockResolvedValue(null);
  repo.get.mockResolvedValue(project());
  repo.saveEdits.mockResolvedValue({ ok: true, version: 4 });
});

describe('logo route', () => {
  it('needs an admin; writes also need the bearer token', async () => {
    requireAdminMock.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 401 }));
    expect((await logoGET(req(undefined, 'GET'))).status).toBe(401);
    requireBearerMock.mockImplementationOnce(() => { throw Object.assign(new Error('csrf'), { status: 403 }); });
    expect((await logoPOST(req({ contentType: 'image/png' }))).status).toBe(403);
    requireBearerMock.mockImplementationOnce(() => { throw Object.assign(new Error('csrf'), { status: 403 }); });
    expect((await logoPUT(req({ key: KEY, width: 1, height: 1 }, 'PUT'))).status).toBe(403);
  });

  it('GET: null when none is saved, else the logo with a fresh link', async () => {
    expect(await (await logoGET(req(undefined, 'GET'))).json()).toEqual({ logo: null });
    logoRepo.get.mockResolvedValue(SAVED);
    expect(await (await logoGET(req(undefined, 'GET'))).json()).toEqual({ logo: { ...SAVED, url: 'https://s3/get' } });
    expect(presignGet).toHaveBeenCalledWith(KEY, 3600);
  });

  it('POST: presigns a PNG/JPG/WebP up to 5 MB under the kept logo folder, refuses other types', async () => {
    const res = await logoPOST(req({ contentType: 'image/webp' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.key).toMatch(/^audio\/mastering\/video-text-logo\/\d+_[A-Za-z0-9]+\.webp$/);
    expect(presignPost).toHaveBeenCalledWith(body.key, 'image/webp', MAX_LOGO_BYTES, expect.any(Number), 1);
    expect((await logoPOST(req({ contentType: 'image/svg+xml' }))).status).toBe(400);
  });

  it('PUT: saves an uploaded logo key, refuses a foreign key or a missing file', async () => {
    const ok = await logoPUT(req({ key: KEY, width: 800, height: 800 }, 'PUT'));
    expect(ok.status).toBe(200);
    expect(logoRepo.set).toHaveBeenCalledWith(expect.objectContaining({ key: KEY, contentType: 'image/png', width: 800, height: 800 }));
    expect((await logoPUT(req({ key: 'audio/mastering/video-text/p1/x.png', width: 1, height: 1 }, 'PUT'))).status).toBe(400);
    contentLength.mockResolvedValueOnce(null);
    expect((await logoPUT(req({ key: KEY, width: 1, height: 1 }, 'PUT'))).status).toBe(400);
    contentLength.mockResolvedValueOnce(MAX_LOGO_BYTES + 1);
    expect((await logoPUT(req({ key: KEY, width: 1, height: 1 }, 'PUT'))).status).toBe(400);
    expect(logoRepo.set).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH logo settings', () => {
  const edits = (logo: unknown) => ({
    name: 'S', titleText: '', creditsText: '', lyricsText: '',
    blocks: [{ id: 'b1', track: 'lyric', text: 'x', startSec: 0, endSec: 5 }],
    style: { sizeScale: 1, lyricPosition: 'lower', logo },
  });
  it('saves valid settings', async () => {
    const logo = { show: true, corner: 'top-left', heightPct: 12.5, opacity: 0.6, offset: { x: 0.01, y: -0.02 } };
    const res = await PATCH(req({ version: 3, edits: edits(logo) }, 'PATCH'), ctx);
    expect(res.status).toBe(200);
    expect(repo.saveEdits.mock.calls[0][1].style.logo).toEqual(logo);
  });
  it.each([
    [{ corner: 'centre' }],
    [{ heightPct: 0 }],
    [{ heightPct: 101 }],
    [{ opacity: 0.05 }],
    [{ offset: { x: 2, y: 0 } }],
  ])('refuses %j', async (logo) => {
    expect((await PATCH(req({ version: 3, edits: edits(logo) }, 'PATCH'), ctx)).status).toBe(400);
  });
});

describe('logo overlay upload', () => {
  it('presigns the logo PNG only when the project shows the logo', async () => {
    const body = { renderId: 'r1', blockIds: ['b1', LOGO_OVERLAY_ID] };
    expect((await overlaysPOST(req(body), ctx)).status).toBe(400);
    repo.get.mockResolvedValue(project({ logo: { show: true } }));
    const res = await overlaysPOST(req(body), ctx);
    expect(res.status).toBe(200);
    const { uploads } = await res.json();
    expect(uploads.map((u: { key: string }) => u.key)).toEqual([
      `audio/mastering/video-text/${ID}/render-r1/overlay-b1.png`,
      `audio/mastering/video-text/${ID}/render-r1/overlay-${LOGO_OVERLAY_ID}.png`,
    ]);
  });
});
