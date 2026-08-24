/**
 * GET /api/admin/twitch/status — read the current Twitch connection state
 * for the admin UI.
 *
 * Returns only the safe metadata needed to render the connection panel —
 * NEVER tokens, NEVER SSM param names' values. Admin-gated (read-only, no
 * Bearer required per the convention for GET routes).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
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
    const repo = new TwitchConnectionRepository();
    const conn = await repo.get(currentTenantId());

    if (!conn || conn.connectionStatus !== 'connected') {
      return NextResponse.json({
        success: true,
        status: conn?.connectionStatus ?? 'disconnected',
        connection: null,
      });
    }

    return NextResponse.json({
      success: true,
      status: conn.connectionStatus,
      connection: {
        twitchLogin: conn.twitchLogin,
        displayName: conn.displayName,
        broadcasterId: conn.broadcasterId,
        profileImageUrl: conn.profileImageUrl,
        scopes: conn.scopes,
        connectedAt: conn.connectedAt,
        updatedAt: conn.updatedAt,
      },
    });
  } catch (err) {
    console.error('[api/admin/twitch/status] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Could not read Twitch connection status.' },
      { status: 502 }
    );
  }
}
