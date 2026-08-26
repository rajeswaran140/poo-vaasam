# tamilagaval-matchering-worker

**Status:** container recipe only, not deployed. Phase 1B PR 1 of 4.

Reference-matched mastering as a separate Python Lambda, invoked by the existing Node master-worker after the loudnorm pass completes. Sits alongside `../compose-worker.ts`, `../master-worker.ts`, `../measure-fn.ts` but ships as a container image rather than a zip — Matchering + NumPy + SciPy exceeds the 250 MB zip limit.

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

## Next PR — first-time deploy (needs your sign-off before I execute)

The deploy PR will:

1. `aws ecr create-repository --repository-name tamilagaval-matchering-worker --region ca-central-1` (one-time, ~$0.05 + $0.10/GB/month storage)
2. Create IAM role `tamilagaval-matchering-worker-role` with least-privilege inline policies:
   - `s3:GetObject` on `tamil-web-media/audio/mastering/*` + `tamil-web-media/audio/references/*`
   - `s3:PutObject` on `tamil-web-media/audio/mastering/*`
   - `dynamodb:UpdateItem` on `TamilWebContent` scoped to `MASTERJOB#*` items via LeadingKeys
   - `AWSLambdaBasicExecutionRole` (CloudWatch logs)
3. `aws lambda create-function --package-type Image --code ImageUri=... --memory-size 4096 --ephemeral-storage Size=4096 --timeout 900 --role ... --function-name tamilagaval-matchering-worker`
4. Add `npm run deploy:matchering-worker` to package.json for subsequent updates
5. First real invocation via a curl-based test event

None of that happens until you approve THIS recipe PR + explicitly authorize the AWS resource creation.

## Phase 1B remaining PRs after deploy

- PR 2 — extend `worker/master-worker.ts` to Event-invoke this Lambda when the incoming job carries `referenceKey`; extend `MASTERJOB#` schema (sparse additions)
- PR 3 — start-route (`/api/admin/music-lab/master`) zod additions for `referenceId` + `matchingMethod`
- PR 4 — reference-bank S3 layout + minimal seeded CRUD (deferred to Phase 1C if not needed for validation)
