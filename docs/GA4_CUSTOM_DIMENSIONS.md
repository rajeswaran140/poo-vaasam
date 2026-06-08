# GA4 Custom Dimensions — Registration Runbook

Register the 3 event-scoped custom dimensions the site already sends
(`src/lib/analytics-events.ts`) so the admin dashboards can break events down by
them. **Until these are registered, the events still fire and the totals are
correct — only the per-value breakdowns are missing.**

| Parameter | Display name | Used by | Why |
|---|---|---|---|
| `source` | CTA Source | `subscribe_click`, `youtube_open` | which CTA converts (home_hero / footer / …) |
| `song_id` | Song ID | `audio_play` | survives song renames; dashboard prefers it over title |
| `destination` | YouTube Destination | `youtube_open` | what was opened (channel / video:&lt;id&gt; / grid) |

- **GA4 property:** `539459362` (tamilagaval)
- **Service account:** `tamilagaval-ga4-reader@tamilagaval-prod-2026.iam.gserviceaccount.com`

---

## Option A — GA4 UI (no credentials, ~2 min)

Do this **3 times**, once per row in the table above:

1. Go to **GA4 → Admin** (gear, bottom-left).
2. Under the **Property** column → **Custom definitions**.
3. Click **Create custom dimension** (top-right).
4. Fill in:
   - **Dimension name:** the *Display name* (e.g. `CTA Source`)
   - **Scope:** **Event**
   - **Event parameter:** the *Parameter* exactly (e.g. `source`)
5. **Save.**
6. Repeat for `song_id` (Song ID) and `destination` (YouTube Destination).
7. Done. Data populates going forward (not retroactively); allow ~24–48h for reports.

## Option B — Automated script (Claude runs it)

Needs the service account to have the **Editor** role on the property (the
read-only `ga4-reader` SA returns **403** on create).

1. **Grant the SA Editor:** GA4 → **Admin → Property Access Management** → find
   `tamilagaval-ga4-reader@tamilagaval-prod-2026.iam.gserviceaccount.com` →
   change role to **Editor** → **Save**. (If it's not listed, add it by email
   with the Editor role.)
2. Tell Claude — it runs `node scripts/register-ga4-dimensions.mjs` (reads the
   app's `GA4_SERVICE_ACCOUNT_KEY` + `GA4_PROPERTY_ID`), which creates all 3
   idempotently and prints `+ <param>: CREATED`.
3. (Optional, recommended) revert the SA back to **Viewer** afterward — runtime
   reporting only needs read access.

## Verify

GA4 → Admin → Custom definitions → all three appear with **Scope: Event**.
The breakdown banners on `/admin/youtube` and `/admin/songs` clear once data flows.
