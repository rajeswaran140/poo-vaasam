# tamilagaval-matchering-worker

**Status:** DEPLOYED to AWS 2026-08-26; NOT YET wired into master-worker.ts.

Reference-matched mastering as a separate Python Lambda, invoked by the existing Node master-worker after the loudnorm pass completes. Sits alongside `../compose-worker.ts`, `../master-worker.ts`, `../measure-fn.ts` but ships as a container image rather than a zip — Matchering + NumPy + SciPy exceeds the 250 MB zip limit.

## Deployed state (2026-08-26 / 2026-08-27)

| Resource | Value |
|---|---|
| Lambda function | `tamilagaval-matchering-worker` (ca-central-1) |
| Memory / ephemeral / timeout | 4096 MB / 4096 MB / 900 s |
| Package type | Image |
| ECR image URI | `975050319109.dkr.ecr.ca-central-1.amazonaws.com/tamilagaval-matchering-worker:v1` |
| IAM role (this worker) | `tamilagaval-matchering-worker-role` (inline policies: `s3-mastering-references-access`, `ddb-masterjob-patch`; managed: `AWSLambdaBasicExecutionRole`) |
| **IAM role (CALLER — master-worker)** | `tamilagaval-compose-worker-role` MUST carry inline policy `invoke-matchering-worker` granting `lambda:InvokeFunction` on this Lambda's ARN (added 2026-08-27 after the Phase 1B E2E test caught the missing permission). Without it master-worker's Event-invoke silently fails and MASTERJOB shows `matchingStage: failed` + `matchingError.code: invoke-failed`. |
| Env vars | `TAKES_BUCKET=tamil-web-media`, `TAKES_BUCKET_REGION=us-east-1`, `DYNAMODB_TABLE_NAME=TamilWebContent` |
| S3 bucket policy | Extended `DenyCloudFrontOnMasteringWorkspace` Sid → `DenyCloudFrontOnMasteringWorkspaceAndReferences` (covers both `audio/mastering/*` AND `audio/references/*`) |

## Bootstrap IAM commands (for anyone rebuilding from scratch)

```
# Grant the master-worker's shared role permission to invoke this Lambda.
aws iam put-role-policy \
  --role-name tamilagaval-compose-worker-role \
  --policy-name invoke-matchering-worker \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "InvokeMatcheringWorker",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:ca-central-1:975050319109:function:tamilagaval-matchering-worker"
    }]
  }'
```

## First-invoke measurements (cold-started, 2026-08-26)

Source: `audio/mastering/1787709165737_fb3a8c83_-_Music-1_1.wav` (3:22, 39 MB)
Reference: `audio/references/test-ref-v1.wav` (3:22, 58 MB — seeded from an existing mastered file)

| Metric | Value |
|---|---|
| Total wall-clock | 53.4 s |
| Init duration | 10.0 s (hit Lambda's container-init timeout — see below) |
| matchering.process alone | **6.2 s** |
| Cross-region S3 download (us-east-1 → ca-central-1) | ~37 s |
| Peak memory | **1.7 GB** (of 4096 MB) |
| Cost | ~$0.009 per invocation |

## Two Lambda-specific findings from the first invoke

1. **INIT timeout hit** — matchering + numpy + scipy + numba imports exceed Lambda's fixed 10-sec container-init limit. Lambda handles it (restarts init in the invocation phase, no error), but this is why the first invocation shows 53 s wall time. Warm invocations should be much faster. Fix options if it matters: lazy-import numba inside `run()`, or provisioned concurrency.
2. **Cross-region S3 I/O dominates wall time** — 37 s of the 53 s was downloading 97 MB across regions. matchering itself is fast. Fix options: replicate references to a ca-central-1 bucket, or accept the latency for a manually-triggered job.

Neither is blocking; both are optimizations to consider only after Phase 1C blind-A/B validates the feature is worth optimizing.

## Deploying updates

```
npm run deploy:matchering-worker
```

Wraps `scripts/deploy-matchering-worker.sh` — builds the container, pushes to ECR (overwrites `:v1`), and calls `aws lambda update-function-code`. Requires the docker daemon and AWS creds for account 975050319109.

## What's in this PR

| File | Purpose |
|---|---|
| `Dockerfile` | Python 3.12 base (matches the Phase 1A spike environment), single-layer pip install of pinned deps, handler as CMD |
| `requirements.txt` | Matchering 2.0.6 + the exact NumPy/SciPy/soundfile/resampy/statsmodels/numba/llvmlite/pandas versions the Phase 1A spike successfully resolved. Pinned for reproducibility. |
| `handler.py` | Lambda handler. Validates keys against approved prefixes, downloads source+reference from S3, runs `matchering.process` at 48 kHz internal SR, uploads matched WAV, patches `MASTERJOB#<id>` DDB item with `matchingStage` at each step. |
| `LICENSING.md` | GPL isolation strategy — mandatory reading before ever changing this directory's boundaries. |

## What's NOT in this PR

- **No AWS resources created** — ECR repo, IAM role, and Lambda function all live in the follow-up deploy PR.
- **No wiring into the existing pipeline** — `master-worker.ts` gains its Event-invoke call in Phase 1B PR 2.
- **No route changes** — start-route zod additions for `referenceId`/`matchingMethod` in Phase 1B PR 3.
- **No UI changes** — 3-way A/B player in Phase 1C.
- **No feature flag flip** — `MASTERING_REFERENCE_MATCHING` stays `false` until Phase 1C blind-A/B validates.

## Locally verified

Build + smoke test in this PR's development were:

```
sudo docker build -t tamilagaval-matchering-worker:local .
sudo docker run --rm --entrypoint python tamilagaval-matchering-worker:local -c \
    "import matchering as mg; \
     print(mg.Config(internal_sample_rate=48000).internal_sample_rate)"
# → 48000
sudo docker run --rm --entrypoint python tamilagaval-matchering-worker:local -c \
    "import handler; print(handler.lambda_handler.__name__)"
# → lambda_handler
```

Image size: **1.56 GB** uncompressed. (Under Lambda's 10 GB container limit.) Cold-start estimate: 10-15 seconds. Warm invocation: matchering only, ~7-8 seconds per minute of audio (from spike measurements).

## Phase 1B remaining PRs

- **PR 2 (next)** — extend `worker/master-worker.ts` to Event-invoke this Lambda when the incoming job carries `referenceKey`; extend `MASTERJOB#` schema (sparse additions for `referenceId` / `matchingMethod` / `matchedMasterKey` / `matchingStage` / `matchingStats`).
- **PR 3** — start-route (`/api/admin/music-lab/master`) zod additions for `referenceId` + `matchingMethod`.
- **PR 4** — reference-bank S3 layout + minimal seeded CRUD (may be deferred to Phase 1C if manual seeding suffices for early validation).
