# YouTube-side WhatsApp Share CTA — copy-paste kit + measured experiment

**Set 2026-07-14.** Companion to `docs/WHATSAPP_AUDIT.md`.

The audit established that **84% of the audience is inside YouTube and 0.3% ever
searches for us**, that **tamilagaval.com sends zero referrals to YouTube**, and
that the WhatsApp referral coefficient has been **flat at ~12 per 1,000 for six
weeks** — unmoved by every site-side share feature we shipped in June.

So the share prompt has to live where the audience actually is: **in the video's
description and pinned comment.** That's copy and YouTube Studio, not code.

This is a **measured experiment with a control group**, not a blanket rollout. If
we change all ten songs at once we'll never know whether a coefficient move was
the CTA or just the algorithm.

---

## Why these songs

Per-song share rates, Apr 15 – Jul 11 (YouTube's native Share button; every song
above a 100-view floor was measured, so a modest-but-forwarded song can surface):

The headline finding: **reach and share-worthiness are not the same thing.**

- The five *biggest* songs share at **23–33 per 1,000**.
- Several *mid-tier* songs share at **45–60 per 1,000**.
- **செவ்விழி ஓவியமே is the most-forwarded song on the channel — 60.4/1k — on only 3,724 views.** It ranks ~15th by views, so the old (selection-biased) leaderboard could never have shown it. People *want* to pass this song on; it just hasn't been given reach.

### Treatment group — apply the CTA (5 songs)

| Song | videoId | Views | Shares | **/1k** | Why |
|---|---|---|---|---|---|
| நீ சிரிச்ச நேரம் தான் | `GXLu3Y7FghU` | 39,429 | 1,133 | 28.7 | biggest volume — most incremental shares available |
| என் மன்னவனே | `eo3Mo--sgPY` | 25,746 | 636 | 24.7 | volume |
| உன்னை பார்த்தால் போதாதே | `lWt5kvapFKs` | 15,341 | 504 | 32.9 | volume + good rate |
| **செவ்விழி ஓவியமே** | `h1WgaJW9khI` | 3,724 | 225 | **60.4** | **highest rate on the channel** |
| பொன்வானம் சாயுதே | `d3puwsvsZdI` | 4,262 | 203 | 47.6 | 2nd-highest rate with real volume |

### Control group — **DO NOT TOUCH** (5 songs)

Leave these exactly as they are for 14 days. They span a comparable rate range
(23–33/1k) and volume, so they tell us what would have happened anyway.

| Song | videoId | Views | Shares | /1k |
|---|---|---|---|---|
| செவ்வந்தி பூவே | `H5NcoS41fA4` | 21,736 | 509 | 23.4 |
| என் பொன்மணி என் கண்மணி | `KtFF0CCnCY4` | 11,955 | 389 | 32.5 |
| எழுதாத வரியிலே | `VUIpOkk62fc` | 6,950 | 165 | 23.7 |
| ஈழத்து மண்ணே | `tw49AjsZs1E` | — | — | — |
| மெல்ல மெல்ல | `ldgMDPRnHp0` | — | — | — |

---

## The copy

Two placements per treatment song. **Add** — never replace existing description
content, and never touch the title or anything about the song itself.

### 1. Description — insert as the FIRST line

Only ~100 characters show above "Show more", so this line has to earn its place
at the top. Bilingual, per the channel convention.

> 💚 பிடித்தால் ஒரு நண்பருக்கு WhatsApp-இல் பகிருங்கள் | Loved it? Share it on WhatsApp: https://youtu.be/VIDEOID

Per song, ready to paste:

```
நீ சிரிச்ச நேரம் தான்
💚 பிடித்தால் ஒரு நண்பருக்கு WhatsApp-இல் பகிருங்கள் | Loved it? Share it on WhatsApp: https://youtu.be/GXLu3Y7FghU

என் மன்னவனே
💚 பிடித்தால் ஒரு நண்பருக்கு WhatsApp-இல் பகிருங்கள் | Loved it? Share it on WhatsApp: https://youtu.be/eo3Mo--sgPY

உன்னை பார்த்தால் போதாதே
💚 பிடித்தால் ஒரு நண்பருக்கு WhatsApp-இல் பகிருங்கள் | Loved it? Share it on WhatsApp: https://youtu.be/lWt5kvapFKs

செவ்விழி ஓவியமே
💚 பிடித்தால் ஒரு நண்பருக்கு WhatsApp-இல் பகிருங்கள் | Loved it? Share it on WhatsApp: https://youtu.be/h1WgaJW9khI

பொன்வானம் சாயுதே
💚 பிடித்தால் ஒரு நண்பருக்கு WhatsApp-இல் பகிருங்கள் | Loved it? Share it on WhatsApp: https://youtu.be/d3puwsvsZdI
```

> The existing first line on the big songs is the "▶️ புதிதாக வந்தீர்களா? இங்கே
> தொடங்குங்கள் / New here? Start Here" link. Push it to line 2 — a *share* ask
> beats a *browse* ask at the top, because sharing is the thing we can't get any
> other way.

### 2. Pinned comment

Pinning has no API (and our Analytics token is read-only anyway), so this is
manual in Studio → Comments → post → ⋮ → Pin.

```
இந்தப் பாடல் உங்கள் மனதைத் தொட்டால், ஒரு நண்பருக்கு WhatsApp-இல் பகிருங்கள் 💚

உங்கள் ஒரு பகிர்வு — இன்னொரு தமிழ் உள்ளத்திற்கு இந்தப் பாடலைக் கொண்டு சேர்க்கும்.

🎧 https://youtu.be/VIDEOID
```

Swap `VIDEOID` per song. Keep the register respectful (பகிருங்கள், not பகிரு).

### What we deliberately do NOT do

- **Don't route the forward to tamilagaval.com.** Adding a hop to a site with no
  traffic only loses people. Forward the YouTube link: it feeds watch-hours, it
  feeds subscribers (the one remaining Tier-2 gate — 918/1,000), and YouTube's
  own `EXT_URL` reporting measures it for us. We don't need a UTM here.
- **Don't touch the songs.** No retitling, no re-cutting, no lyric changes.
- **Don't add this to the control group.** That's the whole point.

---

## How we'll know if it worked

**Baseline is already captured** (the tables above, and the flat 12/1k channel
coefficient).

After **14 days**, compare over the same window:

1. **Per-song share rate, treatment vs control.** This is the sharp read. If the
   five treated songs' shares/1k rises and the five controls' doesn't, the CTA
   did it. `/admin/youtube` → Song shares → rank by *Share rate (/1k)*.
2. **Channel coefficient** (`/admin/youtube` → WhatsApp referral coefficient).
   Expect this to move *less* — the treated songs are only a slice of total
   views, so a big per-song effect dilutes into a small channel effect.

### Honest expectation

Pinned comments are read by a small minority of viewers; the above-the-fold
description line does better. **A realistic result is +10–30% on the treated
songs' share rate** — which would nudge the channel coefficient from ~12/1k to
maybe 13–14/1k. That is a real, compounding gain, and it is **not** a step change.

Nothing here turns a 12/1k echo into a self-sustaining loop (that needs
>1,000/1,000). What it does is tell us — for the first time, with a control —
whether asking works *at all*. If it does, we scale it to the catalogue and to
every new upload. If it doesn't, we've spent an afternoon of copy-paste and
learned something true, and the answer lies in reach (search discoverability),
not in asking.

---

## If it works → standing rule

Add the share ask to the per-upload checklist
(`reference_tamilagaval_new_song_checklist`): every new song ships with the
share CTA as description line 1 + a pinned comment, from publish day.
