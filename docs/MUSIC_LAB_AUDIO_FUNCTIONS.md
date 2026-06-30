# Music Lab — server-side loudness measurement + async mastering

Moves all audio measurement **off the browser** (no more CloudFront/CORS dependency) and adds optional one-click mastering for "hot" takes. Streaming target: **-14 LUFS / -1 dBTP**.

> **Architecture note (important):** this repo is **Amplify Hosting (SSR) + hand-rolled worker Lambdas**, *not* Amplify Gen 2. So there is **no `amplify/backend.ts`, no `defineFunction`, no SQS**. The two functions are plain Lambdas (built with esbuild, deployed via `aws lambda update-function-code`, same as `tamilagaval-compose-worker`); async mastering uses the repo's existing idiom — **Event-invoke + a DynamoDB job record polled by the status route** — instead of SQS.

## Pieces

| Piece | What | Where |
|---|---|---|
| `measure-fn` | sync ffmpeg `ebur128`+`astats`, returns `{metrics,badge,verdict}` | `worker/measure-fn.ts` |
| `master-worker` | async two-pass `loudnorm` → `<key>-master.wav`, writes `MASTERJOB#` | `worker/master-worker.ts` |
| parser (pure, tested) | stderr → metrics/badge/verdict + loudnorm stats | `src/lib/loudness-measure.ts` |
| measure route (sync invoke) | `POST /api/admin/music-lab/measure` | `src/app/api/admin/music-lab/measure/route.ts` |
| master enqueue | `POST /api/admin/music-lab/master` → `{jobId}` | `.../master/route.ts` |
| status poll | `GET /api/admin/music-lab/master/[jobId]` | `.../master/[jobId]/route.ts` |
| job persistence | `MASTERJOB#<id>` (24h ttl) | `src/infrastructure/database/MasterJobRepository.ts` |

Routes are **admin-gated** (`requireAdmin`) and live under `/api/admin/*` per repo convention (the spec's `/api/music-lab/*` paths are public-looking; we keep them admin-gated). The front-end (`MusicLab.tsx`) calls the measure route on log-save and renders `badge`/`verdict`; the legacy Web-Audio decode (`measure-audio-url.ts`, `audio-metrics.ts`) was deleted.

## ffmpeg Lambda layer

Both functions expect ffmpeg at **`/opt/bin/ffmpeg`** (override with `FFMPEG_PATH`). Two options:

1. **Build your own layer (recommended for trust):**
   ```bash
   mkdir -p ffmpeg-layer/bin && cd ffmpeg-layer/bin
   curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar -xJ --strip-components=1 --wildcards '*/ffmpeg'
   cd .. && zip -r ../ffmpeg-layer.zip bin
   aws lambda publish-layer-version --layer-name ffmpeg --zip-file fileb://../ffmpeg-layer.zip \
     --compatible-runtimes nodejs20.x --compatible-architectures x86_64 --region ca-central-1
   # → note the returned LayerVersionArn
   ```
2. Or a vetted public ffmpeg layer ARN for `ca-central-1` / `x86_64` with the binary at `/opt/bin/ffmpeg`.

## One-time function creation (per function)

```bash
# Roles: give each function S3 get/put on the takes bucket; master-worker also DynamoDB UpdateItem.
aws lambda create-function --function-name tamilagaval-measure-fn \
  --runtime nodejs20.x --architectures x86_64 --handler index.handler \
  --role <measure-fn-role-arn> --timeout 60 --memory-size 1024 \
  --layers <ffmpeg-layer-arn> \
  --zip-file fileb://measure-fn.zip --region ca-central-1   # build first: npm run build:measure-fn

aws lambda create-function --function-name tamilagaval-master-worker \
  --runtime nodejs20.x --architectures x86_64 --handler index.handler \
  --role <master-worker-role-arn> --timeout 900 --memory-size 3008 \
  --ephemeral-storage Size=4096 --layers <ffmpeg-layer-arn> \
  --zip-file fileb://master-worker.zip --region ca-central-1  # build first: npm run build:master-worker
```

Thereafter, redeploy code with `npm run deploy:measure-fn` / `npm run deploy:master-worker`.

## Environment variables

> **PROVISIONED + VERIFIED LIVE 2026-06-30.** Layer `tamilagaval-ffmpeg:1` (ffmpeg 7.0.2 static); both functions created (role `tamilagaval-compose-worker-role` reused + an inline `s3:GetObject/PutObject` policy on `tamil-web-media`); env set; both invoked successfully on a real song (measure → master → re-measure lands at −14 LUFS / ≤ −1 dBTP). **Note: `tamil-web-media` is in `us-east-1` (the Lambdas run in `ca-central-1`), so the S3 client uses `TAKES_BUCKET_REGION`.**

**On the Lambdas** (`aws lambda update-function-configuration --environment`):
- `measure-fn`: `TAKES_BUCKET` (= `tamil-web-media`), **`TAKES_BUCKET_REGION` (= `us-east-1`)**, optional `FFMPEG_PATH`. (`AWS_REGION` is Lambda-provided — do not set it.)
- `master-worker`: `TAKES_BUCKET`, `TAKES_BUCKET_REGION`, `DYNAMODB_TABLE_NAME` (= `TamilWebContent`, in `ca-central-1`), optional `FFMPEG_PATH`.

**On the SSR app** (Amplify Console env — only if you rename the functions):
- `MEASURE_FUNCTION` (default `tamilagaval-measure-fn`), `MASTER_WORKER_FUNCTION` (default `tamilagaval-master-worker`).

## IAM
- **measure-fn role:** `s3:GetObject` on `arn:aws:s3:::tamil-web-media/*`.
- **master-worker role:** `s3:GetObject` + `s3:PutObject` on `arn:aws:s3:::tamil-web-media/*`; `dynamodb:UpdateItem` on the `TamilWebContent` table.
- **SSR (Amplify compute) role:** `lambda:InvokeFunction` on both function ARNs (the existing role already invokes `tamilagaval-compose-worker`).

## Acceptance — how it's met
- **Zero browser audio fetch:** measurement is the `measure-fn` Lambda reading S3 server-side; the client only sends an `s3Key`. ✓
- **No request exceeds ~30s:** measure is one EBU R128 pass (seconds), invoked sync under the CloudFront/SSR ceiling; mastering is Event-invoked + polled, so every single call is tiny. ✓
- **±1 LU / ≤ -1 dBTP:** two-pass linear `loudnorm` (validated key parsing in `loudness-measure.test.ts`). ✓
- **Parser validated against real ffmpeg** (skip-in-CI live test + per-frame-vs-summary guard).

## What's code-complete vs. ops
Code, routes, handlers, parser, tests, deploy scripts, front-end swap: **done + green (1902 tests)**. The **ffmpeg layer, the two Lambda + role creations, IAM, and env vars** are AWS provisioning steps (above) — they can't be done from the build and need the AWS console/CLI with the right permissions.
