# WhatsApp Integration — Audit (2026-07-14)

Full frontend + backend audit of the WhatsApp/share surface, triggered by the
question *"is the WhatsApp integration actually working?"*

Every finding is listed, including the ones deliberately **not** fixed. Fixed
items link to the PR that fixed them; open items say why they're still open.

---

## TL;DR — the strategic finding

**The share machinery measured the wrong half of the loop, and the half it
measured happens on a surface nobody is on.**

Three facts from YouTube Analytics (Jun 1 – Jul 11 2026, 213,046 views):

| | |
|---|---|
| Algorithm-fed views (suggested/playlist/browse) | **84.3%** |
| YouTube search | **0.3%** (709 views across 71 videos) |
| External (all sites/apps) | **1.3%** (2,842 views) |
| **tamilagaval.com → YouTube referrals** | **ZERO. Not one.** |

Every site-side share feature — `ShareRow`, `WhatsAppShareButton` on every song
row, the `/status` gallery, UTM tagging, the OG-card fix — is well-built and
lives on a site that sends no measurable traffic anywhere. The pipe is sound;
there's no water in it.

Meanwhile the WhatsApp forwarding that *does* happen (~90% of all external
traffic — 1,578 "WhatsApp" + 958 "whatsapp.com" + 64 "WhatsApp Business") is the
audience forwarding **from inside the YouTube app**, unassisted by anything we
built.

**The WhatsApp referral coefficient** — WhatsApp-referred views per 1,000 channel
views — is the number that decides whether any of this works:

| Week | Channel views | WhatsApp returned | per 1,000 |
|---|---|---|---|
| Jun 15–21 | 29,439 | 357 | **12.1** |
| Jun 22–28 | 45,417 | 559 | **12.3** |
| Jun 29–Jul 5 | 81,360 | 1,028 | **12.6** |
| Jul 6–11 | 47,044 | 553 | **11.8** |

Dead flat at ~1.2% while channel views nearly tripled. WhatsApp is currently an
**echo** of reach, not a source of it (a self-sustaining loop needs >1,000/1,000).
Note the site-side share features all shipped **Jun 22–24** — the coefficient went
from 12.1 to 12.6. Within noise. **They did not move the number.**

**Implication:** the intervention has to happen where the audience actually is —
inside YouTube (pinned comment / description / in-video CTA) — not on the
website. And the coefficient must be visible in the product so we can tell.
That's what the fixes below make possible.

---

## Two systems, easily confused

There were two unrelated "share" systems, and the naming hid it:

| System | Measures | Surface | Source of truth |
|---|---|---|---|
| First-party beacon (`trackShare` → `/api/events` → DynamoDB) | clicks on **our own** buttons | the website | `lib/analytics-events`, `lib/analytics-store` |
| `SharesPanel` (`/admin/youtube`) | **YouTube's native** Share button | YouTube | `lib/song-shares`, `fetchVideoShares` |
| **`ReferralCoefficientPanel`** *(new)* | **views coming BACK** | YouTube EXT_URL | `lib/whatsapp-referrals` |

The first two both measure *outbound intent*. Only the third — which did not
exist — measures whether a share **worked**. Don't conflate them.

---

## Findings

### Fixed — PR: `fix/xff-rate-limit-bypass`

| # | Severity | Finding |
|---|---|---|
| **S1** | **HIGH (security)** | **`clientIp()` trusted the leftmost `X-Forwarded-For` hop.** CloudFront (which fronts Amplify) does **not replace** a client-supplied XFF — it **appends** the real viewer IP. So the leftmost entry is attacker-controlled: rotate a fake first hop and you land in a fresh rate-limit bucket every request, defeating the limiter entirely. Blast radius is far wider than WhatsApp — the same helper keys **12 routes**, including `/api/ai/*` and `/api/tts/*`, which spend real money (OpenAI / Anthropic / Google TTS) per request. Fixed by counting back from the right (`TRUSTED_PROXY_HOPS`, default 1) and dropping the `x-real-ip` fallback, which nothing in our infra sets and which was therefore just another spoofable bypass. `src/lib/rate-limit.ts:95` |

> The old test suite **asserted the vulnerable behaviour** (`'uses the first entry
> of x-forwarded-for'`), so the bug was enshrined in green tests. Replaced with a
> spec covering the spoofed prefix, the rotating-prefix bypass, genuine-viewer
> separation, IPv6, whitespace, and `x-real-ip` non-trust.

### Fixed — PR: `feat/whatsapp-measurement`

**Measurement correctness**

