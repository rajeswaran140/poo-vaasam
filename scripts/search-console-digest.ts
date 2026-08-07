/**
 * search-console-digest — weekly search visibility for tamilagaval.com.
 *
 *   npx tsx scripts/search-console-digest.ts            # human summary
 *   npx tsx scripts/search-console-digest.ts --json     # machine readable
 *   npx tsx scripts/search-console-digest.ts --no-index # skip the slow sweep
 *
 * WHY THIS EXISTS. Impressions are not in the YouTube Analytics API, and until
 * 2026-08-07 nobody had ever read Search Console for this domain — so the site's
 * actual search position was invisible while decisions were being made about it.
 * The first read was sobering: 91 impressions and 4 distinct queries in 73 days,
 * and 25 of 35 inspected pages sitting at "Discovered - currently not indexed".
 * That is a fact you want on a schedule, not rediscovered by accident.
 *
 * WHAT TO WATCH, in order of meaning:
 *   1. indexed count — pages Google refuses to index cannot rank at all. This is
 *      the gate; impressions are downstream of it.
 *   2. distinct queries — the demand signal. Impressions can rise on one lucky
 *      query; query COUNT rising means more of the catalogue is findable.
 *   3. impressions/clicks — only meaningful once 1 and 2 move.
 * Average position and CTR have been fine all along (3.7 in India, 12% CTR).
 * They are not the problem and improving them is not the lever.
 *
 * AUTH: service account `tamilagaval-ga4-reader@tamilagaval-prod-2026`, added
 * as a Full user on the sc-domain property. JWT is signed with node:crypto
 * rather than google-auth-library, which is only a transitive dependency here
 * and would break this script the day @google-analytics/data drops it.
 * Never writes the key or the token to disk.
 */
import { createSign } from 'node:crypto';

const SITE = 'sc-domain:tamilagaval.com';
const SITEMAP = 'https://tamilagaval.com/sitemap.xml';
/** Search Console finalises slowly; anything inside this window is incomplete. */
const LAG_DAYS = 3;
const INSPECT_CONCURRENCY = 5;

interface SearchRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }
interface Totals { clicks: number; impressions: number; ctr: number; position: number }

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

async function mintToken(): Promise<string> {
  const raw = process.env.GA4_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GA4_SERVICE_ACCOUNT_KEY is required');
  const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString());

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${signer.sign(sa.private_key, 'base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`token mint failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

async function search(token: string, body: Record<string, unknown>): Promise<SearchRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`searchAnalytics: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { rows?: SearchRow[] }).rows ?? [];
}

async function totals(token: string, startDate: string, endDate: string): Promise<Totals> {
  const rows = await search(token, { startDate, endDate, dimensions: [] });
  const r = rows[0];
  return r
    ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

async function sitemapUrls(): Promise<string[]> {
  const xml = await (await fetch(SITEMAP)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function inspect(token: string, url: string): Promise<string> {
  try {
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE }),
    });
    if (!res.ok) return `ERROR ${res.status}`;
    const j = (await res.json()) as { inspectionResult?: { indexStatusResult?: { coverageState?: string } } };
    return j.inspectionResult?.indexStatusResult?.coverageState ?? 'unknown';
  } catch {
    return 'ERROR request';
  }
}

/** Inspect with a small worker pool — the API is ~3s per URL, serial is far too slow. */
async function inspectAll(token: string, urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: INSPECT_CONCURRENCY }, async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        out.set(url, await inspect(token, url));
      }
    })
  );
  return out;
}

function pct(now: number, before: number): string {
  if (!before) return now ? '  new' : '   0%';
  return `${(((now - before) / before) * 100).toFixed(0).padStart(4)}%`;
}

async function main() {
  const asJson = process.argv.includes('--json');
  const skipIndex = process.argv.includes('--no-index');
  const token = await mintToken();

  const end = isoDay(LAG_DAYS);
  const recentStart = isoDay(LAG_DAYS + 6);
  const priorEnd = isoDay(LAG_DAYS + 7);
  const priorStart = isoDay(LAG_DAYS + 13);

  const [recent, prior, queries, pages, countries] = await Promise.all([
    totals(token, recentStart, end),
    totals(token, priorStart, priorEnd),
    search(token, { startDate: recentStart, endDate: end, dimensions: ['query'], rowLimit: 20 }),
    search(token, { startDate: recentStart, endDate: end, dimensions: ['page'], rowLimit: 10 }),
    search(token, { startDate: recentStart, endDate: end, dimensions: ['country'], rowLimit: 5 }),
  ]);

  const coverage: Record<string, number> = {};
  let notIndexed: string[] = [];
  if (!skipIndex) {
    const urls = await sitemapUrls();
    const states = await inspectAll(token, urls);
    for (const state of states.values()) coverage[state] = (coverage[state] ?? 0) + 1;
    notIndexed = [...states.entries()]
      .filter(([, s]) => s !== 'Submitted and indexed' && !s.includes('Indexed'))
      .map(([u]) => u.replace('https://tamilagaval.com', '') || '/');
  }

  if (asJson) {
    console.log(JSON.stringify(
      { window: { recentStart, end, priorStart, priorEnd }, recent, prior, queries, pages, countries, coverage, notIndexed },
      null, 2));
    return;
  }

  const indexed = coverage['Submitted and indexed'] ?? 0;
  const total = Object.values(coverage).reduce((a, b) => a + b, 0);

  console.log(`SEARCH CONSOLE — ${recentStart} .. ${end}  (vs ${priorStart} .. ${priorEnd})\n`);
  if (!skipIndex) {
    console.log(`INDEXED           ${indexed} / ${total} sitemap URLs`);
    for (const [state, n] of Object.entries(coverage).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${state}`);
    }
    console.log('');
  }
  console.log(`impressions       ${String(recent.impressions).padStart(6)}   ${pct(recent.impressions, prior.impressions)}`);
  console.log(`clicks            ${String(recent.clicks).padStart(6)}   ${pct(recent.clicks, prior.clicks)}`);
  console.log(`distinct queries  ${String(queries.length).padStart(6)}`);
  console.log(`avg position      ${recent.position.toFixed(1).padStart(6)}   (was ${prior.position.toFixed(1)})`);
  console.log(`CTR               ${(recent.ctr * 100).toFixed(1).padStart(6)}%`);

  const section = (title: string, rows: SearchRow[]) => {
    console.log(`\n--- ${title} ---`);
    if (!rows.length) { console.log('  (none)'); return; }
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${r.keys[0].slice(0, 50).padEnd(52)} imp ${String(r.impressions).padStart(4)}  `
        + `clk ${String(r.clicks).padStart(3)}  pos ${r.position.toFixed(1).padStart(5)}`);
    }
  };
  section('queries', queries);
  section('pages', pages);
  section('countries', countries);

  if (notIndexed.length) {
    console.log(`\n--- not indexed (${notIndexed.length}) ---`);
    for (const u of notIndexed.slice(0, 25)) console.log(`  ${u}`);
    if (notIndexed.length > 25) console.log(`  … and ${notIndexed.length - 25} more`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
