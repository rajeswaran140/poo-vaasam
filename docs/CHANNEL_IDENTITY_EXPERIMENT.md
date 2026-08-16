# Channel Identity & Returning-Viewer Experiment — Tamilagaval

**Set:** 2026-07-21. **Status:** design ready, awaiting start date.

## Why this experiment exists

The 14-day end-screen-routing checkpoint (2026-07-21) returned **null**: routed sources'
forward subs/1k fell (pooled 3.70 → 3.31) and channel-wide full-song subs/1k stayed
**below the 4.07 frozen baseline** (3.48–3.68), nowhere near the 5.5–6.0 "improvement" zone.
Adding subscribe *surfaces* is exhausted as a lever.

A diagnostic pull (30d, 2026-06-21 → 2026-07-21) showed **why**:

| Signal | Value | Reading |
|---|---|---|
| Views from **SUBSCRIBED** viewers | **5.2%** (11,235 / 214,824) | 94.8% are one-time strangers the algorithm rented |
| Retention: subscribed vs unsubscribed | **60.5%** vs 40.8% | loyal core is ~1.5× more engaged — not a content problem |
| **NOTIFICATION** traffic | **0.1%** (156 views) | the bell is dormant; subscribers aren't being pulled back |
| **END_SCREEN** traffic | 0.1% (159 views) | why the routing checkpoint read null — the surface is negligible |
| RELATED_VIDEO / PLAYLIST | 51.1% / 23.7% | reach is rented; playlist is the best *owned* on-platform surface |

**The bottleneck is loyalty formation, not subscribe conversion.** The job is to turn the
94.8% into people who *come back*, and to reactivate the subscribers who already exist.

## Hypothesis

A recognizable, habit-forming channel identity — predictable cadence + consistent series
packaging + active subscriber push — raises the **subscribed-view share** and
**subscriber-sourced traffic**, which compounds into higher channel-wide subs/1k, because
loyal viewers subscribe and return at far higher rates than rented reach.

## Design

Identity is a *channel* property, not a per-video toggle — it can't be A/B split cleanly.
So this is a **defined-period pre/post** with a frozen treatment window (same discipline as
the end-screen freeze), read against API proxies below.

- **Treatment window:** 3–4 weeks, frozen (no other big changes) for a clean read.
- **North star:** *% views from SUBSCRIBED* — if the levers work, this climbs **before**
  subs/1k does (loyalty leads conversion). Watch it as the early signal.

## The four levers

1. **Named, dated release cadence.** Make uploads an appointment: same slot weekly
   (Fri eve Toronto — see `upload-timing` memory). Announce the *next* song's date in each
   description + a Community post. Predictability builds the return habit.
2. **Series packaging identity.** One consistent thumbnail grammar — face + Tamil hook word,
   same font/frame — so a stranger in the suggested feed *recognizes* the channel across
   videos. The packaging study flagged the gap as a *human-emotion face*.
3. **Reactivate the bell (biggest quick win).** Notification at 0.1% = dead membership signal.
   Post to the free Community tab 2–3×/week to pull dormant subscribers back and teach them
   subscribing *does* something. First-week drafts below.
4. **Playlist / next-in-series end CTA** instead of a generic subscribe button. Playlist is
   already 23.7% of traffic and the best owned on-platform surface after WhatsApp — route
   session continuation there.

## Readout metrics (all API-available — no Studio dependency)

| Metric | Baseline (2026-07-21) | Target direction |
|---|---|---|
| **% views from SUBSCRIBED** (north star) | **5.2%** | rising → 8–10% |
| SUBSCRIBER + NOTIFICATION traffic share | 12.7% | rising |
| Subscribed-cohort avgViewPct | 60.5% | hold ≥58% at scale |
| Channel-wide full-song subs/1k | 3.7 | rising toward 5+ |

**Confirm-only in Studio** (API doesn't expose these): returning-viewers, unique-viewer
return-rate.

### How the readout is computed

- **Subscribed-view share:** Analytics `dimensions=subscribedStatus`, `metrics=views,averageViewPercentage`.
- **Traffic share:** `dimensions=insightTrafficSourceType`, `metrics=views`.
- **subs/1k:** `(subscribersGained - subscribersLost) / views * 1000`, full songs only
  (exclude Shorts ≤80s via `videos.list contentDetails.duration`).

Compare the treatment window against this 2026-06-21 → 2026-07-21 baseline.

---

## First-week Community posts — Lever 3 (reactivate the bell)

Post manually in **YouTube Studio → Content → Posts → Create** (no API). Bilingual, respectful
register (உங்கள் / பாருங்கள்), apolitical, warm. Rotate with the four types in
`YOUTUBE_COMMUNITY_POSTS.md`.

### Post A — "back on schedule" habit-setter (post at experiment start)

```
🎵 இனி ஒவ்வொரு வெள்ளிக்கிழமையும் ஒரு புதிய பாடல் 💛

இந்த channel-ஐ subscribe செய்து, 🔔 மணியை அழுத்திவையுங்கள் —
புதிய பாடல் வெளியாகும் நேரத்தில் உங்களுக்கு முதலில் தெரியும்.

A new original Tamil song every Friday. Subscribe and tap the 🔔
so you're the first to hear each one.

எந்த வகைப் பாடல்களை நீங்கள் விரும்புகிறீர்கள்? கீழே சொல்லுங்கள் 👇
```

### Post B — poll, pulls dormant subs into the feed (2–3 days later)

```
உங்கள் மனதுக்கு நெருக்கமான பாடல் எது? 💭
Which kind of song touches you most?

  • காதல் பாடல்கள் / Love
  • உணர்வுப் பாடல்கள் / Emotional
  • இயற்கை & கிராமம் / Nature & village
  • பக்தி & அமைதி / Devotional & calm

வாக்களியுங்கள் — அடுத்த பாடலைத் தேர்ந்தெடுக்க இது உதவும் 🙏
Vote — it helps choose the next song.
```
*(Use YouTube's native poll post type.)*

### Post C — a lyric line, no link, pure warmth (mid-week)

```
"[ஒரு வரி — உங்கள் பாடல் ஒன்றிலிருந்து]"

இந்த வரி உங்கள் மனதில் என்ன உணர்வைத் தூண்டுகிறது?
What does this line stir in you?

— Tamilagaval 💛
```
*(Pick a line from a published song. Per house rule: never alter poem/song bodies — quote
exactly. Keep it link-free so it reads as connection, not promotion.)*

### Post D — next-song teaser with a date (end of week, sets the appointment)

```
🎶 இந்த வெள்ளிக்கிழமை ஒரு புதிய பாடல் வருகிறது…
A new song drops this Friday.

🔔 மணியை அழுத்திவைத்தால், வெளியான உடனே உங்களுக்குத் தெரியும்.
Tap the 🔔 and you'll know the moment it's live.

#Tamilagaval #TamilSongs
```

---

## Notes

- Respect all standing rules: apolitical, "subscribers/listeners" never "customers",
  respectful visitor register, never display/alter lyrics as bodies, WhatsApp stays primary.
- Community posts have **no API** — manual in Studio. Return metrics pull is scriptable
  (Analytics OAuth via Amplify `d3rkmepk4popv0` env, minted in-memory).
- A one-shot readout cron can be scheduled once a start date is chosen.
