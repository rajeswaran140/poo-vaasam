/**
 * GET /api/admin/budget?months=3
 *
 * What Tamilagaval costs, attributed from a LIVE inventory rather than a
 * hardcoded share — see `src/lib/aws-cost.ts` for why that distinction is the
 * whole point of this feature.
 *
 * ⚠️ COST EXPLORER CHARGES $0.01 PER REQUEST. A cost page that quietly costs
 * money to look at would be a bad joke, so the result is cached in DynamoDB
 * for 12 hours: the first view of the day costs a cent, the rest are free.
 * Worst case is about $0.30/month. Spend figures move by pennies as AWS
 * settles, so a 12-hour-old answer is no less true than a live one.
 *
 * ⚠️ REQUIRES `ce:GetCostAndUsage`. The runtime principal
 * (`poo-vaasam-app-user`) did NOT have it when this was written. Rather than
 * 500, the route reports `configured: false` and the page renders a banner
 * explaining what to attach — the same shape as the GA4 route's 503.
 *
 * Cost Explorer is a global service: it only answers in us-east-1, whatever
 * region the rest of the app runs in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { Route53Client, ListHostedZonesCommand } from '@aws-sdk/client-route-53';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { AmplifyClient, ListAppsCommand, ListBranchesCommand, ListJobsCommand } from '@aws-sdk/client-amplify';
import { awsConfig } from '@/lib/aws-config';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { amplifyShare, zoneShare, lambdaShare, summarise, type CostLine } from '@/lib/aws-cost';

export const dynamic = 'force-dynamic';

/** Cost Explorer only answers in us-east-1, regardless of where the app runs. */
const CE_REGION = 'us-east-1';
const OUR_APP_ID = 'd3rkmepk4popv0';
const OUR_ZONE = 'tamilagaval.com.';

const creds = awsConfig.credentials ? { credentials: awsConfig.credentials } : {};

/**
 * Cache key and window. 12 hours because spend figures move by pennies as AWS
 * settles — a half-day-old answer is no less true, and it caps the Cost
 * Explorer charge at ~2c/day however often the page is opened. The cache is
 * also the guard against an accidental polling loop, which is the real risk:
 * one bad useEffect could otherwise bill dollars a day.
 */
const CACHE_PK = 'BUDGET#COST';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function readCache(sk: string): Promise<unknown | null> {
  try {
    const row = await DynamoDBOperations.get({ PK: CACHE_PK, SK: sk });
    if (!row || typeof row.cachedAt !== 'string') return null;
    if (Date.now() - Date.parse(row.cachedAt) > CACHE_TTL_MS) return null;
    return row.payload ?? null;
  } catch {
    // A cache miss must never fail the request — worst case we pay a cent.
    return null;
  }
}

async function writeCache(sk: string, payload: unknown): Promise<void> {
  try {
    await DynamoDBOperations.put({
      PK: CACHE_PK,
      SK: sk,
      entityType: 'BUDGET_COST_CACHE',
      cachedAt: new Date().toISOString(),
      payload,
    });
  } catch {
    // Non-fatal: the answer is already computed and correct.
  }
}

function monthRange(months: number): { Start: string; End: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  return { Start: start.toISOString().slice(0, 10), End: end.toISOString().slice(0, 10) };
}

/** Build minutes per Amplify app for the current month — free to query. */
async function buildMinutes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const month = new Date().toISOString().slice(0, 7);
  for (const region of [awsConfig.region, CE_REGION]) {
    const client = new AmplifyClient({ region, ...creds });
    const apps = await client.send(new ListAppsCommand({}));
    for (const app of apps.apps ?? []) {
      if (!app.appId) continue;
      out[app.appId] ??= 0;
      const branches = await client.send(new ListBranchesCommand({ appId: app.appId }));
      for (const b of branches.branches ?? []) {
        if (!b.branchName) continue;
        const jobs = await client.send(
          new ListJobsCommand({ appId: app.appId, branchName: b.branchName, maxResults: 50 })
        );
        for (const j of jobs.jobSummaries ?? []) {
          const s = j.startTime, e = j.endTime;
          if (!s || !e || !s.toISOString().startsWith(month)) continue;
          out[app.appId] += (e.getTime() - s.getTime()) / 60000;
        }
      }
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const months = Math.max(1, Math.min(6, Number(request.nextUrl.searchParams.get('months') ?? '3')));

  const cacheKey = `months=${months}`;
  const cached = await readCache(cacheKey);
  if (cached) return NextResponse.json({ ...(cached as object), cached: true });

  try {
    const ce = new CostExplorerClient({ region: CE_REGION, ...creds });
    const period = monthRange(months);

    const res = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: period,
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      })
    );

    const latest = res.ResultsByTime?.[res.ResultsByTime.length - 1];
    const byService = new Map<string, number>();
    for (const g of latest?.Groups ?? []) {
      byService.set(g.Keys?.[0] ?? '', Number(g.Metrics?.UnblendedCost?.Amount ?? 0));
    }
    const accountTotal =
      Math.round([...byService.values()].reduce((a, b) => a + b, 0) * 100) / 100;

    const [minutes, zones, fns] = await Promise.all([
      buildMinutes(),
      new Route53Client({ region: CE_REGION, ...creds }).send(new ListHostedZonesCommand({})),
      new LambdaClient({ region: awsConfig.region, ...creds }).send(new ListFunctionsCommand({})),
    ]);

    const lines: CostLine[] = [
      amplifyShare(byService.get('AWS Amplify') ?? 0, minutes, OUR_APP_ID),
      zoneShare(
        byService.get('Amazon Route 53') ?? 0,
        OUR_ZONE,
        (zones.HostedZones ?? []).map((z) => z.Name ?? '')
      ),
      lambdaShare(
        byService.get('AWS Lambda') ?? 0,
        (fns.Functions ?? []).map((f) => f.FunctionName ?? '')
      ),
    ];

    // Revenue is supplied by the caller/UI rather than fetched here: YouTube
    // Analytics needs its own OAuth round-trip and this route is already
    // making four AWS calls. The page shows cost; revenue is layered on there.
    const body = {
      success: true,
      configured: true,
      period,
      summary: summarise(lines, accountTotal, 0),
    };
    await writeCache(cacheKey, body);
    return NextResponse.json({ ...body, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // An authorisation failure is a CONFIGURATION state, not a server fault —
    // the page should say "attach this policy", not "something went wrong".
    const denied = /AccessDenied|not authorized|UnauthorizedOperation/i.test(msg);
    if (denied) {
      return NextResponse.json(
        {
          success: false,
          configured: false,
          error:
            'The runtime principal cannot read Cost Explorer. Attach a policy allowing ' +
            'ce:GetCostAndUsage to poo-vaasam-app-user.',
        },
        { status: 200 }
      );
    }
    console.error('[API:BUDGET]', msg);
    return NextResponse.json({ success: false, error: 'Failed to load cost data' }, { status: 500 });
  }
}
