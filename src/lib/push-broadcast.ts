/**
 * Broadcast a new-song notification to every stored push subscription, and
 * prune subscriptions the browser has discarded (404/410). Triggered manually
 * by an admin (human-in-the-loop) — never auto-fired on publish.
 */

import webpush from 'web-push';
import { listPushSubscriptions, deletePushSubscription } from '@/lib/push-store';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

export interface BroadcastResult {
  total: number;
  sent: number;
  pruned: number;
  failed: number;
}

export function isVapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

/** A push endpoint is dead (subscription gone) on 404/410 → prune it. */
export function isExpiredPushError(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

function configure(): void {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT as string,
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string
  );
}

export async function broadcastPush(payload: PushPayload): Promise<BroadcastResult> {
  configure();
  const subs = await listPushSubscriptions();
  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/songs',
    icon: payload.icon || '/icons/icon-192.png',
  });

  const settled = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, data))
  );

  const toPrune: string[] = [];
  let sent = 0;
  let failed = 0;
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sent++;
    } else {
      const code = (r.reason as { statusCode?: number })?.statusCode;
      if (isExpiredPushError(code)) toPrune.push(subs[i].endpoint);
      else failed++;
    }
  });

  await Promise.allSettled(toPrune.map((e) => deletePushSubscription(e)));

  return { total: subs.length, sent, pruned: toPrune.length, failed };
}
