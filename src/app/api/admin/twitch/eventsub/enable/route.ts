/**
 * POST /api/admin/twitch/eventsub/enable — create `stream.online` and
 * `stream.offline` EventSub subscriptions for the connected tenant.
 *
 * Idempotent — running this while both subscriptions are already active
 * updates the local records against Twitch's current state and returns
 * success. That means an admin can hit "Enable" after a reconnect without
 * worrying whether an old subscription is still around.
 *
 * Preconditions:
 *   - A TwitchConnection exists (connection.status === 'connected').
 *   - TWITCH_EVENTSUB_SECRET is present in SSM (auto-created on first call
 *     if missing, using 32 random bytes).
 *
 * Admin-gated + Bearer-required (mutation route).
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import {
  createSubscription,
  listSubscriptions,
  resolveEventSubCallbackUrl,
  type HelixSubscription,
} from '@/lib/twitch/eventsub';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { TwitchSubscriptionRepository } from '@/infrastructure/database/TwitchSubscriptionRepository';
import { currentTenantId } from '@/lib/twitch/tenant';
import type { SubscriptionType } from '@/types/twitch-eventsub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const region = process.env.AWS_REGION || 'ca-central-1';
const ssm = new SSMClient({ region });

function ssmPrefix(): string {
  const app = process.env.AWS_APP_ID || 'd3rkmepk4popv0';
  const branch = process.env.AWS_BRANCH || 'master';
  return `/amplify/${app}/${branch}`;
}

/**
 * Read the shared EventSub HMAC secret. Auto-creates one on first use so
 * an admin never has to hand-mint 32 random bytes into SSM. Idempotent —
 * once a secret is written, subsequent calls return the same value.
 */
async function ensureEventSubSecret(): Promise<string> {
  const name = `${ssmPrefix()}/TWITCH_EVENTSUB_SECRET`;
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    const v = r.Parameter?.Value;
    if (v && v.length > 0) return v;
  } catch (err) {
    if (!(err instanceof Error) || err.name !== 'ParameterNotFound') throw err;
  }
  // First-time creation. 32 bytes of base64url = ~43 printable chars — long
  // enough that a signature-brute-force is infeasible; a single write, so no
  // race window can produce two conflicting secrets.
  const secret = crypto.randomBytes(32).toString('base64url');
  await ssm.send(
    new PutParameterCommand({
      Name: name,
      Value: secret,
      Type: 'SecureString',
      KeyId: 'alias/aws/ssm',
      Overwrite: false,
      Description: 'Twitch EventSub HMAC secret — signs webhook payloads.',
    })
  );
  return secret;
}

const REQUIRED_TYPES: SubscriptionType[] = ['stream.online', 'stream.offline'];

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const tenantId = currentTenantId();
  const connRepo = new TwitchConnectionRepository();
  const conn = await connRepo.get(tenantId);
  if (!conn || conn.connectionStatus !== 'connected') {
    return NextResponse.json(
      { success: false, error: 'No active Twitch connection. Connect first, then enable EventSub.' },
      { status: 400 }
    );
  }

  let secret: string;
  try {
    secret = await ensureEventSubSecret();
  } catch (err) {
    console.error('[api/admin/twitch/eventsub/enable] secret ensure failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Could not read or create the EventSub secret.' },
      { status: 502 }
    );
  }

  const callbackUrl = resolveEventSubCallbackUrl(request.nextUrl.origin);
  const subRepo = new TwitchSubscriptionRepository();

  // List existing subscriptions once so we don't attempt to duplicate.
  // Twitch returns 409 on exact duplicates, but the list is cheaper and gives
  // us the current status without a second call per type.
  let existing: HelixSubscription[] = [];
  try {
    existing = await listSubscriptions();
  } catch (err) {
    console.error('[api/admin/twitch/eventsub/enable] list failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { success: false, error: 'Could not list existing Twitch subscriptions.' },
      { status: 502 }
    );
  }

  const results: Array<{ type: SubscriptionType; twitchSubscriptionId: string; status: string; created: boolean }> = [];
  for (const type of REQUIRED_TYPES) {
    const already = existing.find(
      (s) =>
        s.type === type &&
        s.transport.callback === callbackUrl &&
        s.condition.broadcaster_user_id === conn.broadcasterId
    );
    let sub: HelixSubscription;
    let created = false;
    if (already) {
      sub = already;
    } else {
      try {
        sub = await createSubscription({
          type,
          version: '1',
          condition: { broadcaster_user_id: conn.broadcasterId },
          callbackUrl,
          secret,
        });
        created = true;
      } catch (err) {
        console.error(`[api/admin/twitch/eventsub/enable] create ${type} failed:`, err instanceof Error ? err.message : String(err));
        return NextResponse.json(
          { success: false, error: `Could not create ${type} subscription at Twitch.` },
          { status: 502 }
        );
      }
    }
    const nowIso = new Date().toISOString();
    // status from Twitch: 'enabled' (already verified), 'webhook_callback_verification_pending', ...
    const localStatus =
      sub.status === 'enabled' ? 'enabled' : sub.status.startsWith('webhook_callback_verification') ? 'pending' : 'pending';
    await subRepo.put({
      tenantId,
      type,
      twitchSubscriptionId: sub.id,
      broadcasterUserId: conn.broadcasterId,
      status: localStatus,
      createdAt: sub.created_at || nowIso,
      updatedAt: nowIso,
      reason: null,
    });
    results.push({ type, twitchSubscriptionId: sub.id, status: sub.status, created });
  }

  return NextResponse.json({ success: true, callbackUrl, subscriptions: results });
}
