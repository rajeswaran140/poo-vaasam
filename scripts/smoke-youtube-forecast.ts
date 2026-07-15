/**
 * Smoke: run the PURE forecast/stats layer over the REAL stored METRICSNAP
 * series + the live subscriber count, and print the analysis. Read-only.
 *
 *   npx tsx scripts/smoke-youtube-forecast.ts
 */
import { readChannelMetricSeries } from '@/lib/youtube-metrics-history';
import { fetchChannelStats } from '@/lib/youtube-api';
import { analyzeChannel } from '@/lib/youtube-forecast';
import { SITE } from '@/config/site';

async function main() {
  const [series, stats] = await Promise.all([
    readChannelMetricSeries(180),
    fetchChannelStats(SITE.youtube.channelId),
  ]);
  const current = stats?.subscriberCount ?? 0;
  const asOf = new Date().toISOString().slice(0, 10);
  console.log(`series: ${series.length} days (${series[0]?.date} → ${series[series.length - 1]?.date})`);
  console.log(`current subscribers: ${current}`);

  const a = analyzeChannel(series, { current, target: 1000, asOf, window: 14 });
  const f = a.forecast;
  if (f) {
    console.log(`\n== FORECAST → 1000 subs ==`);
    console.log(`  remaining: ${f.remaining}`);
    console.log(`  pace: ${f.rate.ratePerDay.toFixed(1)} ± ${f.rate.stdErr.toFixed(1)} net subs/day (${f.rate.trendDirection}, ${f.rate.sampleDays}d)`);
    console.log(`  ETA: ${f.etaDays} days → ${f.etaDate}  (range ${f.etaDaysFast}–${f.etaDaysSlow ?? '∞'} days)`);
    if (f.caveat) console.log(`  caveat: ${f.caveat}`);
  }
  const v = a.viewsChange;
  if (v) console.log(`\n== VIEWS last ${v.recentDays}d vs prior ${v.priorDays}d ==\n  ${v.recentMean.toFixed(0)} vs ${v.priorMean.toFixed(0)} (${v.deltaPct?.toFixed(0)}%), t=${v.tStat.toFixed(2)} df=${v.df.toFixed(1)} p=${v.pValue.toFixed(4)} → ${v.significant ? `REAL ${v.direction}` : 'noise'}`);
  const s = a.subsChange;
  if (s) console.log(`\n== NET SUBS last ${s.recentDays}d vs prior ${s.priorDays}d ==\n  ${s.recentMean.toFixed(1)} vs ${s.priorMean.toFixed(1)} (${s.deltaPct?.toFixed(0)}%), p=${s.pValue.toFixed(4)} → ${s.significant ? `REAL ${s.direction}` : 'noise'}`);
  const r = a.reachShift;
  if (r) console.log(`\n== REACH SHIFT ==\n  most likely level change at ${r.date}: ${r.beforeMean.toFixed(0)} → ${r.afterMean.toFixed(0)} views/day, p=${r.pValue.toFixed(4)} ${r.significant ? '(significant)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
