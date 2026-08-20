/**
 * POST /api/admin/twitch/reconnect — repair an existing connection.
 *
 * This is the "EventSub says it is broken but the account is still linked"
 * button. It re-runs subscription reconciliation and re-validates the stored
 * token (refreshing it if needed), WITHOUT sending the admin through Twitch's
 * consent screen again.
 *
 * If the token can no longer be refreshed the connection is marked
 * `reauth_required` and the panel shows Connect Twitch instead — that is the
 * only case where a full OAuth round-trip is genuinely necessary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { getTwitchConfig } from '@/lib/twitch/config';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { ensureSubscriptions, getValidUserToken } from '@/application/use-cases/ConnectTwitch';
import { DEFAULT_TENANT_ID } from '@/types/twitch';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('twitch:reconnect');

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request); // mutation (re-registers EventSub) — reject cookie-only auth (CSRF)
  } catch (error) {
    return authErrorResponse(error);
  }

  const config = getTwitchConfig();
  if (!config) {
    return NextResponse.json({ error: 'Twitch is not configured' }, { status: 503 });
  }

  const tenantId = DEFAULT_TENANT_ID;
  const repo = new TwitchConnectionRepository();

  try {
    const connection = await repo.get(tenantId);
    if (!connection || connection.status === 'disconnected') {
      return NextResponse.json(
        { error: 'No Twitch connection to reconnect', requiresAuthorization: true },
        { status: 409 }
      );
    }

    const token = await getValidUserToken(config, tenantId);
    if (!token) {
      // getValidUserToken has already recorded why.
      return NextResponse.json(
        { error: 'Twitch authorization must be renewed', requiresAuthorization: true },
        { status: 409 }
      );
    }

    await ensureSubscriptions(config, connection);

    // ensureSubscriptions may have set 'degraded'; re-read rather than assuming.
    const after = await repo.get(tenantId);
    if (after?.status === 'degraded') {
      return NextResponse.json({ success: true, status: 'degraded', lastError: after.lastError });
    }

    await repo.setStatus(tenantId, 'connected');
    log.info('twitch reconnected', { tenantId, result: 'ok' });
    return NextResponse.json({ success: true, status: 'connected' });
  } catch (error) {
    log.error('twitch reconnect failed', error, { tenantId, result: 'failed' });
    return NextResponse.json({ error: 'Reconnect failed' }, { status: 500 });
  }
}
