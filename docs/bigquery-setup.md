# BigQuery + GA4 native export — setup

One-time wire-up so the `Site engagement by day of week` card on
`/admin/youtube` renders (and future BigQuery-backed cards work).

## Current state — 2026-08-29

| Piece | Status |
|---|---|
| BigQuery client + admin card (code) | ✅ shipped (PR #249) |
| `BIGQUERY_PROJECT_ID=tamilagaval-prod-2026` set on Amplify | ✅ done 2026-08-29 |
| BigQuery API enabled on `tamilagaval-prod-2026` | ⏳ needs `gcloud services enable` |
| GA4 SA has `roles/bigquery.jobUser` on the project | ⏳ needs `gcloud add-iam-policy-binding` |
| **GA4 → BigQuery Link enabled** | ⏳ **GA4 console only — cannot be scripted** |
| First `events_YYYYMMDD` table populated | ⏳ waits 24-48 h after Link is enabled |
| GA4 SA has `roles/bigquery.dataViewer` on the dataset | ⏳ do after dataset exists |
| Amplify redeploy (env var takes effect) | ⏳ next merge or a manual redeploy |

Everything below is copy-pasteable — values already resolved from the
GA4 service account key in SSM and the GA4 property id in Amplify env.

## Step 1 — CLI (works today; safe + idempotent)

Run in a shell where `gcloud` is authenticated as a user with Owner /
Project IAM Admin on `tamilagaval-prod-2026`:

```bash
PROJECT=tamilagaval-prod-2026
GA4_SA=tamilagaval-ga4-reader@tamilagaval-prod-2026.iam.gserviceaccount.com

# a. Enable BigQuery API on the project
gcloud services enable bigquery.googleapis.com --project="$PROJECT"

# b. Grant the existing GA4 SA permission to RUN BigQuery jobs
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$GA4_SA" \
  --role="roles/bigquery.jobUser"
```

## Step 2 — GA4 console (only place this can be done)

1. GA4 → Admin → Product Links → **BigQuery Links** → *Link*.
2. Pick project **`tamilagaval-prod-2026`**.
3. Data location: **US** multi-region (matches `location: 'US'` in
   `bigquery-api.ts`; if you pick differently, update that constant).
4. Data streams: your web stream (the one for `tamilagaval.com`).
5. Frequency: **Daily** (free tier). Streaming optional ($0.05/GB up).
6. Include advertising identifiers: off — no need for this channel.
7. Save.

**Wait 24-48 h** — the first `events_YYYYMMDD` table lands as an
overnight batch job. Confirm with:

```bash
bq ls -n 1 tamilagaval-prod-2026:analytics_539459362
```

## Step 3 — CLI (after the dataset exists)

```bash
PROJECT=tamilagaval-prod-2026
GA4_SA=tamilagaval-ga4-reader@tamilagaval-prod-2026.iam.gserviceaccount.com
DATASET=analytics_539459362

# Dataset-level: read the exported tables
bq add-iam-policy-binding \
  --member="serviceAccount:$GA4_SA" \
  --role="roles/bigquery.dataViewer" \
  "$PROJECT:$DATASET"
```

## Step 4 — Amplify redeploy

`BIGQUERY_PROJECT_ID` is already set on the Amplify master branch
(2026-08-29). Env changes take effect on the next build — either merge
any other PR (uses the new env automatically) or trigger a redeploy in
the Amplify console. The card appears on `/admin/youtube` once the
next deploy is live AND step 3 is done.

## Step 5 — Verify

Visit `/admin/youtube`. The "Site engagement by day of week" section:
- **Absent** if the env var isn't picked up yet → redeploy Amplify
- **Present, empty** if the dataset hasn't landed yet → wait longer
- **Present with an error** if IAM's missing → run step 1 or 3
- **Present with 7 rows** → done. Explore other queries via
  `src/lib/bigquery-api.ts` (add sibling `fetch*` functions).

## Alternative: separate BigQuery service account

If you'd rather isolate BQ access from GA4 access (least-privilege):
create a fresh SA in `tamilagaval-prod-2026`, download its JSON key,
base64-encode it, and set `BIGQUERY_SERVICE_ACCOUNT_KEY` in SSM at
`/amplify/d3rkmepk4popv0/master/BIGQUERY_SERVICE_ACCOUNT_KEY`. The
client prefers it over `GA4_SERVICE_ACCOUNT_KEY` when both are present.

## Cost sanity check

At current volume (~4-5k views/day):
- Storage: ~0.001 GB/day of GA4 events → free forever
- Queries: the day-of-week query scans ~30 tables × 4 KB → free forever
- Streaming (if enabled later): 0 MB currently → free

Set a **Budget Alert** on `tamilagaval-prod-2026` at $5/month anyway —
if any future query goes rogue and scans terabytes, you get an email
before the bill lands.
