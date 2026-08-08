/**
 * Impressions log — pure helpers.
 *
 * WHY THIS EXISTS. `impressions` and `impressionsClickThroughRate` are NOT in
 * the YouTube Analytics API (requesting them returns HTTP 400 "Unknown
 * identifier" while a views query on the same window succeeds). They are
 * Studio-only. So every automated read here uses suggested-video views as a
 * PROXY, and every conversation about reach has had Raj arguing from Studio
 * numbers nobody else can see while the tooling argued from a proxy. That is a
 * bad position to keep re-entering — it has now happened five times. This turns
 * the argument into a measurement: Raj types what Studio shows, dated, and from
 * then on it can be trended, compared and cited.
 *
 * The log is deliberately HUMAN-SOURCED and says so. Nothing here should ever
 * be back-filled from an API, because no API has the numbers.
 */

/** One dated reading copied from YouTube Studio → Analytics → Reach. */
export interface ImpressionEntry {
  /** 11-char videoId, or 'CHANNEL' for the channel-wide figure. */
  scope: string;
  /** Impressions over the window. */
  impressions: number;
  /** Click-through rate as a PERCENT (Studio shows e.g. 4.2, not 0.042). */
  ctr: number;
  /** Views over the same window, if noted — lets us cross-check CTR. */
  views?: number;
  /** Studio window the reading covers (Studio's default card is 28). */
  windowDays: number;
  /** ISO timestamp the reading was taken. */
  observedAt: string;
  note?: string;
}

export const CHANNEL_SCOPE = 'CHANNEL';

/** Studio reports CTR as a percent; anything outside this is a typo, not data. */
export const MAX_CTR_PERCENT = 100;

export interface EntryIssue {
  field: string;
  message: string;
}

/**
 * Validate a reading before it is stored.
 *
 * The cross-check matters more than it looks. impressions x ctr should be
 * roughly the views the video got from those impressions — never MORE than
 * total views, since impressions cannot convert into views that don't exist.
 * A reading that implies more clicks than views usually means CTR was entered
 * as a fraction (0.042) instead of a percent (4.2), which would otherwise sit
 * in the log looking plausible and quietly corrupt every trend drawn from it.
 */
export function validateEntry(e: Pick<ImpressionEntry, 'impressions' | 'ctr' | 'views'>): EntryIssue[] {
  const issues: EntryIssue[] = [];
  if (!Number.isFinite(e.impressions) || e.impressions < 0) {
    issues.push({ field: 'impressions', message: 'must be a non-negative number' });
  }
  if (!Number.isFinite(e.ctr) || e.ctr < 0 || e.ctr > MAX_CTR_PERCENT) {
    issues.push({ field: 'ctr', message: `must be a percent between 0 and ${MAX_CTR_PERCENT} (Studio shows 4.2, not 0.042)` });
  }
  if (e.views != null) {
    if (!Number.isFinite(e.views) || e.views < 0) {
      issues.push({ field: 'views', message: 'must be a non-negative number' });
    } else if (issues.length === 0) {
      const impliedClicks = e.impressions * (e.ctr / 100);
      if (impliedClicks > e.views * 1.05) {
        issues.push({
          field: 'ctr',
          message:
            `impressions x CTR = ${Math.round(impliedClicks).toLocaleString()} clicks but only ` +
            `${e.views.toLocaleString()} views — check CTR is a percent, not a fraction`,
        });
      }
    }
  }
  return issues;
}

export interface EntryDelta {
  entry: ImpressionEntry;
  /** Percent change vs the previous reading for the same scope; null if first. */
  impressionsChangePct: number | null;
  ctrChangePts: number | null;
  /** Days between this reading and the previous one. */
  daysSincePrevious: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Newest-first readings annotated with change vs the reading before them.
 *
 * Input may arrive in any order; it is sorted here rather than trusting the
 * caller, because the DynamoDB query and the UI both have their own ideas about
 * direction and a silently mis-ordered series produces sign-flipped deltas.
 */
export function withDeltas(entries: ImpressionEntry[]): EntryDelta[] {
  const sorted = [...entries].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return sorted.map((entry, i) => {
    const prev = sorted[i + 1];
    if (!prev) return { entry, impressionsChangePct: null, ctrChangePts: null, daysSincePrevious: null };
    const days = Math.round((Date.parse(entry.observedAt) - Date.parse(prev.observedAt)) / DAY_MS);
    return {
      entry,
      impressionsChangePct:
        prev.impressions > 0 ? ((entry.impressions - prev.impressions) / prev.impressions) * 100 : null,
      ctrChangePts: entry.ctr - prev.ctr,
      daysSincePrevious: Number.isFinite(days) ? days : null,
    };
  });
}

/**
 * The reading that actually matters: did impressions and CTR move together or
 * in opposite directions?
 *
 * Falling impressions WITH rising CTR is the signature of a narrowing, better
 * matched funnel — YouTube prunes marginal viewers first, so the ones left
 * click more. Falling impressions WITH falling CTR is the genuinely bad case:
 * fewer chances AND worse conversion on the ones offered.
 *
 * ⚠️ This describes; it does not establish cause. Retention and CTR both rise
 * mechanically as a funnel narrows, whichever direction causation runs — an
 * earlier version of the admin doc claimed otherwise and was wrong.
 */
export function interpret(d: EntryDelta): string {
  if (d.impressionsChangePct == null || d.ctrChangePts == null) return 'First reading — no comparison yet.';
  const imp = d.impressionsChangePct;
  const ctr = d.ctrChangePts;
  const impWord = Math.abs(imp) < 5 ? 'flat' : imp > 0 ? 'up' : 'down';
  const ctrWord = Math.abs(ctr) < 0.2 ? 'flat' : ctr > 0 ? 'up' : 'down';
  if (impWord === 'down' && ctrWord === 'up') {
    return 'Impressions down, CTR up — narrower but better-matched distribution, not a quality problem.';
  }
  if (impWord === 'down' && ctrWord === 'down') {
    return 'Impressions AND CTR down — the one combination worth acting on: fewer chances and worse conversion.';
  }
  if (impWord === 'up' && ctrWord === 'down') {
    return 'Impressions up, CTR down — being shown to a broader, less well-matched audience.';
  }
  if (impWord === 'up' && ctrWord === 'up') return 'Impressions and CTR both up — expanding and converting.';
  return 'Broadly unchanged since the last reading.';
}
