# BigQuery + GA4 native export — setup

One-time wire-up so the `Site engagement by day of week` card on
`/admin/youtube` renders (and future BigQuery-backed cards work).

## Current state — 2026-08-31

| Piece | Status |
|---|---|
| BigQuery client + admin card (code) | ✅ shipped (PR #249) |
| `BIGQUERY_PROJECT_ID=tamilagaval-prod-2026` set on Amplify | ✅ done 2026-08-29 |
| BigQuery API enabled on `tamilagaval-prod-2026` | ✅ done 2026-08-29 |
| GA4 SA has `roles/bigquery.jobUser` on the project | ✅ done 2026-08-29 |
| GA4 → BigQuery Link enabled | ✅ done 2026-08-29 |
| Dataset `analytics_539459362` created | ✅ landed by 2026-08-30 |
| GA4 SA has dataset-level READER access | ✅ done 2026-08-31 (via classic ACL — see Step 3) |
| `pseudonymous_users_YYYYMMDD` tables landing | ✅ 2026-08-28 + 29 present |
| **`events_YYYYMMDD` tables landing** | ⏳ **not yet — investigate step 2b** |
| Amplify redeploy (env var takes effect) | ✅ done — builds 640/641/642 on 2026-08-29/30 |

Everything below is copy-pasteable — values already resolved from the
GA4 service account key in SSM and the GA4 property id in Amplify env.

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

### 2a. Create the Link

1. GA4 → Admin → Product Links → **BigQuery Links** → *Link*.
2. Pick project **`tamilagaval-prod-2026`**.
3. Data location: **US** multi-region (matches `location: 'US'` in
   `bigquery-api.ts`; if you pick differently, update that constant).
4. Data streams: your web stream (the one for `tamilagaval.com`).
5. Frequency: **Daily** (free tier). Streaming optional ($0.05/GB up).
6. Include advertising identifiers: off — no need for this channel.
7. Save.

### 2b. Verify BOTH exports are ticked

Once linked, click into the link and confirm — this bit us on the
2026-08-29 setup: only **User data → Daily** was checked initially,
so `pseudonymous_users_*` tables started landing but `events_*` did
not. The two exports are independent toggles on the same Link page.

- **Event data** → *Export type: Daily* — REQUIRED for the day-of-week
  card (and every other event-driven query).
- **User data** → *Export type: Daily* — optional; useful for user-
  attribute cohorts.

If Event data was off, ticking it now starts the next overnight run
(look for `events_YYYYMMDD` within ~24 h).

### 2c. Wait for the first daily table

The first `events_YYYYMMDD` table lands as an overnight batch job
(usually 24-48 h after the Link is enabled AND Event export is on).
Confirm with:

```bash
bq ls -n 20 tamilagaval-prod-2026:analytics_539459362
```

Look for names starting with \`events_\` — not just \`pseudonymous_users_\`.

## Step 3 — CLI (after the dataset exists)

The dataset lands within seconds of the Link being created (well
before the first table). \`gcloud beta bq / bq add-iam-policy-binding\`
is the "modern" way BUT it's behind an allowlist on many GCP projects
(2026-08-31: errored on tamilagaval-prod-2026 with "This feature
requires allowlisting"). Use the classic-ACL path instead — same
effect, no allowlist required:

```bash
PROJECT=tamilagaval-prod-2026
GA4_SA=tamilagaval-ga4-reader@tamilagaval-prod-2026.iam.gserviceaccount.com
DATASET=analytics_539459362

# Fetch current ACL, append the SA as READER, put back.
# jq preserves everything else in the dataset config — only appends to `access`.
bq show --format=prettyjson "$PROJECT:$DATASET" > /tmp/ds.json
jq --arg sa "$GA4_SA" '.access += [{"role": "READER", "userByEmail": $sa}]' /tmp/ds.json > /tmp/ds-new.json
bq update --source /tmp/ds-new.json "$PROJECT:$DATASET"
```

Fallback if even the classic path errors — the BigQuery Console UI:
1. https://console.cloud.google.com/bigquery?project=tamilagaval-prod-2026
2. Expand \`tamilagaval-prod-2026\` → \`analytics_539459362\` → three-dot menu → **Share**
3. Add principal → the GA4 SA email → Role: **BigQuery Data Viewer** → Save

## Step 4 — Amplify redeploy

`BIGQUERY_PROJECT_ID` is already set on the Amplify master branch
(2026-08-29). Env changes take effect on the next build — either merge
any other PR (uses the new env automatically) or trigger a redeploy in
the Amplify console. The card appears on `/admin/youtube` once the
next deploy is live AND step 3 is done.

## Step 5 — Verify

Visit `/admin/youtube`. The "Site engagement by day of week" section:
- **Absent** if the env var isn't picked up yet → redeploy Amplify
- **Present with a "permission denied" error** if step 3 is missing → run step 3
- **Present with a "Not found: Table events_*" error** → Event export
  isn't landing. Check step 2b (Event data toggle) or wait ~24 h.
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
