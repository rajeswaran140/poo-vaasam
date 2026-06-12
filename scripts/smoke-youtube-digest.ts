/**
 * SMOKE TEST — Weekly digest + anomaly, end-to-end against the LIVE API.
 *
 * Verifies the whole read pipeline: OAuth refresh → daily series + per-video
 * report → pure digest/anomaly math. Prints the digest and asserts it's well-
 * formed. Exits non-zero on failure so it can gate a deploy.
 *
 * Run (with OAuth env vars present):
 *   YOUTUBE_OAUTH_CLIENT_ID=... YOUTUBE_OAUTH_CLIENT_SECRET=... \
 *   YOUTUBE_REFRESH_TOKEN=... npx tsx scripts/smoke-youtube-digest.ts
 */

import { fetchDailySeries, fetchVideoAnalytics, isYouTubeAnalyticsConfigured } from '../src/lib/youtube-analytics';
import { buildDigest } from '../src/lib/youtube-digest';

async function main() {
  if (!isYouTubeAnalyticsConfigured()) {
    console.error('✗ SMOKE FAIL: YOUTUBE_OAUTH_* not set in env.');
    process.exit(2);
  }

  console.log('→ Fetching live daily series (28d) + this week’s videos …');
  const [seriesRes, videosRes] = await Promise.all([fetchDailySeries(28), fetchVideoAnalytics(7)]);
  if (!seriesRes.ok) {
    console.error(`✗ SMOKE FAIL: daily series errored: ${seriesRes.error}`);
    process.exit(1);
  }

  const digest = buildDigest(seriesRes.data, videosRes.ok ? videosRes.data : []);
  console.log(`  days of data : ${seriesRes.data.length}`);
  console.log(`  headline     : ${digest.headline}`);
  console.log(`  views WoW    : ${digest.weekOverWeek.views.current} (prior ${digest.weekOverWeek.views.prior}, Δ ${digest.weekOverWeek.views.deltaPct ?? '—'}%)`);
  console.log(`  subs WoW     : ${digest.weekOverWeek.subscribersGained.current}`);
  console.log(`  anomaly      : ${digest.anomaly.status} — ${digest.anomaly.message}`);
  console.log(`  top by views : ${digest.topByViews.map((v) => `${v.videoId}(${v.views})`).join(', ') || '—'}`);

  const okStatuses = ['normal', 'surging', 'cooling', 'stalled', 'insufficient'];
  if (seriesRes.data.length === 0) {
    console.error('✗ SMOKE FAIL: empty daily series.');
    process.exit(1);
  }
  if (!okStatuses.includes(digest.anomaly.status)) {
    console.error(`✗ SMOKE FAIL: unexpected anomaly status "${digest.anomaly.status}".`);
    process.exit(1);
  }
  if (!digest.headline) {
    console.error('✗ SMOKE FAIL: empty headline.');
    process.exit(1);
  }

  console.log('✓ SMOKE PASS: live weekly-digest pipeline works end-to-end.');
}

main().catch((err) => {
  console.error('✗ SMOKE FAIL (threw):', err instanceof Error ? err.message : err);
  process.exit(1);
});
