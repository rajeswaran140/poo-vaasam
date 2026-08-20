# Song Lifecycle Model — v1 Scope

**Status:** scoped, not built. Backfill spike completed 2026-08-20 against 101 uploads.
**Owner:** Raj Thangarajah
**Question the model exists to answer:**

> **At its current age, is this song behaving unusually compared with previous TamilAgaval songs at the same age?**

Not another collection of totals. Every output must be age-relative.

---

## 0. What the backfill spike established

Ran against all 101 uploads, publish date → 2026-08-17 (last finalized day). 100 videos returned daily
rows; the 101st (`Lz5HR_nc4ZM`) premiered 2026-08-19 and is correctly outside the finalized window.
4,332 video-days retrieved in **5 API calls**.

### ✅ Confirmed feasible
- `dimensions=video,day` **works when an explicit `filters=video==id1,id2,…` list is supplied** (it fails
  with no filter). 25 ids per call → the entire catalogue backfills in 5 calls. No snapshot
  infrastructure, no new collection pipeline.
- All of: `views`, `likes`, `shares`, `subscribersGained`, `estimatedMinutesWatched`,
  `averageViewPercentage`, `averageViewDuration` are available per video per day.

### ❌ Confirmed impossible
- `impressions` and `impressionsClickThroughRate` → *"Unknown identifier"*. Studio Reach tab only.
  **views/1K impressions and CTR are out of v1 and are not to be approximated.** The Reporting API
  is not enabled on GCP project `75895058293` and we are deliberately not enabling it for these two
  variables (decision: Raj, 2026-08-20).
- `dimensions=video,insightTrafficSourceType` → *"query is not supported"*. Traffic mix must be one
  call per video (101 calls, one-time, acceptable).

### ⚠️ Two findings that CHANGE the design

**1. "Launch velocity is a poor predictor" is too strong — correct it.**
Measured on long-form songs aged ≥28d:

| relationship | Pearson | Spearman | n |
|---|---|---|---|
| D0–D3 → D28 | 0.797 | **0.726** | 52 |
| D0–D3 → D60 | 0.727 | **0.423** | 23 |
| D0–D7 → D60 | 0.897 | 0.611 | 23 |
| D0–D14 → D60 | 0.987 | **0.805** | 23 |

Launch velocity **is** informative — rank correlation 0.73 to D28. What is true is narrower and still
sufficient: **the variance around it is large enough that no individual song can be judged by it**, the
rank order keeps reshuffling out to D60 (ρ falls to 0.42), and the channel's single biggest song is
precisely where it failed. By **D14 the picture is firm** (ρ=0.805) — which independently validates
the D14 → D28 checkpoint structure rather than assuming it.

**Do not claim launch velocity is uninformative. Claim it is not decisive for any one song.**

**2. Cumulative-curve similarity does not discriminate — point 7 needs a different metric.**
L1 distance over normalized cumulative curves scores nearest neighbours at 96% and the *worst*
match at 74%. Everything looks similar. A "82% shape similarity" badge built on this would be
decorative, exactly as feared. **Shape similarity is deferred until a discriminating metric is
validated** (candidates: feature-vector distance over §3 features, or DTW on normalized daily rates).

---

## 1. Scope of v1

**In:** backfill all 101 videos; canonical age coordinates; verified metrics only; interpretable
lifecycle features; archetype **and** performance class as separate outputs; CPR.

**Out of v1:** impressions/CTR (impossible), nearest-analogue similarity (metric unvalidated),
predictive scoring, any write path to YouTube, LLM in the render path.

---

## 2. Age coordinates

`D0` = publish date (channel-local). `Dn` = n days after. Milestone summaries at
**D1, D3, D7, D14, D28, D60** and D90 once the catalogue is old enough.

- Every metric is **computed retrospectively from the daily series**, never captured at the time.
- A milestone is `null` when `observable_age < n` — never zero, never imputed. A song inside the
  ~3-day analytics lag has **no** rows; that is an empty cell, not a result.
- `observable_age = last_finalized_day − publish_date`.

---

## 3. Lifecycle features (size-blind)

Computed on a 3-day-smoothed daily view series:

| feature | definition |
|---|---|
| `early_velocity` | views D0–D2 |
| `peak_day` | argmax of smoothed daily views |
| `peak_magnitude` | peak daily views ÷ median daily views over observable life |
| `time_to_peak` | `peak_day` (kept distinct from magnitude — they classify differently) |
| `post_peak_decay` | slope of log daily views, `peak_day` → `peak_day+14` |
| `wave_count` | local maxima after `peak_day+3` with ≥25% prominence over the preceding trough **and** ≥15% of peak |
| `wave_strength` | strongest secondary wave ÷ peak |
| `late_view_share` | **CPR**, see §4 |
| `residual_velocity` | mean daily views over last 7 finalized days ÷ peak |

Engagement, per 1,000 views, computed over the same window: `likes1k`, `shares1k`, `subs1k`,
plus view-weighted `averageViewPercentage` and traffic-source composition.

---

## 4. Catalogue Persistence Ratio (CPR)

```
CPR      = views after D7 / lifetime views
CPR31_90 = views D31–D90 / lifetime views      (requires observable_age ≥ 60)
```

**CPR validates as a discriminator without being told what a Short is:**

| cohort | median CPR | n |
|---|---|---|
| long-form | **0.602** | 60 |
| Shorts | **0.201** | 31 |

