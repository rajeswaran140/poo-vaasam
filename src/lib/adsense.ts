/**
 * Google AdSense configuration.
 *
 * A TRIAL (Raj, 2026-08-18). The site measured 501 pageviews in 28 days, which
 * at Indian RPM (~$0.30–1.50) would earn cents. The trial is worth running for
 * a different reason: the strategy targets Tamil communities in Europe, Canada
 * and the USA, where RPM is roughly 10x India's. So this measures whether the
 * diaspora audience actually arrives — the revenue is the instrument, not the
 * goal.
 *
 * ⚠️ INERT UNTIL CONFIGURED. With no publisher id, no script ships and no
 * request fires — same contract as {@link GA_ID}. Set in Amplify:
 *
 *   NEXT_PUBLIC_ADSENSE_CLIENT   e.g. ca-pub-0000000000000000
 *
 * ⚠️ This is Raj's EXISTING publisher id — the one already earning on YouTube.
 * Google allows ONE AdSense account per person; never open a second. A YouTube
 * account may be HOSTED (Google surfaces only), in which case it is UPGRADED by
 * adding tamilagaval.com under Sites — not replaced.
 *
 * ⚠️ EEA/UK CONSENT IS NOT OPTIONAL and is NOT implemented in this code.
 * Google requires a certified CMP for European traffic, and Europe is named in
 * the strategy. Use Google's own **Privacy & messaging → GDPR message** in the
 * AdSense console: it is certified, free, and delivered by the same script this
 * module loads, so there is nothing to build — but it must be switched ON
 * there, or European impressions serve non-personalised ads at best and breach
 * policy at worst. See docs/ADSENSE_TRIAL.md.
 */

/** Publisher id. Public by design — it ships in the script URL. */
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || '';

/**
 * Ad-unit id for the single slot on song/content pages.
 *
 * Separate from the publisher id because they are created at different times:
 * the publisher id exists as soon as the account is approved, the unit only
 * once Raj creates it. Empty = that slot renders nothing, so the site is safe
 * to deploy between those two moments.
 */
export const ADSENSE_SLOT_CONTENT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_CONTENT || '';

/** True when a publisher id is configured. Nothing renders otherwise. */
export function isAdSenseConfigured(): boolean {
  return /^ca-pub-\d{10,}$/.test(ADSENSE_CLIENT);
}

/**
 * Paths that must NEVER carry ads.
 *
 * `/admin` because it is Raj's workspace, not an audience surface, and ad
 * scripts there would both look absurd and pollute the trial's numbers with
 * his own pageviews. The others are transactional or legal pages where an ad
 * beside the text would undercut the page's purpose.
 */
const NEVER: readonly string[] = ['/admin', '/privacy', '/terms', '/contact', '/music-composition'];

export function adsAllowedOn(pathname: string): boolean {
  if (!isAdSenseConfigured()) return false;
  return !NEVER.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
