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
    const p = new FakeVideoProvider({ pollsUntilDone: 2 });
    const sub = await p.submit(req);
    if (!sub.ok) throw new Error('submit failed');
    expect(sub.estimatedCostUsd).toBe(0);
    expect(await p.poll(sub.providerTaskId)).toEqual({ ok: true, state: 'pending' });
    expect(await p.poll(sub.providerTaskId)).toEqual({ ok: true, state: 'running' });
    const done = await p.poll(sub.providerTaskId);
    expect(done.ok && done.state === 'succeeded').toBe(true);
    if (done.ok && done.state === 'succeeded') {
      expect(done.assets).toHaveLength(1);
      expect(done.assets[0].kind).toBe('video');
      expect(done.actualCostUsd).toBe(0);
    }
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