A 3× separation on a format distinction the metric never saw — the method rediscovers a known
property of the catalogue, which is the evidence that it measures something real.
`CPR31_90` median (age ≥60) = **0.280**. Median share of D28 views arriving after D7 = **53.6%**.

CPR is a **first-class property**, promoted on the strength of the channel-level result that 79.7% of
finalized weekly reach comes from videos older than seven days.

### 🔴 Terminology rule
**Do not use "evergreen."** The oldest observation is ~87 days (catalogue starts 2026-05-22).
Permitted terms: **persistent**, **late-distributing**, **catalogue-active**. Revisit at 6–12 months
of observation to determine whether genuine evergreen behaviour exists.

---

## 5. Two separate outputs — never collapse them

### Lifecycle archetype (shape, size-blind)
Observed distribution over 63 long-form songs:

| archetype | n | rule |
|---|---|---|
| Multi-wave | 23 | `wave_count ≥ 2` |
| Early burst-decay | 20 | `peak_day ≤ 2` and `CPR < 0.55` |
| Standard decay | 9 | default |
| **Delayed breakout** | **7** | `peak_day ≥ 10` and `peak ≥ 2× early_velocity/3` |
| Slow burn | 4 | `peak_day ≥ 7` |

No degenerate bucket; all five populate. **Persistence is deliberately NOT an archetype** — a
`CPR ≥ 0.80` class was tried and matched zero songs, because persistence is already a continuous
first-class property (§4). An archetype that restates a metric adds nothing.

**Delayed breakout is a real, recurring class on this channel, not one anecdote** — and its extremes
are more extreme than நீ சிரிச்ச நேரம்:

| song | D0–D3 | peak day | lifetime | CPR |
|---|---|---|---|---|
| முத்தமிழின் மூன்றெழுத்தில் | 94 | **D44** | 4,670 | 0.98 |
| அரிதான பெரும் பாசம் | 148 | **D32** | 4,962 | 0.95 |
| பொன்வானம் சாயுதே | 64 | **D30** | 5,438 | 0.94 |
| நீ சிரிச்ச நேரம் | 1,790 | D23 | 53,823 | 0.90 |

**11% of long-form songs peak 10+ days after publish.**

### Performance class (size, age-matched)
Percentile of cumulative views at this song's age vs **all other songs' cumulative at the same age**.
Classes: `Breakout / Strong / Normal / Slow-burn / Weak / Developing`.

**Classify, do not declare success or failure.** Report as `Archetype / Class`, e.g.
`Delayed breakout / Strong`, `Early burst-decay / Normal`, `Multi-wave / Breakout`.

> ⚠️ **Known limitation:** the age-matched peer pool shrinks as age rises — beyond ~D75 there are
> fewer than 5 peers and the percentile must return `null`, not a number. This resolves on its own as
> the catalogue ages. Suppress the class rather than reporting a percentile from 3 peers.

---

## 6. `song_id` is a release gate

Title matching is a spike affordance only and **must not ship as the join**. The backfill already hit
the failure: two distinct video IDs both titled `ஈழத்து மண்ணே காலத்து பொன்னே`, same age, 8,483 and
6,269 views — one song, two videos, silently double-counted in any title-keyed aggregate.

Video identity, song identity, alternate versions, Shorts cut-downs, remasters and future
distributor releases all diverge. A durable `song_id ↔ youtube_video_id` (1:N) relationship is
required **before this becomes a broad production feature**. See `project_tamilagaval_song_identity`.

v1 may compute per-**video** lifecycles without it. It may not aggregate per-**song**.

---

## 7. Build order

1. ✅ **Backfill + feature computation** — `src/lib/youtube-lifecycle.ts`, pure functions,
   26 tests in `__tests__/lib/youtube-lifecycle.test.ts` against a real six-song fixture
   (`__tests__/fixtures/lifecycle-songs.json`).
2. ✅ **Archetype + performance classification, validated against known songs** — நீ சிரிச்ச நேரம்
   comes out `Delayed breakout`; முத்தமிழின் comes out `Delayed breakout` peaking after D40 from
   94 launch views; ஒத்த பனங்கீத்தே `Early burst-decay`; செவ்வந்தி பூவே `Multi-wave`;
   என் மன்னவனே `Slow burn`; the Short scores below every long-form song on CPR.
3. **Discover** whether archetypes carry any relationship to theme, length, or release slot.
4. **Solve `song_id`.**
5. **Productionize** into `/admin/youtube` as a lifecycle view — extending the existing cockpit, not a
   new dashboard.

Domain model and pure functions first, tests before implementation, **no LLM in the render path**
(narrative verdicts are template-composed from computed features).

---

## 8. Guardrails

- Nothing before **72h** is a performance signal — technical problems only (claim/block, wrong
  thumbnail or title, severe rejection).
- **D3–D7:** early retention, likes/1k, shares/1k, initial traffic-source composition.
- **D8–D14:** whether Suggested / Playlist / Browse are developing.
- **D28:** first meaningful classification. **D60–D90:** catalogue trajectory.
- Never render a verdict from a window containing unfinalized days. Find where the daily series
  actually ends first.
- Operating principle: *create carefully → publish consistently → ignore launch noise → measure
  lifecycle → learn from catalogue winners → don't interfere prematurely.*
