/** @jest-environment node */
/**
 * Integration: the Video Text routes + VideoTextRepository + the real DynamoDB
 * protocol, against a throwaway DynamoDB Local. Only the edges that would leave
 * the machine are faked: admin auth, S3 and the Lambda invoke.
 *
 * What only this level catches: the PATCH expression really stores and clears
 * endTitles (and leaves it alone when an older tab omits it), the version
 * condition really refuses a stale save, the render claim really respects the
 * stored end titles, and the lyric-timing route's state machine runs on a real
 * project row.
 *
 * Runs ONLY when VIDEO_TEXT_IT_DDB names a LOCAL endpoint, e.g.
 *   docker run -d --rm --name poovaasam-it-ddb -p 127.0.0.1:18011:8000 amazon/dynamodb-local:3.3.1
 *   VIDEO_TEXT_IT_DDB=http://127.0.0.1:18011 NODE_OPTIONS=--no-experimental-strip-types \
 *     npx jest __tests__/integration/video-text-dynamodb.test.ts
 * Otherwise (CI, a normal `npm test`) the whole file is skipped.
 *
 * ⚠️ next/jest loads .env.local, which names the PRODUCTION table and real keys.
 * Everything below is overridden BEFORE any app module loads, and a guard
 * refuses to run unless the endpoint is localhost and the table is ours.
 */
import type { NextRequest } from 'next/server';

const ENDPOINT = process.env.VIDEO_TEXT_IT_DDB ?? '';
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(ENDPOINT);
const TABLE = `VideoTextIT-${Date.now()}`;
if (LOCAL) {
  process.env.AWS_ENDPOINT_URL_DYNAMODB = ENDPOINT;
  process.env.DYNAMODB_TABLE_NAME = TABLE;
  process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME = TABLE;
  process.env.APP_AWS_ACCESS_KEY_ID = 'local';
  process.env.APP_AWS_SECRET_ACCESS_KEY = 'local';
  process.env.AWS_ACCESS_KEY_ID = 'local';
  process.env.AWS_SECRET_ACCESS_KEY = 'local';
}

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn(async () => ({ email: 'it@test' })),
  requireBearer: jest.fn(),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: 401 })),
}));

/** S3, in memory. */
const bucket = new Map<string, string>();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    fileExists: jest.fn(async (k: string) => bucket.has(k)),
    getFile: jest.fn(async (k: string) => {
      if (!bucket.has(k)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return { transformToString: async () => bucket.get(k) };
    }),
    uploadFile: jest.fn(async ({ key, file }: { key: string; file: string }) => {
      bucket.set(key, String(file));
      return { key };
    }),
    deleteFile: jest.fn(async (k: string) => bucket.delete(k)),
    getSignedUploadPost: jest.fn(async (key: string) => ({ url: 'https://s3.local/upload', fields: { key } })),
    getSignedUrl: jest.fn(async () => 'https://s3.local/get'),
  },
}));

const invoked: Array<{ FunctionName: string; Payload: string }> = [];
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(async (cmd: { input: { FunctionName: string; Payload: Uint8Array } }) => {
      invoked.push({ FunctionName: cmd.input.FunctionName, Payload: Buffer.from(cmd.input.Payload).toString() });
      return { StatusCode: 202 };
    }),
  })),
  InvokeCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const describeIt = LOCAL ? describe : describe.skip;

