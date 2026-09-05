/**
 * POST /api/admin/twitch/eventsub/disable — delete the tenant's
 * `stream.online` + `stream.offline` EventSub subscriptions at Twitch
 * and remove the local records. The webhook stays wired; there's just
 * nothing subscribed to fire it.
 *
 * Idempotent — if no subscriptions exist locally OR at Twitch, this is
 * a successful no-op.
 *
 * Admin-gated + Bearer-required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { deleteSubscription } from '@/lib/twitch/eventsub';
import { TwitchSubscriptionRepository } from '@/infrastructure/database/TwitchSubscriptionRepository';
import { currentTenantId } from '@/lib/twitch/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const tenantId = currentTenantId();
  const subRepo = new TwitchSubscriptionRepository();
  const locals = await subRepo.listAll(tenantId);

  const results: Array<{ type: string; deleted: boolean; reason?: string }> = [];
  for (const local of locals) {
    if (!local.twitchSubscriptionId) {
      await subRepo.delete(tenantId, local.type);
      results.push({ type: local.type, deleted: true });
      continue;
    }
    try {
      await deleteSubscription(local.twitchSubscriptionId);
      await subRepo.delete(tenantId, local.type);
      results.push({ type: local.type, deleted: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[api/admin/twitch/eventsub/disable] delete ${local.type} failed:`, msg);
      // Even on Twitch-side delete failure, still remove the local record —
      // the operator's intent is "off". A reconcile cron would surface any
      // stale Twitch subscription the next time it runs.
      await subRepo.delete(tenantId, local.type).catch(() => undefined);
      results.push({ type: local.type, deleted: true, reason: `twitch-delete-failed: ${msg}` });
    }
  }

  return NextResponse.json({ success: true, subscriptions: results });
}
