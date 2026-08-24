/**
 * POST /api/admin/twitch/disconnect — sever the local Twitch connection.
 *
 * Order of operations (soft-first — local state is authoritative):
 *   1. Read the current access token from SSM (best-effort).
 *   2. Fire-and-forget revoke to Twitch (best-effort; local disconnect
 *      proceeds even if Twitch is unavailable).
 *   3. Delete both SSM params.
 *   4. Flip the DDB record status to `disconnected`, keeping the row for audit.
 *
 * Admin-gated + Bearer-required (mutation route).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { currentTenantId } from '@/lib/twitch/tenant';
import { revokeToken } from '@/lib/twitch/oauth';
import { deleteTokens, accessTokenParamName } from '@/lib/twitch/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const region = process.env.AWS_REGION || 'ca-central-1';
const ssm = new SSMClient({ region });

async function readAccessTokenBestEffort(paramName: string): Promise<string | null> {
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
    return r.Parameter?.Value ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const tenantId = currentTenantId();
  const repo = new TwitchConnectionRepository();

  try {
    // 1. Read current access token so we can revoke at Twitch — but don't fail
    //    the whole disconnect if SSM already has no value for this tenant.
    const accessToken = await readAccessTokenBestEffort(accessTokenParamName(tenantId));
    if (accessToken) {
      await revokeToken(accessToken); // Never throws — best-effort by contract.
    }

    // 2. Delete SSM params. This is the point of no return — after here, the
    //    Twitch API is unreachable from this app until the user reconnects.
    await deleteTokens(tenantId);

    // 3. Soft-flip the DDB record. If the record doesn't exist (never
    //    connected), this throws ConditionalCheckFailed — treat as success.
    try {
      await repo.markDisconnected(tenantId, 'disconnected', new Date().toISOString());
    } catch {
      // No-op — no record means already-disconnected.
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/admin/twitch/disconnect] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Could not disconnect Twitch cleanly.' },
      { status: 502 }
    );
  }
}