describeIt('Video Text against DynamoDB Local', () => {
  // Loaded after the env above, so the client points at the local endpoint.
  let routes: {
    create: (r: NextRequest) => Promise<Response>;
    get: (r: NextRequest, c: unknown) => Promise<Response>;
    patch: (r: NextRequest, c: unknown) => Promise<Response>;
    render: (r: NextRequest, c: unknown) => Promise<Response>;
    overlays: (r: NextRequest, c: unknown) => Promise<Response>;
    ltGet: (r: NextRequest, c: unknown) => Promise<Response>;
    ltPost: (r: NextRequest, c: unknown) => Promise<Response>;
  };
  let repo: import('@/infrastructure/database/VideoTextRepository').VideoTextRepository;

  const req = (body?: unknown, method = 'POST') =>
    new Request('http://localhost/x', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) as unknown as NextRequest;
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(async () => {
    const { TABLE_NAME } = await import('@/infrastructure/database/dynamodb-client');
    if (TABLE_NAME !== TABLE || !process.env.AWS_ENDPOINT_URL_DYNAMODB?.startsWith('http://127.0.0.1')) {
      throw new Error(`refusing to run: table ${TABLE_NAME}, endpoint ${process.env.AWS_ENDPOINT_URL_DYNAMODB}`);
    }
    const { DynamoDBClient, CreateTableCommand, waitUntilTableExists } = await import('@aws-sdk/client-dynamodb');
    const raw = new DynamoDBClient({ region: 'ca-central-1', endpoint: ENDPOINT, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
    await raw.send(new CreateTableCommand({
      TableName: TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' }, { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' }, { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      GlobalSecondaryIndexes: [{
        IndexName: 'GSI1',
        KeySchema: [{ AttributeName: 'GSI1PK', KeyType: 'HASH' }, { AttributeName: 'GSI1SK', KeyType: 'RANGE' }],
        Projection: { ProjectionType: 'ALL' },
      }],
    }));
    await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName: TABLE });

    const list = await import('@/app/api/admin/video-text/route');
    const one = await import('@/app/api/admin/video-text/[id]/route');
    const render = await import('@/app/api/admin/video-text/[id]/render/route');
    const overlays = await import('@/app/api/admin/video-text/[id]/overlays/route');
    const lt = await import('@/app/api/admin/video-text/[id]/lyric-timing/route');
    routes = {
      create: list.POST as never, get: one.GET as never, patch: one.PATCH as never,
      render: render.POST as never, overlays: overlays.POST as never, ltGet: lt.GET as never, ltPost: lt.POST as never,
    };
    const { VideoTextRepository } = await import('@/infrastructure/database/VideoTextRepository');
    repo = new VideoTextRepository();
  }, 60_000);

  /** A new project with a 60 s video attached, through the real routes and repository. */
  async function projectWithVideo(name = 'IT song') {
    const res = await routes.create(req({ name }));
    expect(res.status).toBeLessThan(300);
    const { project } = await res.json();
    const now = Date.now();
    const key = `audio/mastering/video-text/${project.id}/source/${now}_ab12_song.mp4`;
    const attached = await repo.setSource(project.id, {
      key, width: 1280, height: 720, fps: 25, durationSec: 60, hasAudio: true,
      uploadedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 864e5).toISOString(),
    }, [], null, null);
    expect(attached.ok).toBe(true);
    const loaded = await (await routes.get(req(undefined, 'GET'), ctx(project.id))).json();
    return loaded.project;
  }
  const editsOf = (p: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    name: p.name, titleText: p.titleText ?? '', creditsText: p.creditsText ?? '', lyricsText: p.lyricsText ?? '',
    blocks: p.blocks ?? [], style: p.style ?? { sizeScale: 1, lyricPosition: 'lower' }, ...over,
  });

  it('PATCH stores end titles, an older tab that omits them keeps them, and null clears them', async () => {
    const p = await projectWithVideo();
    let res = await routes.patch(req({ edits: editsOf(p, { creditsText: 'Lyrics: Raj', endTitles: { atSec: 50, background: 'white' } }), version: p.version }, 'PATCH'), ctx(p.id));
    expect(res.status).toBe(200);
    let version = (await res.json()).version;
    let stored = await repo.get(p.id, { consistent: true });
    expect(stored?.endTitles).toEqual({ atSec: 50, background: 'white' });
    expect(stored?.creditsText).toBe('Lyrics: Raj');

    // A tab opened before end titles existed sends no endTitles key at all.
    res = await routes.patch(req({ edits: editsOf(p, { creditsText: 'Lyrics: Raj, Music: Raj' }), version }, 'PATCH'), ctx(p.id));
    version = (await res.json()).version;
    stored = await repo.get(p.id, { consistent: true });
    expect(stored?.endTitles).toEqual({ atSec: 50, background: 'white' });

    res = await routes.patch(req({ edits: editsOf(p, { endTitles: null }), version }, 'PATCH'), ctx(p.id));
    expect(res.status).toBe(200);
    expect((await repo.get(p.id, { consistent: true }))?.endTitles).toBeNull();
  });

  it('a stale version is refused and nothing is overwritten', async () => {
    const p = await projectWithVideo();
    const first = await routes.patch(req({ edits: editsOf(p, { titleText: 'A' }), version: p.version }, 'PATCH'), ctx(p.id));
    expect(first.status).toBe(200);
    const stale = await routes.patch(req({ edits: editsOf(p, { titleText: 'B', endTitles: { atSec: 10 } }), version: p.version }, 'PATCH'), ctx(p.id));
    expect(stale.status).toBe(409);
    const stored = await repo.get(p.id, { consistent: true });
    expect(stored?.titleText).toBe('A');
    expect(stored?.endTitles ?? null).toBeNull();
  });

  it('end titles that leave no room for the fade are refused, not stored', async () => {
    const p = await projectWithVideo();
    const res = await routes.patch(req({ edits: editsOf(p, { endTitles: { atSec: 59.5 } }), version: p.version }, 'PATCH'), ctx(p.id));
    expect(res.status).toBe(400);
    expect((await repo.get(p.id, { consistent: true }))?.version).toBe(p.version);
  });

  it('render: claims a project with valid end titles and presigns its _end layer; the claim is single-flight', async () => {
    const p = await projectWithVideo();
    const blocks = [{ id: 'cr1', track: 'credits', text: 'Lyrics: Raj', startSec: 50, endSec: 60 }];
    let res = await routes.patch(req({ edits: editsOf(p, { creditsText: 'Lyrics: Raj', blocks, endTitles: { atSec: 55 } }), version: p.version }, 'PATCH'), ctx(p.id));
    const { version } = await res.json();

    res = await routes.overlays(req({ renderId: 'rit1', blockIds: ['cr1', '_end'] }), ctx(p.id));
    expect(res.status).toBe(200);
    expect((await res.json()).uploads.map((u: { blockId: string }) => u.blockId)).toEqual(['cr1', '_end']);

    invoked.length = 0;
    res = await routes.render(req({ renderId: 'rit1', version }), ctx(p.id));
    expect(res.status).toBe(202);
    expect(invoked).toHaveLength(1);
    expect(JSON.parse(invoked[0].Payload)).toEqual({ videoTextRender: { projectId: p.id, renderId: 'rit1' } });
    expect((await repo.get(p.id, { consistent: true }))?.render.status).toBe('queued');

    // A second press while it is queued does not start another render.
    res = await routes.render(req({ renderId: 'rit2', version }), ctx(p.id));
    expect(res.status).toBe(409);
    expect(invoked).toHaveLength(1);
  });

  it('a shorter re-upload drops end titles past the new end, and the next save and render go through', async () => {
    const { fitEndTitlesToDuration } = await import('@/lib/video-text/end-titles');
    const p = await projectWithVideo();
    let res = await routes.patch(req({ edits: editsOf(p, { endTitles: { atSec: 50 } }), version: p.version }, 'PATCH'), ctx(p.id));
    expect(res.status).toBe(200);
    const before = await repo.get(p.id, { consistent: true });
    // What the source route does on a re-upload: refit, then write it with the new video.
    const now = Date.now();
    const shorter = { key: `audio/mastering/video-text/${p.id}/source/${now}_cd34_short.mp4`, width: 1280, height: 720, fps: 25, durationSec: 30, hasAudio: true,
      uploadedAt: new Date(now).toISOString(), expiresAt: new Date(now + 864e5).toISOString() };
    const fitted = fitEndTitlesToDuration(before!.endTitles, 30);
    expect(fitted).toBeNull();
    await repo.setSource(p.id, shorter, [], null, null, now, fitted);
    const after = await repo.get(p.id, { consistent: true });
    expect(after?.endTitles).toBeNull();

    // Before the fix every save carried the stale end titles and was refused; now a plain edit saves.
    res = await routes.patch(req({ edits: editsOf(after!, { titleText: 'typed after the re-upload', endTitles: after!.endTitles ?? null }), version: after!.version }, 'PATCH'), ctx(p.id));
    expect(res.status).toBe(200);
    invoked.length = 0;
    const r = await routes.render(req({ renderId: 'rit3', version: (await res.json()).version }), ctx(p.id));
    expect(r.status).toBe(202);
  });

  it('a re-upload keeps end titles that still fit', async () => {
    const p = await projectWithVideo();
    await routes.patch(req({ edits: editsOf(p, { endTitles: { atSec: 20, background: 'white' } }), version: p.version }, 'PATCH'), ctx(p.id));
    const now = Date.now();
    await repo.setSource(p.id, { key: `audio/mastering/video-text/${p.id}/source/${now}_ef56_b.mp4`, width: 1280, height: 720, fps: 25, durationSec: 30, hasAudio: true,
      uploadedAt: new Date(now).toISOString(), expiresAt: new Date(now + 864e5).toISOString() }, [], null, null, now, { atSec: 20, background: 'white' });
    expect((await repo.get(p.id, { consistent: true }))?.endTitles).toEqual({ atSec: 20, background: 'white' });
  });

  it('automatic lyric timing: start → running → words saved → align, on a real project row', async () => {
    const p = await projectWithVideo();
    invoked.length = 0;
    let res = await routes.ltGet(req(undefined, 'GET'), ctx(p.id));
    expect(await res.json()).toEqual({ status: 'idle' });

    res = await routes.ltPost(req({ op: 'start' }), ctx(p.id));
    expect(res.status).toBe(202);
    expect(invoked).toHaveLength(1);
    const payload = JSON.parse(invoked[0].Payload);
    expect(payload.sourceKey).toBe(p.source.key);
    expect(payload.wordsKey).toMatch(new RegExp(`^audio/mastering/lyric-timing/${p.id}/`));

    expect(await (await routes.ltGet(req(undefined, 'GET'), ctx(p.id))).json()).toMatchObject({ status: 'running' });

    // The worker finishes: it writes the words file.
    bucket.set(payload.wordsKey, JSON.stringify({
      durationSec: 60,
      words: [
        { start: 10, end: 10.6, word: 'பூவும்' }, { start: 10.6, end: 11.2, word: 'காற்றும்' },
        { start: 30, end: 30.6, word: 'தமிழும்' }, { start: 30.6, end: 31.2, word: 'இசையும்' },
      ],
    }));
    expect(await (await routes.ltGet(req(undefined, 'GET'), ctx(p.id))).json()).toEqual({ status: 'ready' });

    res = await routes.ltPost(req({ op: 'align', lyricsText: 'பூவும் காற்றும்\n\nதமிழும் இசையும்' }), ctx(p.id));
    expect(res.status).toBe(200);
    const { lines } = await res.json();
    expect(lines.map((l: { text: string }) => l.text)).toEqual(['பூவும் காற்றும்', 'தமிழும் இசையும்']);
    expect(lines[0].startSec).toBeCloseTo(10, 0);
    expect(lines[1].startSec).toBeCloseTo(30, 0);
    // Re-timing reuses the words: no second worker run.
    expect(invoked).toHaveLength(1);
  });
});
