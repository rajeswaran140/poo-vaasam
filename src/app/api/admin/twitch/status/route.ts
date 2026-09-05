/**
 * GET /api/admin/twitch/status — read the current Twitch state for the
 * admin UI. Returns three sibling sub-objects so the UI can render
 * each panel independently:
 *
 *   connection   — the OAuth link (from PR 1)
 *   eventsub     — the list of subscriptions we've created + their status
 *   stream       — current LIVE/OFFLINE state as of the last event
 *
 * Returns ONLY safe metadata — NEVER tokens, NEVER the EventSub secret,
 * NEVER SSM param values. Admin-gated (read-only, no Bearer required per
 * the convention for GET routes).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { TwitchSubscriptionRepository } from '@/infrastructure/database/TwitchSubscriptionRepository';
import { TwitchStreamRepository } from '@/infrastructure/database/TwitchStreamRepository';
import { currentTenantId } from '@/lib/twitch/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const tenantId = currentTenantId();
    const [conn, subs, stream] = await Promise.all([
      new TwitchConnectionRepository().get(tenantId),
      new TwitchSubscriptionRepository().listAll(tenantId),
      new TwitchStreamRepository().get(tenantId),
    ]);

    const connection =
      conn && conn.connectionStatus === 'connected'
        ? {
            twitchLogin: conn.twitchLogin,
            displayName: conn.displayName,
            broadcasterId: conn.broadcasterId,
            profileImageUrl: conn.profileImageUrl,
            scopes: conn.scopes,
            connectedAt: conn.connectedAt,
            updatedAt: conn.updatedAt,
          }
        : null;

    return NextResponse.json({
      success: true,
      status: conn?.connectionStatus ?? 'disconnected',
      connection,
      eventsub: {
        subscriptions: subs.map((s) => ({
          type: s.type,
          status: s.status,
          twitchSubscriptionId: s.twitchSubscriptionId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          reason: s.reason,
        })),
      },
      stream: stream
        ? {
            isLive: stream.isLive,
            streamId: stream.streamId,
            title: stream.title,
            categoryName: stream.categoryName,
            startedAt: stream.startedAt,
            updatedAt: stream.updatedAt,
          }
        : null,
    });
  } catch (err) {
    console.error('[api/admin/twitch/status] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Could not read Twitch connection status.' },
      { status: 502 }
    );
  }
}
