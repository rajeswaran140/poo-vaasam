/** @jest-environment node */
/** scenes / shots / characters edit routes and the private character-reference upload. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  loadTree: jest.fn(),
  putScene: jest.fn(),
  deleteScene: jest.fn(),
  putShot: jest.fn(),
  deleteShot: jest.fn(),
  reorderShots: jest.fn(),
  putCharacter: jest.fn(),
  addCharacterRef: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockPresign = jest.fn();
const mockLength = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    getSignedUploadPost: (...a: unknown[]) => mockPresign(...a),
    getContentLength: (...a: unknown[]) => mockLength(...a),
  },
}));

import { POST as scenesPOST } from '@/app/api/admin/visual-story/[vsId]/scenes/route';
import { POST as shotsPOST } from '@/app/api/admin/visual-story/[vsId]/shots/route';
import { POST as charsPOST } from '@/app/api/admin/visual-story/[vsId]/characters/route';
import { POST as uploadPOST } from '@/app/api/admin/visual-story/[vsId]/characters/[charId]/upload/route';
import * as auth from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { InvalidReorderError, NotFoundError } from '@/infrastructure/database/VisualStoryRepository';
import { refKey, MAX_REF_BYTES } from '@/lib/visual-story-storage';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const CH = 'ch_1700000000000_abcdef12';
const CH2 = 'ch_1700000000001_abcdef12';
const bearer = { Authorization: 'Bearer t' };

const mk = (body: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: withBearer ? bearer : undefined,
  });
const ctx = (id = VS) => ({ params: Promise.resolve({ vsId: id }) });
const uctx = (vs = VS, ch = CH) => ({ params: Promise.resolve({ vsId: vs, charId: ch }) });

const shot = (sceneOrder: number, shotOrder: number, durationSec: number) => ({
  sceneOrder,
  shotOrder,
  mode: 'STILL',
  durationSec,
  startSec: 0,
  visualPrompt: 'A lamp',
  negativePrompt: '',
  charIds: [],
  selectedCandidateId: null,
});
const tree = (over: Record<string, unknown> = {}) => ({
  story: { vsId: VS, windowStartSec: 0, windowEndSec: 30 },
  scenes: [{ order: 1, heading: 'Scene 1', summary: '' }],
  shots: [shot(1, 1, 10), shot(1, 2, 10)],
  characters: [{ charId: CH, name: 'Test', description: '', refImageKeys: [], createdAt: 't' }],
  candidates: [],
  drafts: [],
  ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  repo.loadTree.mockResolvedValue(tree());
});

describe('every mutation without bearer is 401', () => {
  it('scenes, shots, characters, upload', async () => {
    expect((await scenesPOST(mk({ op: 'create', heading: 'x', summary: '' }, false), ctx())).status).toBe(401);
    expect((await shotsPOST(mk({ op: 'delete', sceneOrder: 1, shotOrder: 1 }, false), ctx())).status).toBe(401);
    expect((await charsPOST(mk({ op: 'create', name: 'a', description: '' }, false), ctx())).status).toBe(401);
    expect((await uploadPOST(mk({ op: 'presign', contentType: 'image/png' }, false), uctx())).status).toBe(401);
    expect((await uploadPOST(mk({ op: 'confirm', key: 'k' }, false), uctx())).status).toBe(401);
    expect(repo.putScene).not.toHaveBeenCalled();
    expect(repo.deleteShot).not.toHaveBeenCalled();
    expect(repo.putCharacter).not.toHaveBeenCalled();
    expect(mockPresign).not.toHaveBeenCalled();
  });
  it('non-admin is refused', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    expect((await scenesPOST(mk({ op: 'delete', order: 1 }), ctx())).status).toBe(403);
  });
});

describe('ids in the path are validated', () => {
  it('404 on a malformed vsId or charId', async () => {
    expect((await scenesPOST(mk({ op: 'delete', order: 1 }), ctx('../x'))).status).toBe(404);
    expect((await uploadPOST(mk({ op: 'presign', contentType: 'image/png' }), uctx(VS, '../x'))).status).toBe(404);
    expect(repo.loadTree).not.toHaveBeenCalled();
  });
  it('404 when the story is gone', async () => {
    repo.loadTree.mockResolvedValue(null);
    expect((await scenesPOST(mk({ op: 'create', heading: 'x', summary: '' }), ctx())).status).toBe(404);
  });
});

describe('scenes', () => {
  it('create appends at max order + 1', async () => {
    const res = await scenesPOST(mk({ op: 'create', heading: ' Scene 2 ', summary: 's' }), ctx());
    expect(res.status).toBe(201);
    expect(repo.putScene).toHaveBeenCalledWith(VS, { order: 2, heading: 'Scene 2', summary: 's' });
  });
  it('create validates the heading', async () => {
    expect((await scenesPOST(mk({ op: 'create', heading: '  ', summary: '' }), ctx())).status).toBe(400);
    expect(repo.putScene).not.toHaveBeenCalled();
  });
  it('update merges onto the existing scene and 404s on an unknown one', async () => {
    const res = await scenesPOST(mk({ op: 'update', order: 1, summary: 'new' }), ctx());
    expect(res.status).toBe(200);
    expect(repo.putScene).toHaveBeenCalledWith(VS, { order: 1, heading: 'Scene 1', summary: 'new' });
    expect((await scenesPOST(mk({ op: 'update', order: 9, summary: 'x' }), ctx())).status).toBe(404);
  });
  it('delete cascades through the repository and reports tiling', async () => {
    repo.loadTree
      .mockResolvedValueOnce(tree())
      .mockResolvedValueOnce(tree({ shots: [] }));
    const res = await scenesPOST(mk({ op: 'delete', order: 1 }), ctx());
    expect(res.status).toBe(200);
    expect(repo.deleteScene).toHaveBeenCalledWith(VS, 1);
    const body = await res.json();
    expect(body.data.tiling).toEqual({ totalSec: 0, windowSec: 30, tiles: false });
  });
  it('rate limits mutations', async () => {
    let last = 200;
    for (let i = 0; i < 21; i++) {
      last = (await scenesPOST(mk({ op: 'update', order: 1, summary: 'x' }), ctx())).status;
    }
    expect(last).toBe(429);
  });
});

describe('shots', () => {
  const create = { op: 'create', sceneOrder: 1, mode: 'MOTION', durationSec: 5, visualPrompt: ' A path ' };

  it('create appends within the scene with defaults and returns tiling', async () => {
    const res = await shotsPOST(mk(create), ctx());
    expect(res.status).toBe(201);
    expect(repo.putShot).toHaveBeenCalledWith(
      VS,
      expect.objectContaining({
        sceneOrder: 1,
        shotOrder: 3,
        mode: 'MOTION',
        durationSec: 5,
        visualPrompt: 'A path',
        negativePrompt: '',
        charIds: [],
        selectedCandidateId: null,
      })
    );
    const body = await res.json();
    expect(body.data.tiling).toEqual({ totalSec: 20, windowSec: 30, tiles: false });
  });
  it('create refuses an unknown scene and unknown characters', async () => {
    expect((await shotsPOST(mk({ ...create, sceneOrder: 7 }), ctx())).status).toBe(404);
    expect((await shotsPOST(mk({ ...create, charIds: [CH2] }), ctx())).status).toBe(400);
    expect(repo.putShot).not.toHaveBeenCalled();
    expect((await shotsPOST(mk({ ...create, charIds: [CH] }), ctx())).status).toBe(201);
  });
  it('update with durationSec 16 is 400, 0 and 2.5 too', async () => {
    for (const d of [16, 0, 2.5]) {
      const res = await shotsPOST(mk({ op: 'update', sceneOrder: 1, shotOrder: 1, durationSec: d }), ctx());
      expect(res.status).toBe(400);
    }
    expect(repo.putShot).not.toHaveBeenCalled();
  });
  it('update of durationSec returns recomputed startSecs and the tiling state', async () => {
    repo.loadTree
      .mockResolvedValueOnce(tree())
      .mockResolvedValueOnce(tree({ shots: [shot(1, 1, 15), shot(1, 2, 10)] }));
    const res = await shotsPOST(mk({ op: 'update', sceneOrder: 1, shotOrder: 1, durationSec: 15 }), ctx());
    expect(res.status).toBe(200);
    expect(repo.putShot).toHaveBeenCalledWith(
      VS,
      expect.objectContaining({ shotOrder: 1, durationSec: 15, visualPrompt: 'A lamp' })
    );
    const body = await res.json();
    expect(body.data.shots.map((s: { startSec: number }) => s.startSec)).toEqual([0, 15]);
    expect(body.data.tiling).toEqual({ totalSec: 25, windowSec: 30, tiles: false });
  });
  it('update preserves the selected candidate and 404s on an unknown shot', async () => {
    repo.loadTree.mockResolvedValue(tree({ shots: [{ ...shot(1, 1, 10), selectedCandidateId: 'cd_x' }] }));
    await shotsPOST(mk({ op: 'update', sceneOrder: 1, shotOrder: 1, visualPrompt: 'B' }), ctx());
    expect(repo.putShot).toHaveBeenCalledWith(VS, expect.objectContaining({ selectedCandidateId: 'cd_x' }));
    expect((await shotsPOST(mk({ op: 'update', sceneOrder: 1, shotOrder: 5, visualPrompt: 'B' }), ctx())).status).toBe(404);
  });
  it('delete calls the repository and 404s on an unknown shot', async () => {
    expect((await shotsPOST(mk({ op: 'delete', sceneOrder: 1, shotOrder: 2 }), ctx())).status).toBe(200);
    expect(repo.deleteShot).toHaveBeenCalledWith(VS, 1, 2);
    expect((await shotsPOST(mk({ op: 'delete', sceneOrder: 1, shotOrder: 9 }), ctx())).status).toBe(404);
  });
  it('reorder returns the new startSecs', async () => {
    repo.loadTree
      .mockResolvedValueOnce(tree({ shots: [shot(1, 1, 5), shot(1, 2, 25)] }))
      .mockResolvedValueOnce(tree({ shots: [shot(1, 1, 25), shot(1, 2, 5)] }));
    const res = await shotsPOST(mk({ op: 'reorder', sceneOrder: 1, order: [2, 1] }), ctx());
    expect(res.status).toBe(200);
    expect(repo.reorderShots).toHaveBeenCalledWith(VS, 1, [2, 1]);
    const body = await res.json();
    expect(body.data.shots.map((s: { startSec: number; durationSec: number }) => [s.durationSec, s.startSec])).toEqual([
      [25, 0],
      [5, 25],
    ]);
    expect(body.data.tiling.tiles).toBe(true);
  });
  it('reorder with a non-permutation is 400', async () => {
    repo.reorderShots.mockRejectedValue(new InvalidReorderError('no'));
    expect((await shotsPOST(mk({ op: 'reorder', sceneOrder: 1, order: [1, 1] }), ctx())).status).toBe(400);
  });
  it('maps NotFoundError to 404 and unknown errors to a generic 500', async () => {
    repo.putShot.mockRejectedValueOnce(new NotFoundError('x'));
    expect((await shotsPOST(mk(create), ctx())).status).toBe(404);
    repo.putShot.mockRejectedValueOnce(new Error('secret detail'));
    const res = await shotsPOST(mk(create), ctx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
  it('rejects an unknown op', async () => {
    expect((await shotsPOST(mk({ op: 'explode' }), ctx())).status).toBe(400);
  });
});

describe('characters', () => {
  it('create makes an id and starts with no references', async () => {
    const res = await charsPOST(mk({ op: 'create', name: ' Test ', description: 'd' }), ctx());
    expect(res.status).toBe(201);
    const saved = repo.putCharacter.mock.calls[0][1];
    expect(saved).toEqual(
      expect.objectContaining({ name: 'Test', description: 'd', refImageKeys: [] })
    );
    expect(saved.charId).toMatch(/^ch_\d{13}_[a-z0-9]{8}$/);
  });
  it('create ignores a client-supplied refImageKeys', async () => {
    await charsPOST(mk({ op: 'create', name: 'A', description: '', refImageKeys: ['audio/mastering/x.wav'] }), ctx());
    expect(repo.putCharacter.mock.calls[0][1].refImageKeys).toEqual([]);
  });
  it('update keeps the existing references and 404s on an unknown character', async () => {
    repo.loadTree.mockResolvedValue(
      tree({ characters: [{ charId: CH, name: 'Test', description: '', refImageKeys: ['k1'], createdAt: 't' }] })
    );
    const res = await charsPOST(mk({ op: 'update', charId: CH, description: 'new' }), ctx());
    expect(res.status).toBe(200);
    expect(repo.putCharacter).toHaveBeenCalledWith(
      VS,
      expect.objectContaining({ charId: CH, name: 'Test', description: 'new', refImageKeys: ['k1'] })
    );
    expect((await charsPOST(mk({ op: 'update', charId: CH2, description: 'x' }), ctx())).status).toBe(404);
  });
  it('validates the name', async () => {
    expect((await charsPOST(mk({ op: 'create', name: '', description: '' }), ctx())).status).toBe(400);
  });
});

describe('character reference upload', () => {
  const withRefs = (n: number) =>
    tree({
      characters: [
        { charId: CH, name: 'T', description: '', createdAt: 't', refImageKeys: Array.from({ length: n }, (_, i) => `k${i}`) },
      ],
    });

  describe('presign', () => {
    beforeEach(() => {
      mockPresign.mockResolvedValue({ url: 'https://s3/x', fields: { a: 'b' } });
    });
    it('presigns a server-built key with a pinned type, 1..MAX size and 1 h TTL', async () => {
      const res = await uploadPOST(mk({ op: 'presign', contentType: 'image/png', size: 1000 }), uctx());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.key.startsWith(`audio/mastering/visual-story/${VS}/refs/${CH}/`)).toBe(true);
      expect(body.key.endsWith('.png')).toBe(true);
      expect(body.uploadUrl).toBe('https://s3/x');
      expect(mockPresign).toHaveBeenCalledWith(body.key, 'image/png', MAX_REF_BYTES, 3600, 1);
    });
    it('ignores a client-supplied key or filename', async () => {
      const res = await uploadPOST(
        mk({ op: 'presign', contentType: 'image/webp', key: 'audio/mastering/other.wav', filename: '../../x.webp' }),
        uctx()
      );
      const body = await res.json();
      expect(body.key).toMatch(/\/refs\/ch_1700000000000_abcdef12\/[0-9a-f-]{36}\.webp$/);
    });
    it('refuses image/gif and other types', async () => {
      for (const t of ['image/gif', 'image/svg+xml', 'audio/wav', 'application/pdf']) {
        expect((await uploadPOST(mk({ op: 'presign', contentType: t }), uctx())).status).toBe(400);
      }
      expect(mockPresign).not.toHaveBeenCalled();
    });
    it('refuses a declared size over the cap', async () => {
      const res = await uploadPOST(mk({ op: 'presign', contentType: 'image/png', size: MAX_REF_BYTES + 1 }), uctx());
      expect(res.status).toBe(400);
    });
    it('refuses a 5th reference', async () => {
      repo.loadTree.mockResolvedValue(withRefs(4));
      const res = await uploadPOST(mk({ op: 'presign', contentType: 'image/png' }), uctx());
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/4/);
      expect(mockPresign).not.toHaveBeenCalled();
    });
    it('allows the 4th', async () => {
      repo.loadTree.mockResolvedValue(withRefs(3));
      expect((await uploadPOST(mk({ op: 'presign', contentType: 'image/png' }), uctx())).status).toBe(200);
    });
    it('404 for a character that is not on the story', async () => {
      expect((await uploadPOST(mk({ op: 'presign', contentType: 'image/png' }), uctx(VS, CH2))).status).toBe(404);
    });
    it('502 when presigning fails', async () => {
      mockPresign.mockRejectedValue(new Error('aws'));
      expect((await uploadPOST(mk({ op: 'presign', contentType: 'image/png' }), uctx())).status).toBe(502);
    });
  });

  describe('confirm', () => {
    const good = () => refKey(VS, CH, 'png');
    beforeEach(() => {
      mockLength.mockResolvedValue(2048);
    });
    it('appends the key once HeadObject finds it', async () => {
      const key = good();
      const res = await uploadPOST(mk({ op: 'confirm', key }), uctx());
      expect(res.status).toBe(200);
      expect(mockLength).toHaveBeenCalledWith(key);
      expect(repo.addCharacterRef).toHaveBeenCalledWith(VS, CH, key);
    });
    it('400 for a key outside the character prefix and never heads S3', async () => {
      const bad = [
        'audio/mastering/other.wav',
        refKey(VS, CH2, 'png'),
        refKey('vs_1700000000001_zzzzzz99', CH, 'png'),
        `audio/mastering/visual-story/${VS}/refs/${CH}/../${CH2}/x.png`,
        `audio/mastering/visual-story/${VS}/refs/${CH}/not-a-uuid.png`,
        `audio/mastering/visual-story/${VS}/candidates/cd_1700000000000_abcdef12.jpg`,
        good().replace('.png', '.gif'),
        '',
      ];
      for (const key of bad) {
        expect((await uploadPOST(mk({ op: 'confirm', key }), uctx())).status).toBe(400);
      }
      expect(mockLength).not.toHaveBeenCalled();
      expect(repo.addCharacterRef).not.toHaveBeenCalled();
    });
    it('400 when the object is not in S3, empty, or over the cap', async () => {
      mockLength.mockResolvedValueOnce(null);
      expect((await uploadPOST(mk({ op: 'confirm', key: good() }), uctx())).status).toBe(400);
      mockLength.mockResolvedValueOnce(0);
      expect((await uploadPOST(mk({ op: 'confirm', key: good() }), uctx())).status).toBe(400);
      mockLength.mockResolvedValueOnce(MAX_REF_BYTES + 1);
      expect((await uploadPOST(mk({ op: 'confirm', key: good() }), uctx())).status).toBe(400);
      expect(repo.addCharacterRef).not.toHaveBeenCalled();
    });
    it('is idempotent for a key already attached', async () => {
      const key = good();
      repo.loadTree.mockResolvedValue(
        tree({ characters: [{ charId: CH, name: 'T', description: '', createdAt: 't', refImageKeys: [key] }] })
      );
      expect((await uploadPOST(mk({ op: 'confirm', key }), uctx())).status).toBe(200);
      expect(repo.addCharacterRef).not.toHaveBeenCalled();
    });
    it('400 when the character already has 4 references', async () => {
      repo.loadTree.mockResolvedValue(withRefs(4));
      expect((await uploadPOST(mk({ op: 'confirm', key: good() }), uctx())).status).toBe(400);
      expect(repo.addCharacterRef).not.toHaveBeenCalled();
    });
    it('404 when the character vanished between head and write', async () => {
      repo.addCharacterRef.mockRejectedValue(new NotFoundError('gone'));
      expect((await uploadPOST(mk({ op: 'confirm', key: good() }), uctx())).status).toBe(404);
    });
  });
});
