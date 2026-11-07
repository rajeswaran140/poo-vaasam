/** @jest-environment node */
/** Video Text admin routes: auth, guards, version handling and worker events. */

const requireAdminMock = jest.fn().mockResolvedValue({ email: 'admin@test' });
const requireBearerMock = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  requireBearer: (...a: unknown[]) => requireBearerMock(...a),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: (err as { status?: number }).status ?? 401 })),
}));

const repo = {
  create: jest.fn(), get: jest.fn(), list: jest.fn(), saveEdits: jest.fn(),
  setSource: jest.fn(), startRender: jest.fn(), patchRender: jest.fn(),
};
jest.mock('@/infrastructure/database/VideoTextRepository', () => ({
  VideoTextRepository: jest.fn().mockImplementation(() => repo),
}));

const presignPost = jest.fn();
const presignGet = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    getSignedUploadPost: (...a: unknown[]) => presignPost(...a),
    getSignedUrl: (...a: unknown[]) => presignGet(...a),
  },
}));

const lambdaSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: jest.fn((args: unknown) => ({ args })),
}));
jest.mock('@/lib/aws-config', () => ({ awsConfig: { region: 'ca-central-1', credentials: undefined } }));

import type { NextRequest } from 'next/server';
import { GET as listGET, POST as createPOST } from '@/app/api/admin/video-text/route';
import { GET as loadGET, PATCH } from '@/app/api/admin/video-text/[id]/route';
import { POST as uploadPOST } from '@/app/api/admin/video-text/[id]/upload/route';
import { POST as sourcePOST } from '@/app/api/admin/video-text/[id]/source/route';
import { POST as overlaysPOST } from '@/app/api/admin/video-text/[id]/overlays/route';
import { POST as renderPOST } from '@/app/api/admin/video-text/[id]/render/route';
import { GET as downloadGET } from '@/app/api/admin/video-text/[id]/download/route';
import { MAX_VIDEO_TEXT_BYTES } from '@/lib/video-text/keys';
import { validateBlocks } from '@/lib/video-text/timeline';

const ID = 'p1';
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (body?: unknown, method = 'POST') =>
  new Request('http://localhost/x', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  }) as unknown as NextRequest;

const block = (id: string, s: number, e: number) => ({ id, track: 'lyric' as const, text: id, startSec: s, endSec: e });
const source = (over: Record<string, unknown> = {}) => ({
  key: `audio/mastering/video-text/${ID}/source/a.mp4`, width: 1920, height: 1080, fps: 30,
  durationSec: 60, hasAudio: true, uploadedAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2999-01-01T00:00:00.000Z', ...over,
});
const project = (over: Record<string, unknown> = {}) => ({
  id: ID, name: 'My Song', titleText: '', creditsText: '', lyricsText: '', blocks: [block('b1', 0, 5)],
  style: { sizeScale: 1, lyricPosition: 'lower' }, source: source(),
  render: { renderId: null, status: 'idle', progress: null, outputKey: null, outputExpiresAt: null, error: null, startedAt: null, updatedAt: null },
  version: 3, createdAt: '', updatedAt: '', ...over,
});
const edits = (blocks = [block('b1', 0, 5)]) => ({
  name: 'My Song', titleText: '', creditsText: '', lyricsText: '', blocks,
  style: { sizeScale: 1, lyricPosition: 'lower' },
});
const probePayload = (obj: unknown) => ({ Payload: Buffer.from(JSON.stringify(obj)) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdminMock.mockResolvedValue({ email: 'admin@test' });
  requireBearerMock.mockImplementation(() => undefined);
  repo.get.mockResolvedValue(project());
  presignPost.mockResolvedValue({ url: 'https://s3', fields: { a: 'b' } });
  presignGet.mockResolvedValue('https://s3/get');
  lambdaSend.mockResolvedValue({});
  repo.patchRender.mockResolvedValue(undefined);
});

