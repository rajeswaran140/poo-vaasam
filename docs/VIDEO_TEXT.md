# Video Text: operations note

## What it is
An admin tool that renders text over a song (or video) into a finished MP4. A
long render is cut into time chunks; the chunks encode in parallel and are then
joined. Output and intermediates live under `audio/mastering/video-text/` in
`tamil-web-media`. Design: `docs/superpowers/specs/2026-11-07-video-text-tool-design.md`.

## The two Lambdas (ca-central-1)
Both run the same bundle, `master-worker.zip`.
- `tamilagaval-master-worker`: plans the render, invokes chunks synchronously,
  joins the results (reserved concurrency 3).
- `tamilagaval-video-text-chunk`: encodes one chunk (3008 MB, 300 s, 2 GB scratch,
  reserved concurrency 20). Its handler refuses any non-chunk event because
  `AWS_LAMBDA_FUNCTION_NAME` is `tamilagaval-video-text-chunk`.

## Setup order (one time; needs Raj's yes)
1. `npm run build:master-worker && (cd master-worker-dist && zip -q -r ../master-worker.zip index.js)`
2. `./scripts/setup-video-text.sh --dry`, read it, then `./scripts/setup-video-text.sh`.
   It creates the chunk function, reserves 20 concurrent, adds the inline policy
   `invoke-video-text-chunk` on `tamilagaval-compose-worker-role`, and merges the
   lifecycle rule.
3. `npm run deploy:master-worker` (updates all three functions' code).

`scripts/apply-lambda-concurrency-limits.sh` also carries the reservation of 20.

## 30-day rules
The bucket is VERSIONED, so an expiration alone only adds a delete marker and the
bytes would survive until the bucket-wide `expire-noncurrent-90d` rule (about 120
days in total). Two rules on `audio/mastering/video-text/` fix that:
- `video-text-30d`: expire after 30 days, expire noncurrent versions 1 day later (this
  also cleans up the worker's deleted intermediates), abort incomplete multipart
  uploads after 1 day.
- `video-text-markers`: removes leftover expired delete markers.
The setup script MERGES both into the existing rules (it never replaces them) and
refuses to put if any other rule would be lost. Download renders you want to keep.
The DR replica bucket keeps its own copies under its own rules (follow-up, not
changed here).

## Deploy checklist
- Chunk function runtime is `nodejs20.x` or newer (the code uses `AbortSignal.any`).
- Smoke test: invoke the chunk function with a non-chunk event (e.g. `{}`); it must
  return a refusal, not run the master-worker path.
- Smoke test the S3 presigner on the Lambda runtime (a presigned GET for a known
  key must fetch), since bundling externalises the AWS SDK clients.
- After deploy, run one short render end to end.

## Rolling back
- Code: redeploy the previous `master-worker.zip` with `update-function-code` on all
  three functions (the master-worker and chunk must run the same bundle).
- Stop the tool: set the chunk reservation to 0
  (`aws lambda put-function-concurrency --function-name tamilagaval-video-text-chunk --reserved-concurrent-executions 0 --region ca-central-1`).
- Remove the function: `aws lambda delete-function ...` and `aws iam delete-role-policy
  --role-name tamilagaval-compose-worker-role --policy-name invoke-video-text-chunk`.
- Lifecycle: `./scripts/setup-video-text.sh --dry --remove-lifecycle`, then without
  `--dry`. It reads the configuration, drops only our two IDs, applies the same guard
  and puts the rest. Never `delete-bucket-lifecycle` by hand.
