# BigQuery + GA4 native export — setup

One-time GCP + AWS wire-up so the `Site engagement by day of week` card on
`/admin/youtube` renders (and so future BigQuery-backed cards work).

## What this gets you

- GA4's raw event stream lands as daily tables in a BigQuery dataset you
  own: `analytics_<GA4_PROPERTY_ID>.events_YYYYMMDD`.
- Free tier (as of 2026-08): 1 M events/day streaming, 10 GB storage,
  1 TB queries/month. Tamilagaval's volume (~4-5 k views/day) fits under
  the free tier with plenty of headroom.
- Any SQL question the GA4 Data API can't express is now answerable —
  cross-source joins, custom cohorts, retention-by-lyric-page, etc.

## Steps

### 1. GCP project

Use the same project you already have for GA4 / Google TTS. If unsure:

```
gcloud projects list
```

You'll set the project id as `BIGQUERY_PROJECT_ID` later.

Enable the BigQuery API on it:

```
gcloud services enable bigquery.googleapis.com --project=<project-id>
```

### 2. Enable the GA4 → BigQuery Link (GA4 console only — cannot be scripted)

1. Open GA4 → Admin → Product Links → **BigQuery Links** → *Link*.
2. Select the GCP project from step 1.
3. Data location: **US** multi-region (the query in `bigquery-api.ts` uses
   `location: 'US'`; if you pick a different region, update that constant too).
4. Data streams: your web stream.
5. Frequency: **Daily** (free tier). Streaming is optional; costs $0.05/GB
   uploaded and adds an `events_intraday_*` table for today's partial data.
6. Include advertising identifiers: your call — Raj's channel is not
   marketing-heavy, so this is safe to leave off.
7. Save.

**Wait 24-48 h** for the first daily table to land. Confirm with:

```
bq ls -n 1 <project-id>:analytics_<GA4_PROPERTY_ID>
```

### 3. Service account IAM

Reuse the existing GA4 service account (least new-surface) — grant it two
extra roles on the BigQuery project + dataset:

```
GA4_SA=<the client_email from GA4_SERVICE_ACCOUNT_KEY>
PROJECT=<project-id>
DATASET=analytics_<GA4_PROPERTY_ID>

# Project-level: run BigQuery jobs
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$GA4_SA" \
  --role="roles/bigquery.jobUser"

# Dataset-level: read the tables. Do this in the BigQuery console: click the
# dataset → Share → Add principal → paste $GA4_SA → assign "BigQuery Data Viewer".
# CLI equivalent (requires bq access to the dataset first):
bq add-iam-policy-binding \
  --member="serviceAccount:$GA4_SA" \
  --role="roles/bigquery.dataViewer" \
  "$PROJECT:$DATASET"
```

If you'd prefer a **separate** service account for BigQuery (cleaner IAM,
larger blast radius reduction on key rotation): create a fresh SA, download
its JSON key, base64-encode it, and set `BIGQUERY_SERVICE_ACCOUNT_KEY` in
SSM. The lib will prefer that over `GA4_SERVICE_ACCOUNT_KEY` if both exist.

### 4. Amplify environment

Set on the Amplify master branch:

```
BIGQUERY_PROJECT_ID=<project-id>
```

(No `BIGQUERY_SERVICE_ACCOUNT_KEY` needed if you're reusing the GA4 SA
per step 3.)

Redeploy — the fan-out in `admin/youtube/page.tsx` gates the section on
`isBigQueryConfigured()`, which reads `BIGQUERY_PROJECT_ID` +
`GA4_PROPERTY_ID` + a service-account key.

### 5. Verify

Visit `/admin/youtube`. The "Site engagement by day of week" section
appears once all three prerequisites are present. If the query fails,
the error message from BigQuery renders inline (permissions, missing
table, wrong region — GA4 usually gives you a clear-enough hint).

## Cost sanity check

At Tamilagaval's current volume:
- Storage: ~0.001 GB/day of GA4 events → free forever
- Queries: the day-of-week query scans ~30 tables × 4 KB = free forever
- Streaming (if enabled later): 0 MB currently → free

Set a `Budget Alert` on the GCP project at $5/month anyway — if any
future query goes rogue and scans terabytes, you get an email before the
bill lands.
