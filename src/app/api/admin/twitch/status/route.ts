/**
 * GET /api/admin/twitch/status — everything the admin panel renders.
 *
 * 🔴 This route must NEVER return a token. It reads only the connection's
 * METADATA item (tokens live under SK='SECRET' and are not loaded here), and
 * the response shape below is an explicit allow-list rather than a spread of a
 * database row — so a future field cannot leak by accident.
 *
 * Live status is resolved from BOTH sources, deliberately:
 *  - the stream-session row, written by EventSub (authoritative, push), and
 *  - a Get Streams call (authoritative, pull) which also carries the title,
 *    category and viewer count that stream.online does not include.
 * If Twitch is unreachable we still answer from the session row rather than
 * failing the page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { getTwitchConfig, missingTwitchConfigKeys } from '@/lib/twitch/config';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { TwitchEventRepository } from '@/infrastructure/database/TwitchEventRepository';
import { getStream } from '@/services/twitch/twitch-client';
import { DEFAULT_TENANT_ID } from '@/types/twitch';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('twitch:status');

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (error) {
    return authErrorResponse(error);
  }

  const config = getTwitchConfig();
  if (!config) {
    return NextResponse.json({
      configured: false,
      missing: missingTwitchConfigKeys(),
      connection: null,
    });
  }

  const tenantId = DEFAULT_TENANT_ID;
  const repo = new TwitchConnectionRepository();
  const eventRepo = new TwitchEventRepository();

  try {
    const connection = await repo.get(tenantId);
    if (!connection || connection.status === 'disconnected') {
      return NextResponse.json({
        configured: true,
        connection: null,
        status: connection?.status ?? 'disconnected',
      });
    }

    const [subscriptions, session, recentEvents] = await Promise.all([
      repo.listSubscriptions(tenantId),
      repo.latestSession(tenantId),
      eventRepo.listRecent(tenantId, 1),
    ]);

    // Push view: an open session means EventSub believes we are live.
    let live = Boolean(session && !session.endedAt);
    let stream: {
      streamId?: string;
      title?: string;
      categoryName?: string;
      startedAt?: string;
      viewerCount?: number;
    } | null = live && session
      ? { streamId: session.streamId, startedAt: session.startedAt }
      : null;

    // Pull view: richer metadata, and it corrects a missed event.
    try {
      const current = await getStream(config, connection.broadcasterId);
      if (current) {
        live = true;
        stream = {
          streamId: current.id,
          title: current.title,
          categoryName: current.game_name,
          startedAt: current.started_at,
          viewerCount: current.viewer_count,
        };
      } else if (!session || session.endedAt) {
        live = false;
        stream = null;
      }
    } catch (error) {
      // Twitch unreachable — keep the EventSub-derived answer.
      log.warn('could not refresh live status from Twitch', {
        tenantId,
        result: error instanceof Error ? error.name : 'unknown',
      });
    }

    const last = recentEvents[0];

    // Explicit allow-list. No spread of a database row.
    return NextResponse.json({
      configured: true,
      connection: {
        twitchLogin: connection.twitchLogin,
        displayName: connection.displayName,
        broadcasterId: connection.broadcasterId,
        profileImageUrl: connection.profileImageUrl,
        status: connection.status,
        scopes: connection.scopes,
        connectedAt: connection.connectedAt,
        updatedAt: connection.updatedAt,
        lastError: connection.lastError,
      },
      live,
      stream,
      eventSub: {
        subscriptions: subscriptions.map((s) => ({
          type: s.type,
          status: s.status,
          createdAt: s.createdAt,
        })),
        active: subscriptions.some((s) => s.status === 'enabled'),
      },
      lastEvent: last
        ? { eventType: last.eventType, receivedAt: last.receivedAt }
        : null,
    });
  } catch (error) {
    log.error('twitch status failed', error, { tenantId, result: 'failed' });
    return NextResponse.json(
      { configured: true, error: 'Could not read the Twitch integration status' },
      { status: 500 }
    );
  }
}
