# WhatsApp Channel — rollout kit

Everything here is **ready to use the moment the channel exists**. Nothing
below is live yet: the code is gated on `SITE.whatsapp.url`, which is `''`.

## Why this and not the website

Measured 2026-07-26 (GA4, 30 days):

| | |
|---|---|
| Site sessions | 170 (66 users) — and 322 of 755 pageviews were `/admin`, i.e. Raj |
| Sessions from YouTube | **~18**, against ~150,000 views |
| Email subscribers | 1 |
| Web-push subscribers | 0 |

Asking a viewer to leave the video, load a site, and fill in a form is a
four-step funnel whose first step converts at ~0.01%. A channel link is **one
tap**, is native for the ~82% of the audience in India, costs nothing, and needs
no consent-law machinery or carrier registration.

## Step 1 — create the channel

WhatsApp → Updates → **+** → New channel. Per the standing decision this is a
one-way **Channel**, never a group and never the personal number: the number
stays hidden, following is opt-in, and it is ban-safe.

- Name: **Tamilagaval | தமிழகவல்**
- Description: `புதிய தமிழ் பாடல்கள் — வெளியாகும்போது இங்கே. | New Tamil songs, as they release.`
- Photo: the channel avatar already used on YouTube.

Copy the invite link (`https://whatsapp.com/channel/…`).

## Step 2 — one config line

In `src/config/site.ts`:

```ts
whatsapp: {
  url: 'https://whatsapp.com/channel/XXXXXXXX',   // ← paste here
  label: 'WhatsApp',
},
```

That single value lights up, with no further code changes:

- the site-wide follow row (already built, hidden while empty)
- `buildDescriptionLead()` — the above-the-fold ask on every newly assembled description
- the WhatsApp line in the standard description footer
- JSON-LD `sameAs`

Then redeploy (the usual branch → PR → master → Amplify gate).

## Step 3 — the description lead (the actual lever)

YouTube shows only the first ~150 characters before "...more". Anything below
that is, in practice, unread — which is why a footer link produced ~18 sessions
a month. The builder now puts this FIRST:

```
📲 புதிய பாடல்கள் WhatsApp-இல் | New songs on WhatsApp: https://whatsapp.com/channel/XXXXXXXX
```

New uploads get it automatically. For the **back catalogue**, paste it as the
first line of each description. Highest-traffic first — that is where the
return is:

| Video | Why first |
|---|---|
| `GXLu3Y7FghU` நீ சிரிச்ச நேரம் | highest-view song |
| `H5NcoS41fA4` செவ்வந்தி பூவே | second |
| `R8Bi7KBRFrQ` அம்மம்மா என் அகமே | newest, still being pushed |
| `iOwHtdXM_vU` அம்மம்மா Short | Shorts out-perform on views |

## Step 4 — pinned comment

A pinned comment sits above every other comment and is one of the few surfaces
a viewer reads without leaving the player. Bilingual, respectful `-உங்கள்`
register:

```
🎵 இந்தப் பாடல் உங்கள் மனதைத் தொட்டால், WhatsApp சேனலில் இணையுங்கள் —
புதிய பாடல்கள் வெளியாகும்போது முதலில் உங்களுக்குத் தெரியும். 👇
https://whatsapp.com/channel/XXXXXXXX

If this song moved you, join the WhatsApp channel — new songs reach you there first.
```

Pinning cannot be done through the API; it is manual in Studio, one video at a
time. Same priority order as above.

## Step 5 — measure it honestly

The number that matters is **channel followers**, not clicks. Check weekly, and
compare against the baseline in `project_tamilagaval_whatsapp`: the WhatsApp
referral coefficient has sat flat at ~12 per 1,000 views for six weeks.

Caveat worth stating up front: WhatsApp channel referrals arrive with **no
referrer**, so they land in GA4 as `(direct)`. The channel's own follower count
in the WhatsApp app is the honest measure — not anything in GA4.

## What is NOT being built

SMS opt-in (scope kept at `~/tamilagaval-sms-optin-scope.md`). It stays shelved
until there is evidence that an ask converts at all — it is the only channel
that adds carrier cost, CASL/TCPA exposure, and a 10DLC registration gate that
can block delivery outright.