describe('auth', () => {
  const mutating: [string, () => Promise<Response>][] = [
    ['create', () => createPOST(req({ name: 'x' }))],
    ['patch', () => PATCH(req({ edits: edits(), version: 3 }, 'PATCH'), ctx)],
    ['upload', () => uploadPOST(req({ filename: 'a.mp4', contentType: 'video/mp4', size: 10 }), ctx)],
    ['source', () => sourcePOST(req({ key: `audio/mastering/video-text/${ID}/source/a.mp4` }), ctx)],
    ['overlays', () => overlaysPOST(req({ renderId: 'r1', blockIds: ['b1'] }), ctx)],
    ['render', () => renderPOST(req({ renderId: 'r1', version: 3 }), ctx)],
  ];
  it.each(mutating)('%s rejects a non-admin', async (_n, call) => {
    requireAdminMock.mockRejectedValue({ status: 403 });
    expect((await call()).status).toBe(403);
    expect(repo.create).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });
  it.each(mutating)('%s rejects a missing bearer', async (_n, call) => {
    requireBearerMock.mockImplementation(() => { throw { status: 401 }; });
    expect((await call()).status).toBe(401);
    expect(repo.saveEdits).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });
  it('reads reject a non-admin', async () => {
    requireAdminMock.mockRejectedValue({ status: 403 });
    expect((await listGET(req(undefined, 'GET'))).status).toBe(403);
    expect((await loadGET(req(undefined, 'GET'), ctx)).status).toBe(403);
    expect((await downloadGET(req(undefined, 'GET'), ctx)).status).toBe(403);
  });
});

describe('create / list / load', () => {
  it('creates with 201', async () => {
    repo.create.mockResolvedValue(project());
    const res = await createPOST(req({ name: 'My Song' }));
    expect(res.status).toBe(201);
    expect((await res.json()).project.id).toBe(ID);
  });
  it('404s a missing project', async () => {
    repo.get.mockResolvedValue(null);
    expect((await loadGET(req(undefined, 'GET'), ctx)).status).toBe(404);
  });
});

