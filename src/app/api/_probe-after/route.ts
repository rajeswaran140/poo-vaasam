/**
 * TEMPORARY viability probe (remove after diagnosis).
 *
 * Answers: can background work scheduled with Next's `after()` run past the
 * ~30s CloudFront origin timeout on this Amplify compute? The handler returns
 * instantly and schedules 35s of background work; if `[probe] after-complete`
 * appears in CloudWatch ~35s later, async Sonnet compose is viable here.
 */

import { after } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export function GET() {
  const t0 = Date.now();
  console.info('[probe] start', new Date().toISOString());

  after(async () => {
    await new Promise((r) => setTimeout(r, 35_000));
    console.info('[probe] after-complete', JSON.stringify({ ms: Date.now() - t0 }));
  });

  return Response.json({ ok: true, scheduled: true });
}
