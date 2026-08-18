# AdSense trial — setup and what it is measuring

**Decided 2026-08-18 by Raj**, with the economics understood and accepted.

## Why, honestly

Measured before starting: **501 pageviews / 28 days** (GA4), **1,741 / 90 days**.
At the RPM of the site's current traffic — overwhelmingly India, per Search
Console — that is **cents per month**, against an AdSense payout threshold of
**$100**.

The trial is not really about that revenue. The strategy is to reach Tamil
communities in **Europe, Canada and the USA**, where RPM runs roughly **10×**
India's. Ad revenue by country is therefore a *cheap instrument for measuring
whether the diaspora audience actually arrives* — a question GA4 answers less
directly, because a pageview from Toronto and one from Chennai look identical in
a pageview count but differ tenfold in ad value.

**Read the trial that way.** Revenue is the readout, not the goal.

## What is implemented

| piece | file | behaviour |
|---|---|---|
| Config + path rules | `src/lib/adsense.ts` | Inert unless a valid `ca-pub-…` id is set |
| Library loader | `src/components/ads/AdSense.tsx` | One script, `afterInteractive`, excluded paths ship nothing |
| Ad unit | `src/components/ads/AdSlot.tsx` | Reserves height (no layout shift), labelled, fails silently |
| `ads.txt` | `src/app/ads.txt/route.ts` | Generated from the env id; 404 while unconfigured |
| Placement | `src/app/content/[id]/page.tsx` | ONE unit, below the poem, above related songs |

### Deliberate choices

- **Auto ads are NOT enabled.** Auto ads let Google insert units anywhere,
  including mid-poem. Do not switch them on in the console — it would override
  the manual placement and put ads inside the work.
- **One unit per page, after the reading ends.** Below the poem, above the
  related-songs rail.
- **Height is reserved before the ad loads.** Ads that expand after load push
  text down under the reader's eye (Cumulative Layout Shift). The site's
  indexing went 6/70 → 55/71 in ten days; CLS is the easy way to lose that.
- **Excluded paths:** `/admin`, `/privacy`, `/terms`, `/contact`,
  `/music-composition`. Admin because it is a workspace, not an audience
  surface — and because Raj's own pageviews would pollute the trial.
  `/music-composition` because an ad beside a paid offer undercuts it.

## Setup — the parts only Raj can do

1. **Apply** at adsense.google.com with `tamilagaval.com`. Approval needs real
   content; the song pages are currently thin stubs, which is the same weakness
   Search Console reports. Approval is not guaranteed on the first try.
2. **Set in Amplify** → App settings → Environment variables, then redeploy:
   - `NEXT_PUBLIC_ADSENSE_CLIENT` = `ca-pub-…`
   - `NEXT_PUBLIC_ADSENSE_SLOT_CONTENT` = the unit id, once created
   Until both are set nothing renders and no request fires.
3. ⚠️ **Turn ON Privacy & messaging → GDPR message** in the AdSense console.
   **This is not optional.** Europe is named in the strategy, and Google
   requires a certified consent solution for EEA/UK traffic. Google's own
   message is certified and free, and is delivered by the same script the site
   already loads — so there is nothing to build, but it must be switched on.
4. **Verify `ads.txt`** resolves at `https://tamilagaval.com/ads.txt` after the
   redeploy. Missing ads.txt is the most common reason a new publisher's revenue
   quietly stays near zero — Google flags "Earnings at risk" and restricts demand.

## How to judge the trial

Give it **90 days** — below that, 500 pageviews/month cannot produce a readable
signal.

Judge on **revenue by country**, not total revenue. Total will be tiny either
way. The question is whether Germany / Canada / USA / UK appear at all and what
share they take. That answers the strategic question.

**Stop conditions — abandon the ads, not the strategy, if:**
- Core Web Vitals regress, or indexed-page count falls
- Approval requires enabling auto ads
- Revenue is entirely India-sourced after 90 days (the diaspora hypothesis
  failed, and ads add nothing)

## The thing ads cannot fix

500 pageviews a month cannot fund anything, whatever is bolted onto it. Any
revenue plan for the site is a traffic plan. Search Console shows near-zero
demand for the song titles and pages too thin to compete; the lever is depth on
the strongest songs, in Raj's own words — never AI-written
(`feedback_poo_vaasam_editorial_seo_copy`), and never by publishing lyrics
(`project_poo_vaasam_musical_journey`).

The channel — 387,117 lifetime views, YPP accepted — remains the earning surface.
