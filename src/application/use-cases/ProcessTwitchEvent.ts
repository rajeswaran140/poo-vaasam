/**
 * ProcessTwitchEvent — the business-logic side of the Twitch ingress.
 *
 * The webhook route does transport concerns only (signature, freshness,
 * dedupe). Everything that means something to TamilAgaval happens here, which
 * is the boundary that lets the transport move to a Lambda later without any
 * of this changing.
 *
 * Phase 1 turns stream.online / stream.offline into STREAM SESSIONS. That row
 * is deliberately the unit of work rather than a boolean on the connection,
 * because Phase 2's song-play spans hang off the same partition:
 *
 *   TWITCHSTREAM#<tenant> / SESSION#<startedAt>#<streamId>     ← today
 *   TWITCHSTREAM#<tenant> / PLAY#<startedAt>#<songId>          ← Phase 2
 *
 * so "which songs were played during which broadcast, and what engagement
 * arrived while they played" is a query against one partition, with songId
 * holding a Content.id from the existing catalogue. No second song store.
 */

import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import type { NormalizedTwitchEvent } from '@/lib/twitch/normalize';
import type { TwitchStreamSession } from '@/types/twitch';
import { createLogger } from '@/lib/logger';

const log = createLogger('twitch:process');

export interface ProcessTwitchEventDeps {
  repo: TwitchConnectionRepository;
  now: () => Date;
}

export function defaultProcessDeps(): ProcessTwitchEventDeps {
  return { repo: new TwitchConnectionRepository(), now: () => new Date() };
}

export type ProcessResult = 'session_opened' | 'session_closed' | 'ignored';

/**
 * Apply a normalised event.
 *
 * Called AFTER the event has been persisted and AFTER the 2XX has been decided,
 * so a failure here cannot cause Twitch to retry a message we already recorded.
 * It therefore logs rather than throwing into the response path.
 */
export async function processTwitchEvent(
  tenantId: string,
  event: NormalizedTwitchEvent,
  deps: ProcessTwitchEventDeps = defaultProcessDeps()
): Promise<ProcessResult> {
  const nowIso = deps.now().toISOString();

  if (event.kind === 'stream.online') {
    const session: TwitchStreamSession = {
      tenantId,
      streamId: event.streamId,
      broadcasterId: event.broadcasterId ?? '',
      // Prefer Twitch's own start time; fall back to receipt time.
      startedAt: event.startedAt ?? nowIso,
      updatedAt: nowIso,
    };
    await deps.repo.putSession(session);
    log.info('stream session opened', {
      tenantId,
      broadcasterUserId: session.broadcasterId,
      eventType: event.eventType,
      streamId: session.streamId,
      result: 'session_opened',
    });
    return 'session_opened';
  }

  if (event.kind === 'stream.offline') {
    const latest = await deps.repo.latestSession(tenantId);
    if (!latest || latest.endedAt) {
      // An offline with no open session (first ever event, or a duplicate that
      // arrived past the dedupe TTL). Not an error — nothing to close.
      log.info('stream.offline with no open session', {
        tenantId,
        eventType: event.eventType,
        result: 'ignored',
      });
      return 'ignored';
    }
    await deps.repo.putSession({ ...latest, endedAt: nowIso, updatedAt: nowIso });
    log.info('stream session closed', {
      tenantId,
      broadcasterUserId: latest.broadcasterId,
      eventType: event.eventType,
      streamId: latest.streamId,
      result: 'session_closed',
    });
    return 'session_closed';
  }

  // Persisted but not acted on — this is how a future event type arrives with
  // history already captured rather than starting from zero.
  log.info('twitch event recorded without a handler', {
    tenantId,
    eventType: event.eventType,
    result: 'ignored',
  });
  return 'ignored';
}