describe('PATCH', () => {
  it('returns the new version', async () => {
    repo.saveEdits.mockResolvedValue({ ok: true, version: 4 });
    const res = await PATCH(req({ edits: edits(), version: 3 }, 'PATCH'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 4 });
  });
  it('409s a conflict', async () => {
    repo.saveEdits.mockResolvedValue({ ok: false, reason: 'conflict' });
    const res = await PATCH(req({ edits: edits(), version: 2 }, 'PATCH'), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('This project was changed in another tab — reload to see the latest.');
  });
  it('400s overlapping blocks', async () => {
    const res = await PATCH(req({ edits: edits([block('b1', 0, 5), block('b2', 3, 8)]), version: 3 }, 'PATCH'), ctx);
    expect(res.status).toBe(400);
    expect(repo.saveEdits).not.toHaveBeenCalled();
  });
  it('400s over-long text and too many blocks', async () => {
    const long = { ...edits(), lyricsText: 'x'.repeat(20001) };
    expect((await PATCH(req({ edits: long, version: 3 }, 'PATCH'), ctx)).status).toBe(400);
    const many = Array.from({ length: 401 }, (_, i) => block(`b${i}`, i, i + 0.5));
    expect((await PATCH(req({ edits: edits(many), version: 3 }, 'PATCH'), ctx)).status).toBe(400);
    const longBlock = { ...block('b1', 0, 5), text: 'x'.repeat(501) };
    expect((await PATCH(req({ edits: edits([longBlock]), version: 3 }, 'PATCH'), ctx)).status).toBe(400);
  });
});

describe('upload', () => {
  it('refuses 1 GB + 1 byte', async () => {
    const res = await uploadPOST(req({ filename: 'a.mp4', contentType: 'video/mp4', size: MAX_VIDEO_TEXT_BYTES + 1 }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Videos up to 1 GB can be used.');
    expect(presignPost).not.toHaveBeenCalled();
  });
  it('refuses other content types', async () => {
    expect((await uploadPOST(req({ filename: 'a.avi', contentType: 'video/x-msvideo', size: 10 }), ctx)).status).toBe(400);
  });
  it('presigns a key inside the project', async () => {
    const res = await uploadPOST(req({ filename: 'a.mp4', contentType: 'video/mp4', size: 10 }), ctx);
    const body = await res.json();
    expect(body.key.startsWith(`audio/mastering/video-text/${ID}/`)).toBe(true);
    expect(presignPost.mock.calls[0][1]).toBe('video/mp4');
    expect(presignPost.mock.calls[0][2]).toBe(MAX_VIDEO_TEXT_BYTES);
  });
});

describe('source', () => {
  const key = `audio/mastering/video-text/${ID}/source/a.mp4`;
  const info = { width: 1920, height: 1080, fps: 30, durationSec: 60, hasAudio: true };
  it('refuses a key from another project', async () => {
    const res = await sourcePOST(req({ key: 'audio/mastering/video-text/other/source/a.mp4' }), ctx);
    expect(res.status).toBe(400);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
  it('probes, stores and returns version', async () => {
    lambdaSend.mockResolvedValue(probePayload({ ok: true, info }));
    repo.setSource.mockResolvedValue({ ok: true, version: 4, durationSec: 60 });
    const res = await sourcePOST(req({ key }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(4);
    expect(body.source).toMatchObject({ key, ...info });
    expect(body.source.expiresAt > body.source.uploadedAt).toBe(true);
    const cmd = lambdaSend.mock.calls[0][0] as { args: { InvocationType: string; Payload: Buffer } };
    expect(cmd.args.InvocationType).toBe('RequestResponse');
    expect(JSON.parse(cmd.args.Payload.toString())).toEqual({ videoTextProbe: { key } });
  });
  it('F1: floors the probed length once, builds blocks on it and returns the stored value', async () => {
    repo.get.mockResolvedValue(project({ blocks: [], titleText: 'T', creditsText: 'C', lyricsText: 'a\nb\nc' }));
    lambdaSend.mockResolvedValue(probePayload({ ok: true, info: { ...info, durationSec: 128.149 } }));
    repo.setSource.mockImplementation(async (_id: string, s: { durationSec: number }) => ({ ok: true, version: 4, durationSec: s.durationSec }));
    const res = await sourcePOST(req({ key }), ctx);
    const body = await res.json();
    const [, storedSource, storedBlocks] = repo.setSource.mock.calls[0];
    expect(storedSource.durationSec).toBe(128.14);
    expect(body.source.durationSec).toBe(128.14);
    expect(Math.max(...storedBlocks.map((b: { endSec: number }) => b.endSec))).toBe(128.14);
    expect(validateBlocks(body.blocks, body.source.durationSec)).toBeNull();
  });
  it('F4: 409s while a render is running, and 404s a project deleted meanwhile', async () => {
    lambdaSend.mockResolvedValue(probePayload({ ok: true, info }));
    repo.setSource.mockResolvedValue({ ok: false, reason: 'rendering' });
    let res = await sourcePOST(req({ key }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('A render is running — wait for it to finish before uploading a new video.');
    repo.setSource.mockResolvedValue({ ok: false, reason: 'missing' });
    res = await sourcePOST(req({ key }), ctx);
    expect(res.status).toBe(404);
  });
  it('503s a throttle', async () => {
    lambdaSend.mockRejectedValue(Object.assign(new Error('x'), { name: 'TooManyRequestsException' }));
    const res = await sourcePOST(req({ key }), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('The video worker is busy — try again in a minute.');
  });
  it('422s a probe failure with its message, or the fallback', async () => {
    lambdaSend.mockResolvedValue(probePayload({ ok: false, message: 'No video stream.' }));
    let res = await sourcePOST(req({ key }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('No video stream.');
    lambdaSend.mockResolvedValue({ FunctionError: 'Unhandled', Payload: Buffer.from('{}') });
    res = await sourcePOST(req({ key }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('This video could not be read.');
    expect(repo.setSource).not.toHaveBeenCalled();
  });
});

describe('overlays', () => {
  it('presigns PNGs for known blocks only', async () => {
    const res = await overlaysPOST(req({ renderId: 'r1', blockIds: ['b1'] }), ctx);
    const body = await res.json();
    expect(body.uploads[0]).toMatchObject({ blockId: 'b1', key: `audio/mastering/video-text/${ID}/render-r1/overlay-b1.png` });
    expect(presignPost.mock.calls[0][1]).toBe('image/png');
    expect(presignPost.mock.calls[0][2]).toBe(5 * 1024 * 1024);
  });
  it('F2: reads the project strongly consistent (it follows the pre-render save)', async () => {
    await overlaysPOST(req({ renderId: 'r1', blockIds: ['b1'] }), ctx);
    expect(repo.get).toHaveBeenCalledWith(ID, { consistent: true });
  });
  it('400s an unknown block', async () => {
    const res = await overlaysPOST(req({ renderId: 'r1', blockIds: ['nope'] }), ctx);
    expect(res.status).toBe(400);
    expect(presignPost).not.toHaveBeenCalled();
  });
});

describe('render', () => {
  it('410s an expired source', async () => {
    repo.get.mockResolvedValue(project({ source: source({ expiresAt: '2000-01-01T00:00:00.000Z' }) }));
    const res = await renderPOST(req({ renderId: 'r1', version: 3 }), ctx);
    expect(res.status).toBe(410);
    expect(repo.startRender).not.toHaveBeenCalled();
  });
  it('409s when a render is already running', async () => {
    repo.startRender.mockResolvedValue({ ok: false, reason: 'busy' });
    const res = await renderPOST(req({ renderId: 'r1', version: 3 }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('A render is already running.');
    expect(lambdaSend).not.toHaveBeenCalled();
  });
  it('F2: reads the project strongly consistent (it follows the pre-render save)', async () => {
    repo.startRender.mockResolvedValue({ ok: true });
    await renderPOST(req({ renderId: 'r1', version: 3 }), ctx);
    expect(repo.get).toHaveBeenCalledWith(ID, { consistent: true });
  });
  it('F10: passes the drawn version to the claim', async () => {
    repo.startRender.mockResolvedValue({ ok: true });
    await renderPOST(req({ renderId: 'r1', version: 3 }), ctx);
    expect(repo.startRender).toHaveBeenCalledWith(ID, 'r1', 3);
  });
  it('F10: 409s a version the project has moved past (read or claim), without invoking', async () => {
    const changed = 'This project was changed in another tab — reload, then press Make video again.';
    let res = await renderPOST(req({ renderId: 'r1', version: 2 }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(changed);
    expect(repo.startRender).not.toHaveBeenCalled();
    repo.startRender.mockResolvedValue({ ok: false, reason: 'changed' });
    res = await renderPOST(req({ renderId: 'r1', version: 3 }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(changed);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
  it('F10: 400s a render request without a version', async () => {
    expect((await renderPOST(req({ renderId: 'r1' }), ctx)).status).toBe(400);
  });
  it('sends an Event invoke with the exact payload', async () => {
    repo.startRender.mockResolvedValue({ ok: true });
    const res = await renderPOST(req({ renderId: 'r1', version: 3 }), ctx);
    expect(res.status).toBe(202);
    const cmd = lambdaSend.mock.calls[0][0] as { args: { InvocationType: string; Payload: Buffer } };
    expect(cmd.args.InvocationType).toBe('Event');
    expect(JSON.parse(cmd.args.Payload.toString())).toEqual({ videoTextRender: { projectId: ID, renderId: 'r1' } });
  });
  it('marks the render errored and 502s when the invoke fails', async () => {
    repo.startRender.mockResolvedValue({ ok: true });
    lambdaSend.mockRejectedValue(new Error('boom'));
    const res = await renderPOST(req({ renderId: 'r1', version: 3 }), ctx);
    expect(res.status).toBe(502);
    expect(repo.patchRender).toHaveBeenCalledWith(ID, 'r1', { status: 'error', error: 'The render could not be started — try again.' });
  });
});

describe('download', () => {
  it('presigns for 15 minutes with a sanitised name', async () => {
    const out = `audio/mastering/video-text/${ID}/render-r1/output.mp4`;
    repo.get.mockResolvedValue(project({ name: 'A/B "song"', render: { ...project().render, status: 'done', outputKey: out } }));
    const res = await downloadGET(req(undefined, 'GET'), ctx);
    expect(await res.json()).toEqual({ url: 'https://s3/get' });
    expect(presignGet).toHaveBeenCalledWith(out, 900, 'A B song-text.mp4');
  });
});
