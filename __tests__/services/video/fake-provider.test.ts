import { FakeVideoProvider } from '@/services/video/providers/fake';
import { getVideoProvider } from '@/services/video/providers';
import type { VideoGenRequest } from '@/services/video/providers/types';

const req: VideoGenRequest = { prompt: 'Scene 1', mode: 'MOTION', durationSec: 5, aspectRatio: '16:9' };

describe('FakeVideoProvider', () => {
  it('is always configured and costs nothing', async () => {
    const p = new FakeVideoProvider();
    expect(await p.isConfigured()).toBe(true);
    expect(p.estimateCostUsd(req)).toBe(0);
  });

  it('goes pending -> running -> succeeded with one video asset', async () => {
    let t = 1000;
    const p = new FakeVideoProvider({ durationMs: 100, now: () => t });
    const sub = await p.submit(req);
    if (!sub.ok) throw new Error('submit failed');
    expect(sub.estimatedCostUsd).toBe(0);
    expect(await p.poll(sub.providerTaskId)).toEqual({ ok: true, state: 'pending' });
    t += 60;
    expect(await p.poll(sub.providerTaskId)).toEqual({ ok: true, state: 'running' });
    t += 60;
    const done = await p.poll(sub.providerTaskId);
    expect(done.ok && done.state === 'succeeded').toBe(true);
    if (done.ok && done.state === 'succeeded') {
      expect(done.assets).toHaveLength(1);
      expect(done.assets[0].kind).toBe('video');
      expect(done.actualCostUsd).toBe(0);
    }
  });

  it('survives instance boundaries: submit on one, poll on fresh ones', async () => {
    const sub = await new FakeVideoProvider({ durationMs: 0 }).submit(req);
    if (!sub.ok) throw new Error('submit failed');
    const r = await new FakeVideoProvider().poll(sub.providerTaskId);
    expect(r.ok && r.state).toBe('succeeded');
  });

  it('works through the registry across separate getVideoProvider calls', async () => {
    const sub = await getVideoProvider('fake').submit(req);
    if (!sub.ok) throw new Error('submit failed');
    const first = await getVideoProvider('fake').poll(sub.providerTaskId);
    expect(first).toEqual({ ok: true, state: 'pending' });
    // Backdate the id so a fresh instance sees the default duration elapsed.
    const aged = sub.providerTaskId.replace(/^fake-task-\d+/, 'fake-task-1');
    const done = await getVideoProvider('fake').poll(aged);
    expect(done.ok && done.state).toBe('succeeded');
  });

  it('gives distinct task ids and rejects unknown ids', async () => {
    const p = new FakeVideoProvider();
    const a = await p.submit(req);
    const b = await p.submit(req);
    if (!a.ok || !b.ok) throw new Error('submit failed');
    expect(a.providerTaskId).not.toBe(b.providerTaskId);
    const r = await p.poll('missing');
    expect(r.ok).toBe(false);
  });
});

describe('getVideoProvider', () => {
  const saved = process.env.VIDEO_PROVIDER;
  afterEach(() => {
    if (saved === undefined) delete process.env.VIDEO_PROVIDER;
    else process.env.VIDEO_PROVIDER = saved;
  });

  it('returns the fake by id, then by env', () => {
    expect(getVideoProvider('fake').id).toBe('fake');
    process.env.VIDEO_PROVIDER = 'fake';
    expect(getVideoProvider().id).toBe('fake');
  });
  it('explicit id beats env', () => {
    process.env.VIDEO_PROVIDER = 'nope';
    expect(getVideoProvider('fake').id).toBe('fake');
  });
  it('throws on unknown id', () => {
    expect(() => getVideoProvider('nope')).toThrow(/Unknown video provider/);
  });
  it('defaults to grok, which is not implemented yet', () => {
    delete process.env.VIDEO_PROVIDER;
    expect(() => getVideoProvider()).toThrow(/not implemented until Phase 4/);
  });
});
