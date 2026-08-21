/**
 * SMOKE TEST — Retention Intelligence, end-to-end against the LIVE YouTube
 * Analytics API.
 *
 * Verifies the whole read pipeline works against production data:
 *   OAuth refresh-token grant → audienceRetention report → pure analysis.
 *
 * Run (with the OAuth env vars present in the process):
 *   YOUTUBE_OAUTH_CLIENT_ID=... YOUTUBE_OAUTH_CLIENT_SECRET=... \
 *   YOUTUBE_ANALYTICS_REFRESH_TOKEN=... npx tsx scripts/smoke-youtube-retention.ts [videoId]
 *
 * Defaults to the channel's known high-retention template (முத்தமிழின்),
 * which has finalized data, so the smoke test asserts a real, non-'unknown'
 * verdict. Exits non-zero on any failure so it can gate a deploy.
 */

import { fetchRetentionCurve, isYouTubeAnalyticsConfigured } from '../src/lib/youtube-analytics';
import { analyzeRetention, parseRetentionRows } from '../src/lib/youtube-retention';

const VIDEO_ID = process.argv[2] || 'J2tc_aUNOPA'; // முத்தமிழின் — the template

async function main() {
  if (!isYouTubeAnalyticsConfigured()) {
    console.error('✗ SMOKE FAIL: YOUTUBE_OAUTH_CLIENT_ID/_SECRET/_REFRESH_TOKEN not set in env.');
    process.exit(2);
  }

  console.log(`→ Fetching live retention curve for ${VIDEO_ID} …`);
  const res = await fetchRetentionCurve(VIDEO_ID, 90);
  if (!res.ok) {
    console.error(`✗ SMOKE FAIL: analytics fetch errored: ${res.error}`);
    process.exit(1);
  }

  const curve = parseRetentionRows(res.data);
  const analysis = analyzeRetention(curve, { benchmarkCurve: curve }); // self-benchmark
  console.log(`  curve points: ${curve.length}`);
  console.log(`  hold @10%   : ${fmt(analysis.holdAtCheckpoint)}`);
  console.log(`  summary     : 5%=${fmt(analysis.summary.hold5pct)} 25%=${fmt(analysis.summary.hold25pct)} 50%=${fmt(analysis.summary.hold50pct)} end=${fmt(analysis.summary.holdEnd)}`);
  console.log(`  verdict     : ${analysis.verdict}`);

  // Assertions: the template must have real, finalized data.
  if (curve.length === 0) {
    console.error('✗ SMOKE FAIL: empty curve — no finalized data for this video.');
    process.exit(1);
  }
  if (analysis.verdict === 'unknown') {
    console.error('✗ SMOKE FAIL: verdict is "unknown" despite a non-empty curve.');
    process.exit(1);
  }
  if (analysis.holdAtCheckpoint == null || analysis.holdAtCheckpoint <= 0) {
    console.error('✗ SMOKE FAIL: 10% hold is not a positive number.');
    process.exit(1);
  }

  console.log('✓ SMOKE PASS: live retention pipeline works end-to-end.');
}

const fmt = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

main().catch((err) => {
  console.error('✗ SMOKE FAIL (threw):', err instanceof Error ? err.message : err);
  process.exit(1);
});
