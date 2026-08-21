/**
 * retention-boundary — does a specific MOMENT in a video lose the audience?
 *
 *   npx tsx scripts/retention-boundary.ts <videoId> <mm:ss> [--json]
 *   npx tsx scripts/retention-boundary.ts i_NxjvjUbkg 5:36
 *
 * Built for the paired song+instrumental format. `i_NxjvjUbkg` சாயங்கால
 * வானத்திலே runs 10:08 with the vocals ending at 5:36 — ratio 0.553. The
 * question Raj asked is whether the instrumental half is "distracting to
 * listeners", and that is exactly answerable: a cliff at 0.553 means the
 * instrumental loses them, a continued gentle decline means it holds.
 *
 * ⚠️ WHY NOT JUST READ THE DROP. Every retention curve falls. "30% of viewers
 * left across this window" is meaningless without knowing what the curve was
 * doing beforehand — so `boundaryDrop` compares the slope AFTER the boundary to
 * the slope leading INTO it, and only calls a cliff when the fall steepens.
 *
 * ⚠️ NEEDS FINALIZED DATA. YouTube backfills for ~72h; run this at least 4 days
 * after publish or the tail of the curve is still filling in.
 *
 * ⚠️ AVP IS NOT THE MEASURE HERE. A 10:08 video reports ~29% average view
 * percentage at this channel's near-constant ~2:54 of listening — that is
 * length arithmetic, not song quality. See the Video Length vs AVP note.
 *
 * Reads only. Needs YOUTUBE_OAUTH_CLIENT_ID/_SECRET + YOUTUBE_ANALYTICS_REFRESH_TOKEN
 * (Analytics) and YOUTUBE_API_KEY (duration). Never writes creds to disk.
 */
import { fetchRetentionCurve, isYouTubeAnalyticsConfigured } from '../src/lib/youtube-analytics';
import {
  parseRetentionRows,
  boundaryDrop,
  reboundAfter,
  summarizeCurve,
} from '../src/lib/youtube-retention';

const pct = (v: number | null) => (v === null ? '  n/a' : `${(v * 100).toFixed(1)}%`);

/** "5:36" | "1:02:03" | "336" -> seconds. */
function parseTimestamp(s: string): number {
  const parts = s.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

async function fetchDurationSeconds(videoId: string): Promise<number | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoId}&key=${key}`
  );
  if (!res.ok) return null;
  const json = await res.json();
  const iso: string | undefined = json.items?.[0]?.contentDetails?.duration;
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function main() {
  const [videoId, stamp] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const asJson = process.argv.includes('--json');
  if (!videoId || !stamp) {
    console.error('usage: npx tsx scripts/retention-boundary.ts <videoId> <mm:ss> [--json]');
    process.exit(2);
  }
  if (!isYouTubeAnalyticsConfigured()) {
    console.error('✗ YOUTUBE_OAUTH_CLIENT_ID/_SECRET/_REFRESH_TOKEN not set.');
    process.exit(2);
  }

  const boundarySeconds = parseTimestamp(stamp);
  if (!Number.isFinite(boundarySeconds)) {
    console.error(`✗ could not parse timestamp "${stamp}"`);
    process.exit(2);
  }

  const duration = await fetchDurationSeconds(videoId);
  if (!duration) {
    console.error('✗ could not read the video duration (needs YOUTUBE_API_KEY; premieres have none until live).');
    process.exit(1);
  }
  const ratio = boundarySeconds / duration;

  const res = await fetchRetentionCurve(videoId, 90);
  if (!res.ok) {
    console.error(`✗ analytics fetch failed: ${res.error}`);
    process.exit(1);
  }
  const curve = parseRetentionRows(res.data);
  if (!curve.length) {
    console.error('✗ empty curve — no finalized retention data yet. Wait until ~4 days after publish.');
    process.exit(1);
  }

  const d = boundaryDrop(curve, ratio);
  const rb = reboundAfter(curve, ratio);
  const sum = summarizeCurve(curve, duration);

  if (asJson) {
    console.log(
      JSON.stringify(
        { videoId, duration, boundarySeconds, ratio, boundary: d, rebound: rb, summary: sum },
        null,
        2
      )
    );
    return;
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  console.log(`\n${videoId} — ${mmss(duration)} long, boundary at ${mmss(boundarySeconds)} (${(ratio * 100).toFixed(1)}% in)`);
  console.log(`curve points: ${curve.length}\n`);
  console.log(`  hold  5%      ${pct(sum.hold5pct)}`);
  console.log(`  hold 25%      ${pct(sum.hold25pct)}`);
  console.log(`  hold 50%      ${pct(sum.hold50pct)}`);
  console.log(`  hold end      ${pct(sum.holdEnd)}\n`);
  console.log(`  BEFORE ${mmss(boundarySeconds)}   ${pct(d.before)}`);
  console.log(`  AFTER  ${mmss(boundarySeconds)}   ${pct(d.after)}`);
  console.log(`  lost across   ${pct(d.drop)}`);
  console.log(`  slope in      ${d.slopeBefore === null ? 'n/a' : d.slopeBefore.toFixed(2)} per unit elapsed`);
  console.log(`  slope out     ${d.slopeAfter === null ? 'n/a' : d.slopeAfter.toFixed(2)} per unit elapsed\n`);

  if (d.isCliff === null) {
    console.log('VERDICT: unknown — not enough curve either side of the boundary.');
  } else if (d.isCliff) {
    console.log('VERDICT: CLIFF. The fall steepens sharply at this point — the second half is');
    console.log('         losing listeners the first half was holding.');
  } else {
    console.log('VERDICT: NO CLIFF. Viewers leave across this point at about the rate they were');
    console.log('         already leaving — the boundary itself is not driving them away.');
  }

  // A retention curve can only fall from spillover — a viewer who left cannot
  // un-leave. So a RISE after the boundary means people are seeking to it.
  console.log();
  if (rb.isSeekIn === null) {
    console.log('SEEK-IN: unknown — no curve after the boundary.');
  } else if (rb.isSeekIn) {
    console.log(
      `SEEK-IN: YES — the curve CLIMBS ${pct(rb.rise)} after the boundary, peaking at ` +
        `${mmss((rb.atRatio ?? 0) * duration)} (${((rb.atRatio ?? 0) * 100).toFixed(1)}%).`
    );
    console.log('         Curves only fall from spillover, so viewers are jumping here on purpose.');
    console.log('         That is demand for the second half, not just tolerance of it.');
  } else {
    console.log('SEEK-IN: no. Nobody is jumping to the second half — everyone who hears it');
    console.log('         arrived by playing through.');
  }
  console.log();
}

main().catch((e) => {
  console.error('✗ unexpected error:', e);
  process.exit(1);
});