| # | Severity | Finding |
|---|---|---|
| **M1** | **HIGH** | **Missing: the referral coefficient.** No query anywhere used `insightTrafficSourceType==EXT_URL` with `insightTrafficSourceDetail`. The return leg — the only metric that says whether sharing works — did not exist in the product. Added `lib/whatsapp-referrals` + `GET /api/admin/youtube/referrals` + `ReferralCoefficientPanel`, mounted **above** `SharesPanel` on `/admin/youtube`. |
| **M2** | **HIGH** | **Share-rate leaderboard was selection-biased.** The candidate pool was *top-N **by views***, and the UI then offered to rank that pool by *rate*. A low-view/high-rate song — precisely the share-worthy outlier the rate metric exists to find — was filtered out **before its rate was ever computed**. The feature was structurally blind to its own purpose. Pool is now selected by **eligibility** (a `minViews` floor); `topN` only trims the display list. `src/lib/song-shares.ts:69` |
| **M3** | **MEDIUM** | **A failed API call became a genuine-looking zero.** `shares.get(id) ?? 0` meant a 429/5xx was indistinguishable from "nobody shared it", and silently ranked the song last. Unknown is now `null` (never 0), surfaced as "—" in the UI with a "that is not a zero" notice, and the failed ids are returned in `failedVideoIds`. `src/lib/song-shares.ts:74` |
| **M4** | **MEDIUM** | **Unbounded fan-out.** Up to 50 parallel Analytics calls via a bare `Promise.all`, against Amplify's ~30s origin budget — and per M3 a throttled call degraded to "0 shares" rather than an error. Now bounded by `mapWithConcurrency` (new `lib/concurrency.ts`) + a `maxCandidates` cap. |
| **M5** | LOW | **`?topN=` (empty param) clamped to 1**, not to the default — `Number('')` is `0`. Found by the new route test. `src/app/api/admin/youtube/shares/route.ts` |

> **WhatsApp label merge (important).** YouTube reports WhatsApp under *several*
> `insightTrafficSourceDetail` strings — `WhatsApp`, `whatsapp.com`,
> `WhatsApp Business`, `web.whatsapp.com`. Counting only the first **undercounts
> the coefficient by ~40%**. `isWhatsAppSource()` substring-matches so a new label
> variant can't silently drop out.

**Attribution plumbing**

| # | Severity | Finding |
|---|---|---|
| **A1** | **MEDIUM** | **`trackShare` dropped `songId` before the beacon.** It handed the song id to GA4 and then called `beacon('share', channel)` — so per-song share data never reached DynamoDB, and *"which song do people forward?"* was unanswerable from our own data. `songId` now rides the beacon; the server derives a `share_song` counter (`derivedSongEvent`). The channel-keyed counter is **unchanged** — the existing dashboard depends on it. `src/lib/analytics-events.ts:104` |
| **A2** | **MEDIUM** | Same defect in **`trackInbound`** — the `utm_content` song id was parsed then discarded. Now derives `inbound_song`. `src/lib/analytics-events.ts:121` |
| **A3** | LOW | Derived types (`share_song`, `inbound_song`) are **server-written only** — `eventBeaconSchema` accepts only `EVENT_TYPES`, so a public caller can't inject arbitrary per-song counters. |
| **A4** | LOW | Call sites now pass `songId`: `ShareRow`, `WhatsAppShareButton`, `/songs/[theme]`, `FeaturedSongs`. |

**Frontend defects**

