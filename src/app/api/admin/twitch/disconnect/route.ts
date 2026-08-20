/**
 * POST /api/admin/twitch/disconnect — tear the connection down.
 *
 * Deletes the EventSub subscriptions at Twitch, revokes the access token, and
 * removes the stored tokens. Local teardown proceeds even if Twitch is
 * unreachable: an admin who clicks Disconnect must end up disconnected rather
 * than blocked by someone else's outage.
 *
 * Stream sessions and recorded events are deliberately KEPT — they are history
 * for song-level analytics, not credentials.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { getTwitchConfig } from '@/lib/twitch/config';
import { disconnect } from '@/application/use-cases/ConnectTwitch';
import { DEFAULT_TENANT_ID } from '@/types/twitch';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('twitch:disconnect');

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request); // mutation (revokes tokens) — reject cookie-only auth (CSRF)
  } catch (error) {
    return authErrorResponse(error);
  }

  const config = getTwitchConfig();
  if (!config) {
    return NextResponse.json({ error: 'Twitch is not configured' }, { status: 503 });
  }

  try {
    await disconnect(config, DEFAULT_TENANT_ID);
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('twitch disconnect failed', error, {
      tenantId: DEFAULT_TENANT_ID,
      result: 'failed',
    });
    return NextResponse.json({ error: 'Disconnect failed' }, { status: 500 });
  }
}
