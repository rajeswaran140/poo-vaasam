/** @jest-environment node */
/**
 * ProcessTwitchEvent — stream.online opens a session, stream.offline closes the
 * open one. The session row is what Phase 2's song-play spans will hang off, so
 * these behaviours are the foundation rather than a status flag.
 */

import { processTwitchEvent } from '@/application/use-cases/ProcessTwitchEvent';
import type { NormalizedTwitchEvent } from '@/lib/twitch/normalize';
import type { TwitchStreamSession } from '@/types/twitch';

const TENANT = 'tamilagaval';
const NOW = new Date('2026-08-20T13:00:00Z');

function fakeRepo(latest: TwitchStreamSession | null = null) {
  return {
    latestSession: jest.fn().mockResolvedValue(latest),
    putSession: jest.fn().mockResolvedValue(undefined),
  };
}

const deps = (repo: ReturnType<typeof fakeRepo>) =>
  ({ repo, now: () => NOW }) as unknown as Parameters<typeof processTwitchEvent>[2];

const onlineEvent: NormalizedTwitchEvent = {
  kind: 'stream.online',
  eventType: 'stream.online',
  broadcasterId: '99',
  streamId: 'stream-9001',
  startedAt: '2026-08-20T12:00:00Z',
  raw: {},
};

const offlineEvent: NormalizedTwitchEvent = {
  kind: 'stream.offline',
  eventType: 'stream.offline',
  broadcasterId: '99',
  raw: {},
};

describe('stream.online', () => {
  it('opens a session using Twitch’s own start time', async () => {
    const repo = fakeRepo();
    const result = await processTwitchEvent(TENANT, onlineEvent, deps(repo));

    expect(result).toBe('session_opened');
    expect(repo.putSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        streamId: 'stream-9001',
        broadcasterId: '99',
        startedAt: '2026-08-20T12:00:00Z',
      })
    );
    // No endedAt — the session is open.
    expect(repo.putSession.mock.calls[0][0].endedAt).toBeUndefined();
  });

  it('falls back to receipt time when the event carries no start time', async () => {
    const repo = fakeRepo();
    await processTwitchEvent(TENANT, { ...onlineEvent, startedAt: undefined }, deps(repo));
    expect(repo.putSession.mock.calls[0][0].startedAt).toBe(NOW.toISOString());
  });
});

describe('stream.offline', () => {
  const openSession: TwitchStreamSession = {
    tenantId: TENANT,
    streamId: 'stream-9001',
    broadcasterId: '99',
    startedAt: '2026-08-20T12:00:00Z',
    updatedAt: '2026-08-20T12:00:00Z',
  };

  it('closes the open session', async () => {
    const repo = fakeRepo(openSession);
    const result = await processTwitchEvent(TENANT, offlineEvent, deps(repo));

    expect(result).toBe('session_closed');
    expect(repo.putSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streamId: 'stream-9001',
        startedAt: '2026-08-20T12:00:00Z',
        endedAt: NOW.toISOString(),
      })
    );
  });

  it('is a no-op when there is no session at all', async () => {
    const repo = fakeRepo(null);
    expect(await processTwitchEvent(TENANT, offlineEvent, deps(repo))).toBe('ignored');
    expect(repo.putSession).not.toHaveBeenCalled();
  });

  it('is a no-op when the latest session is already closed', async () => {
    // A late duplicate offline (past the dedupe TTL) must not reopen or
    // re-close anything.
    const repo = fakeRepo({ ...openSession, endedAt: '2026-08-20T12:45:00Z' });
    expect(await processTwitchEvent(TENANT, offlineEvent, deps(repo))).toBe('ignored');
    expect(repo.putSession).not.toHaveBeenCalled();
  });
});

describe('unmodelled events', () => {
  it('is recorded but not acted on', async () => {
    const repo = fakeRepo();
    const result = await processTwitchEvent(
      TENANT,
      { kind: 'unknown', eventType: 'channel.cheer', raw: {} },
      deps(repo)
    );
    expect(result).toBe('ignored');
    expect(repo.putSession).not.toHaveBeenCalled();
  });
});