| # | Severity | Finding |
|---|---|---|
| **F1** | **HIGH** | **The YouTube-URL attribution leak.** `FeaturedSongs` and `VideoGallery` shared a **YouTube watch URL** with `utm_source=whatsapp` appended. YouTube ignores our UTMs and `InboundTracker` only runs on our own domain — so those shares **looked instrumented and measured nothing**. Both already knew the on-site path (they render an "இந்தப் பாடல் →" link from it!) and shared the YouTube URL anyway. Now share the song page, which carries the embed + a YouTube CTA, so the funnel still ends at YouTube. |
| **F2** | **MEDIUM** | **`ShareRow` hydration mismatch.** `canNativeShare` was read from `navigator` **during render** → `false` on the server (button omitted), `true` on the client (button present) — a mismatch on every mobile visit to `/content/[id]`. Now resolved in an effect. `src/components/content/ShareRow.tsx:44` |
| **F3** | **MEDIUM** | **`/status` counted shares that never happened.** `trackShare` fired at the **top** of `handleShare`, so a dismissed share sheet (`AbortError`) still counted. Now fires only after the share **resolves**. |
| **F4** | **MEDIUM** | **`/status` blocked-popup bug + wasted 1.3 MB.** The code fetched the whole clip, *then* discovered `canShare({files})` was false, and only then called `window.open` — past an `await`, outside the user-gesture window, so the popup was blocked. The user saw nothing happen while the share was already counted. Now probes file-share support with an **empty placeholder `File`** before downloading anything, and falls back **inside the gesture**. |
| **F5** | **MEDIUM** | **The `/status` Download button was never tracked** — and it's the *documented desktop route* to Status, so the entire desktop workflow was invisible. Now `whatsapp_status_download`. The wa.me fallback is also its own channel (`whatsapp_status_link`), because a link share is a materially weaker action than posting the clip and lumping them together overstated Status. |
| **F6** | **MEDIUM** | **Only the WhatsApp link was UTM-tagged.** On a phone, the **native sheet** and **copy-link** are the commonest ways a link actually reaches WhatsApp, and both handed over a bare URL → the return visit arrived as "direct" and `InboundTracker` never fired. All outbound URLs are now tagged (`native`, `copy`, `facebook`, `twitter` added to the `KNOWN_SOURCES` allow-list). We can't know which app the OS sheet chose, so we attribute by **surface**, honestly. |
| **F7** | LOW | **`/songs/[theme]` had no share control at all** — despite being the SEO landing surface for a theme. Added (as a **sibling** of the card link, not nested inside it: interactive content inside an `<a>` is invalid HTML). |
| **F8** | LOW | **`clipForSong()` was dead code** — the song-page "Share to Status" entry point it was written for was never wired, so `/status` was reachable only from the nav, never when a visitor was actually engaged with a song. Now wired on `/content/[id]`. |
| **F9** | LOW | **`FEATURES.PUBLIC.SOCIAL_SHARE: false` was dead config** — zero consumers, while share buttons shipped everywhere. The config actively lied (ironic, given the note directly above it warning against exactly that). Removed. |

**Clean, verified:** all 11 `/status` clips + posters exist on disk and are
test-asserted; admin read routes are correctly gated behind Cognito
(`requireAdmin`); the `share` beacon → DynamoDB → `/admin/analytics` path works
end-to-end; the `sharesPer1k` arithmetic was correct.

---

## Open — deliberately not fixed

| # | Severity | Finding | Why open |
|---|---|---|---|
| **O1** | **MEDIUM** | **Single hot `PK="EVENT"` partition with unbounded SK cardinality.** `target` is free-form (≤120 chars) and becomes part of the SK, so a caller can write unbounded distinct items into one partition. | The rate-limit fix (S1) closes the practical abuse path. Sharding to `EVENT#<month>` is a storage change worth doing on its own, not smuggled into this PR. Volume is nowhere near the limit. |
| **O2** | LOW | **`POST /api/events` is public and unauthenticated** — no Origin check, no CSRF token, no dedup. | By design for a beacon (it must work from `sendBeacon` on unload). With S1 fixed the rate limiter actually holds. Treat first-party counts as a *floor*, not a forensic record. |
| **O3** | LOW | **GA4 `share` custom dimensions are write-only.** `ga4-api.ts` has no share fetcher, so `source_song_id` / `status_asset_id` are visible only in the GA4 console. | Superseded in practice: A1/A2 now put per-song data in **DynamoDB**, which we own and can read. Reading it back from GA4 as well is redundant. |
| **O4** | LOW | **`/status` fails silently to its empty state** when the catalogue read errors at build — "broken" and "no clips yet" look identical. | Needs a build-time signal / alert, not a UI change. Worth a follow-up. |
| **O5** | LOW | **`/popular` is a near-orphan** — no `Header`/`Footer` nav entry; its only inbound link is the home rail. | It's designed as a "drop it in WhatsApp" landing page, so orphan-ness is arguably fine. Raj's call. |
| **O6** | — | **The site sends zero traffic to YouTube, so all site-side share work is currently unmeasurable in practice.** | **Not a bug — the strategic finding.** Don't build more site-side share surface until the site has traffic (i.e. until the search-discoverability work lands). The fixes above make the *existing* surface correct and measurable; they will not, by themselves, move the coefficient. |

---

## How to tell if any of this worked

Watch **`whatsappPer1k`** on `/admin/youtube` (the Referral Coefficient panel).
Baseline: **~12 per 1,000, flat for six weeks.** That's an unusually clean
baseline — any intervention either moves it or it doesn't, and you'll see it
within a week.

The recommended next intervention is **not** more website features. It's a share
CTA where the 84% actually are: a pinned comment + description link + an in-video
prompt on the top songs. That's copy and YouTube Studio, not code.

Secondary signal now available: the **per-song share leaderboard**, ranked by
rate, with the selection bias fixed — it answers *"which of my lyrics do people
feel compelled to pass on?"*, which nothing else in the analytics stack can.
